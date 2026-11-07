#!/usr/bin/env node
// Console in front of a real Endora Core, end to end: sign-in with the password and an
// authenticator code, the session's end and sign-out, the snapshot, events and the stream,
// a decision Core refuses, and every way round the allowlist refused. Run by hand against a
// fresh Core that nobody has claimed yet (it claims it):
//
//   CORE_URL=http://127.0.0.1:18443 node scripts/e2e-against-core.mjs
//
// It also asks Core directly, with Console out of the way, to show Core serves alone.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { configFrom, createConsole } from "../server/app.mjs";

const core = process.env.CORE_URL;
if (!core) { console.error("set CORE_URL to a fresh Core"); process.exit(2); }

const server = createConsole(configFrom({ CORE_URL: core }));
await server.checkCore();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const step = (what) => console.log(`ok  ${what}`);

const call = async (method, path, { token, body, origin = base } = {}) => {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") { headers.origin = origin; headers["sec-fetch-site"] = "same-origin"; }
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of text.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// 1. Core's version, through Console.
const health = await call("GET", "/health");
assert.equal(health.status, 200);
assert.equal(health.data.api, "1.0");
step(`Core's /health through Console says API ${health.data.api}`);

// 2. Claim and sign in: Core's own password and authenticator code.
const password = "a-fixture-password-for-e2e";
const claimed = await call("POST", "/v1/session/setup", { body: { password } });
assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
const secret = new URL(claimed.data.otpauth).searchParams.get("secret");
const signedIn = await call("POST", "/v1/session", { body: { password, code: totp(secret) } });
assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
const token = signedIn.data.token;
step("claimed, and signed in with the password and an authenticator code, through Console");

const wrong = await call("POST", "/v1/session", { body: { password, code: "000000" } });
assert.equal(wrong.status, 400);
step("a wrong code is refused by Core");

// 3. When the session ends.
const current = await call("GET", "/v1/session/current", { token });
assert.equal(current.status, 200);
assert.equal(current.data.scope, "full");
assert.ok(current.data.expires_ms > Date.now() && current.data.idle_expires_ms > Date.now());
step(`the session says when it ends (in ${Math.round((current.data.expires_ms - Date.now()) / 86400000)} days, or after a week unused)`);

// 4. The snapshot, events and the stream.
const snap = await call("GET", "/v1/hq", { token });
assert.equal(snap.status, 200, JSON.stringify(snap.data));
assert.ok(Number.isInteger(snap.data.last_event));
const events = await call("GET", `/v1/events?after=0`, { token });
assert.equal(events.status, 200);
assert.equal(typeof events.data.gap, "boolean");
step(`the snapshot's cursor is ${snap.data.last_event}; /v1/events from 0 gave ${events.data.events.length} events, cursor ${events.data.cursor}`);

const stream = await fetch(`${base}/v1/events/stream`, { headers: { authorization: `Bearer ${token}`, "last-event-id": "0" } });
assert.equal(stream.status, 200);
const reader = stream.body.getReader();
let said = "";
while (!said.includes("event: hello")) said += new TextDecoder().decode((await reader.read()).value);
await reader.cancel();
step("the event stream opens through Console with the session in its header and says hello");

const unsignedStream = await fetch(`${base}/v1/events/stream?token=${token}`);
assert.equal(unsignedStream.status, 401);
step("the stream refuses a token in its URL");

// 4b. The home area: the home lab's reads pass to Core (which answers from its own setup).
const lab = await call("GET", "/v1/terminal/dashboard", { token });
assert.notEqual(lab.status, 404, "the home lab is in the contract");
assert.notEqual(lab.status, 401);
step(`the home lab's dashboard passes through Console to Core (Core answered ${lab.status})`);

// 5. A decision: Core binds and refuses what is not on the desk.
const missing = await call("POST", "/v1/decisions/987654", { token, body: { choice: "approve", request: "k-e2e" } });
assert.equal(missing.status, 404, JSON.stringify(missing.data));
const decisions = await call("GET", "/v1/decisions", { token });
assert.equal(decisions.status, 200);
assert.ok(Array.isArray(decisions.data.pending) && Array.isArray(decisions.data.answered));
step(`an answer to an item not on the desk is refused by Core (404); ${decisions.data.pending.length} pending, ${decisions.data.answered.length} answered`);

// 6. Writes need the session: Console has none of its own.
const noSession = await call("POST", "/v1/hq/stop", { body: { why: "e2e" } });
assert.equal(noSession.status, 401);
step("a write without a session is refused by Core: Console adds no credential");

// 7. Ways round the allowlist.
for (const [method, path] of [["POST", "/v1/hq/desk/1"], ["GET", "/v1/activity/stream"], ["GET", "/v1/sound"], ["GET", "/v1/terminal/operations/1"], ["POST", "/v1/connections/spotify/token"], ["GET", "/v1/audit"]]) {
  const res = await call(method, path, { token, body: method === "GET" ? undefined : {} });
  assert.equal(res.status, 404, `${method} ${path}`);
}
const forged = await call("POST", "/v1/hq/stop", { token, body: { why: "e2e" }, origin: "https://elsewhere.example.com" });
assert.equal(forged.status, 403);
step("routes outside the contract are refused by Console, and a write from another origin too");

// 8. Core alone: the same session, asked directly, with Console out of the way.
const direct = await fetch(`${core}/v1/session/current`, { headers: { authorization: `Bearer ${token}` } });
assert.equal(direct.status, 200);
step("Core answers the same session directly: it needs no Console");

// 9. Sign out ends it at once, for Console and Core alike.
const out = await call("POST", "/v1/session/sign-out", { token, body: {} });
assert.equal(out.status, 200);
assert.equal((await call("GET", "/v1/session/current", { token })).status, 401);
assert.equal((await fetch(`${core}/v1/hq`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
step("signing out through Console ends the session at once, on Core itself");

server.close();
console.log("e2e: Console in front of a real Core, every step passed");
