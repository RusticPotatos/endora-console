// The proxy in the trust path: what it passes, what it refuses, and what it never adds.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConsole, configFrom } from "../server/app.mjs";

// A pretend Core: records every request it is sent and answers as Core does.
const seen = [];
let coreApi = "1.0";
const core = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "core=1" });
      return res.end(JSON.stringify({ status: "ok", api: coreApi }));
    }
    if (req.url.startsWith("/v1/events/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: hello\ndata: {\"cursor\":3}\n\n");
      setTimeout(() => { res.write("id: 4\nevent: hq\ndata: {}\n\n"); }, 50);
      setTimeout(() => res.end(), 400);
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "set-cookie": "core=1", "x-internal": "yes" });
    res.end(JSON.stringify({ ok: true }));
  });
});
const audio = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

let consoleServer;
let base;
const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

before(async () => {
  const corePort = await listen(core);
  const audioPort = await listen(audio);
  const config = configFrom({
    CORE_URL: `http://127.0.0.1:${corePort}`,
    AUDIO_URL: `http://127.0.0.1:${audioPort}`,
    AUDIO_PUBLIC_URL: "http://audio.example.com:8099/",
  });
  consoleServer = createConsole(config);
  await consoleServer.checkCore();
  base = `http://127.0.0.1:${await listen(consoleServer)}`;
});
after(() => { consoleServer.close(); core.close(); audio.close(); });

const sent = () => seen.length;
const same = (extra = {}) => ({ origin: base, "sec-fetch-site": "same-origin", ...extra });

test("a contract route reaches Core with the session as the browser sent it, and nothing more", async () => {
  const before = sent();
  const res = await fetch(`${base}/v1/hq?x=1`, {
    headers: { authorization: "Bearer a-session", cookie: "a=b", "x-forwarded-for": "192.168.1.10", "x-endora": "z" },
  });
  assert.equal(res.status, 200);
  const got = seen[before];
  assert.equal(got.url, "/v1/hq?x=1");
  assert.equal(got.headers.authorization, "Bearer a-session");
  for (const gone of ["cookie", "x-forwarded-for", "x-endora", "origin"]) assert.equal(got.headers[gone], undefined, gone);
  assert.equal(res.headers.get("set-cookie"), null, "Core's cookies never come back");
  assert.equal(res.headers.get("x-internal"), null);
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
});

test("Console adds no credential of its own", async () => {
  const before = sent();
  await fetch(`${base}/v1/hq`);
  assert.equal(seen[before].headers.authorization, undefined);
});

test("a route outside the contract never reaches Core", async () => {
  const before = sent();
  for (const [method, path] of [
    ["POST", "/v1/hq/desk/1"], ["GET", "/v1/activity/stream?token=t"], ["GET", "/v1/runner/next"],
    ["POST", "/v1/team/mcp"], ["GET", "/v1/sound"], ["GET", "/team-relay/contracts"], ["PUT", "/v1/hq"],
  ]) {
    const res = await fetch(`${base}${path}`, { method, headers: same({ "content-type": "application/json" }), body: method === "GET" ? undefined : "{}" });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  for (const raw of ["/v1/hq/../runner/next", "/v1/hq%2f..%2frunner"]) {
    const res = await rawGet(raw);
    assert.ok(res === 400 || res === 404, `${raw}: ${res}`);
  }
  assert.equal(sent(), before);
});

// fetch normalizes dot segments, so a raw path goes through node:http.
import { request } from "node:http";
function rawGet(path) {
  return new Promise((r) => {
    const u = new URL(base);
    const req = request({ hostname: u.hostname, port: u.port, path, method: "GET" }, (res) => { res.resume(); r(res.statusCode); });
    req.end();
  });
}

test("a change must come from this Console's own page, as JSON", async () => {
  const before = sent();
  const post = (headers, body = "{}") => fetch(`${base}/v1/hq/stop`, { method: "POST", headers, body });
  assert.equal((await post({ "content-type": "application/json" })).status, 403, "no Origin");
  assert.equal((await post({ origin: "https://elsewhere.example.com", "content-type": "application/json" })).status, 403);
  assert.equal((await post(same({ "sec-fetch-site": "cross-site", "content-type": "application/json" }))).status, 403);
  assert.equal((await post(same({ "content-type": "text/plain" }))).status, 415);
  assert.equal(sent(), before, "none reached Core");
  const ok = await post(same({ "content-type": "application/json", authorization: "Bearer s" }), '{"why":"fixture"}');
  assert.equal(ok.status, 200);
  assert.equal(seen[before].body, '{"why":"fixture"}');
});

test("a body over a megabyte is refused", async () => {
  const res = await fetch(`${base}/v1/hq/tasks`, {
    method: "POST", headers: same({ "content-type": "application/json" }), body: "x".repeat(1024 * 1024 + 10),
  });
  assert.equal(res.status, 413);
});

test("the event stream passes through as it comes, not when it ends", async () => {
  const res = await fetch(`${base}/v1/events/stream`, { headers: { authorization: "Bearer s", "last-event-id": "3" } });
  assert.equal(res.status, 200);
  assert.equal(seen.at(-1).headers["last-event-id"], "3");
  const reader = res.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: hello/);
  let rest = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
  assert.match(rest, /id: 4/);
});

test("Console's own health and Audio's status answer without a session", async () => {
  const health = await (await fetch(`${base}/console/health`)).json();
  assert.equal(health.service, "endora-console");
  assert.deepEqual(health.core, { reachable: true, api: "1.0", compatible: true });
  const status = await (await fetch(`${base}/console/audio`)).json();
  assert.deepEqual(status, { configured: true, ok: true, link: "http://audio.example.com:8099/" });
});

test("a Core of another major version is refused with a plain message", async () => {
  coreApi = "2.0";
  await consoleServer.checkCore();
  const res = await fetch(`${base}/v1/hq`);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /API 1; this Core says 2.0/);
  coreApi = "1.0";
  await consoleServer.checkCore();
});

test("the page and its art are served, and nothing beside them", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/app\.js\?v=/);
  const script = await (await fetch(`${base}/app.js`)).text();
  assert.match(script, /function consoleRoute\(/);
  assert.equal((await fetch(`${base}/hq-art/CREDITS.txt`)).status, 200);
  assert.equal(await rawGet("/hq-art/../server/app.mjs"), 400);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});

test("unsafe configuration is refused at start", () => {
  assert.throws(() => configFrom({}), /CORE_URL/);
  assert.throws(() => configFrom({ CORE_URL: "http://core:8443/v1/hq" }), /CORE_URL/);
  assert.throws(() => configFrom({ CORE_URL: "http://core", AUDIO_PUBLIC_URL: "javascript:alert(1)" }), /AUDIO_PUBLIC_URL/);
  assert.throws(() => configFrom({ CORE_URL: "http://core", CONSOLE_ORIGIN: "https://a.example.com/path" }), /CONSOLE_ORIGIN/);
});
