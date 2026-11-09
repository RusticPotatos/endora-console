// The screens call only routes the proxy forwards.
//
// The proxy passes exactly `contract/console-v1.json` and refuses its `never` list, so a screen
// that calls anything else works in a test with a stub and breaks the day it meets the proxy.
// This reads the screens' source (it runs nothing) and holds every path they request to the
// contract: found in `api(METHOD, path)`, `fetch(path, …)` and `new EventSource(path)`, and, as a
// second net, any other string that starts `/v1/`.
//
// What it cannot see: a path built in a variable the call only names (`fetch(url)`). The
// request check in `scripts/check-console.mjs` drives the screens and holds what they really
// send to the same contract; the two together are the guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../server/contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = resolve(here, "../web/js");
const contract = loadContract();

/** Where a path piece the page works out at run time stands in the extracted path. */
const HOLE = "\u0000";

/** The end of the quoted string or template that starts at `at`, and its text with holes. */
function readQuoted(src, at) {
  const quote = src[at];
  let text = "";
  let i = at + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { text += src[i + 1]; i += 2; continue; }
    if (c === quote) return { end: i + 1, text };
    if (quote === "`" && c === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      text += HOLE;
      continue;
    }
    text += c;
    i++;
  }
  throw new Error("an unterminated string at " + at);
}

/**
 * One call argument starting at `at`: the path it builds, with a hole for each part worked out
 * at run time, and where it ends (the `,` or `)` that closes it).
 */
function readArgument(src, at) {
  let i = at;
  let depth = 0;
  let operand = "";
  const operands = [];
  const close = () => { operands.push(operand.trim()); operand = ""; };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = readQuoted(src, i);
      operand += src.slice(i, i + 1) + q.text + src[i];
      // keep a marker of what this operand was, so a bare string and a call are told apart
      i = q.end;
      continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) {
      if (depth === 0) break;
      depth--;
    }
    if (c === "," && depth === 0) break;
    if (c === "+" && depth === 0) { close(); i++; continue; }
    operand += c;
    i++;
  }
  close();
  const path = operands
    .map((o) => {
      const quoted = /^(["'`])([\s\S]*)\1$/.exec(o);
      return quoted ? quoted[2] : HOLE;
    })
    .join("");
  return { path, end: i };
}

/** Every request the source makes through the three ways a screen can: [method, path, line]. */
export function extractRequests(src) {
  const found = [];
  const lineOf = (index) => src.slice(0, index).split("\n").length;
  const record = (method, path, index) => {
    if (!path.startsWith("/")) return;
    found.push([method, path.split(/[?#]/)[0], lineOf(index)]);
  };

  for (const m of src.matchAll(/(?<![\w.$])api\(\s*(["'`])(GET|POST|PUT|PATCH|DELETE)\1\s*,\s*/g)) {
    record(m[2], readArgument(src, m.index + m[0].length).path, m.index);
  }
  for (const m of src.matchAll(/(?<![\w.$])fetch\(\s*/g)) {
    const arg = readArgument(src, m.index + m[0].length);
    const options = src.slice(arg.end, arg.end + 400).split(")")[0];
    const method = /method:\s*(["'`])(GET|POST|PUT|PATCH|DELETE)\1/.exec(options);
    record(method ? method[2] : "GET", arg.path, m.index);
  }
  for (const m of src.matchAll(/new\s+EventSource\(\s*/g)) {
    record("GET", readArgument(src, m.index + m[0].length).path, m.index);
  }
  return found;
}

/** Every string in the source that starts `/v1/`, outside whole-line comments: [path, line]. */
export function extractV1Strings(src) {
  const found = [];
  src.split("\n").forEach((line, n) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // a string that goes on with `+ …` is a prefix: what follows is worked out at run time
    for (const m of line.matchAll(/(["'`])(\/v1\/[^"'`]*)\1(\s*\+)?/g)) {
      const path = m[2].replace(/\$\{[^}]*\}/g, HOLE) + (m[3] ? HOLE : "");
      found.push([path.split(/[?#]/)[0], n + 1]);
    }
  });
  return found;
}

/** Whether the contract lists this route; a hole matches any path parameter. */
function listed(method, path) {
  if (path.startsWith("/console/")) return true; // Console's own routes, not forwarded to Core
  const parts = path.split("/").slice(1);
  return contract.routes.some((route) => {
    if ((method !== null && route.method !== method) || route.segments.length !== parts.length) return false;
    return route.segments.every((s, i) => {
      if (parts[i].includes(HOLE)) return s.pattern !== undefined; // worked out at run time: a parameter
      return s.literal !== undefined ? s.literal === parts[i] : s.pattern.test(parts[i]);
    });
  });
}

const refused = (path) => contract.never.find((never) => path.startsWith(never)) || null;

function problems(file, src) {
  const out = [];
  for (const [method, path, line] of extractRequests(src)) {
    const shown = path.replaceAll(HOLE, "{id}");
    const never = refused(path);
    if (never) out.push(`${file}:${line} ${method} ${shown} is on the contract's never list (${never})`);
    else if (!listed(method, path)) out.push(`${file}:${line} ${method} ${shown} is not a route in the contract`);
  }
  for (const [path, line] of extractV1Strings(src)) {
    const shown = path.replaceAll(HOLE, "{id}");
    const never = refused(path);
    if (never) out.push(`${file}:${line} "${shown}" is on the contract's never list (${never})`);
    else if (!listed(null, path)) out.push(`${file}:${line} "${shown}" is not a route in the contract`);
  }
  return out;
}

const files = readdirSync(jsDir).filter((name) => name.endsWith(".js")).sort();

test("every path the screens request is a route in the contract, and none is on its never list", () => {
  const all = files.flatMap((name) => problems(`web/js/${name}`, readFileSync(join(jsDir, name), "utf8")));
  assert.deepEqual(all, []);
});

test("the extractor sees the screens' requests (a pass is not an empty search)", () => {
  const sources = files.map((name) => readFileSync(join(jsDir, name), "utf8"));
  const requests = sources.flatMap(extractRequests);
  const distinct = new Set(requests.map(([method, path]) => `${method} ${path}`));
  assert.ok(distinct.size > 60, `only ${distinct.size} distinct requests found`);
  for (const must of ["GET /v1/hq", "POST /v1/decisions/\0", "GET /v1/events", "GET /v1/events/stream", "GET /v1/session"]) {
    assert.ok(distinct.has(must), `no ${must.replace(HOLE, "{id}")} request found`);
  }
});

test("the extractor and the check refuse what they are here to refuse", () => {
  const bad = [
    'await api("POST", `/v1/hq/desk/${id}`, { decision: arg });',
    'await api("GET", `/v1/hq/events?after=${HQ.last}`);',
    'new EventSource("/v1/activity/stream?token=" + encodeURIComponent(token()));',
    'await api("POST", "/v1/connections/spotify/token", {});',
    'await api("PUT", "/v1/sound/wires", { source });',
    'await api("DELETE", `/v1/sound/wires/${w.source}/${w.speaker}`);',
    'const res = await fetch("/v1/round", { method: "POST" });',
    'await api("POST", "/v1/mcp/servers/" + encodeURIComponent(id) + "/nuke");',
    'const url = "/v1/projects"; await fetch(url);',
  ];
  for (const line of bad) {
    assert.notEqual(problems("x.js", line).length, 0, line);
  }
  const good = [
    'await api("POST", `/v1/decisions/${id}`, { choice });',
    'await api("GET", `/v1/events?before=${Number(next)}&limit=${N}`);',
    'await fetch("/v1/events/stream", { headers, cache: "no-store" });',
    'await api("POST", "/v1/mcp/servers/" + encodeURIComponent(id) + "/trust", { trust_all: on });',
    'await fetch(`/v1/hq/bundles/${Number(id)}/${slug}`, { headers: signed({}) });',
    'await fetch("https://api.example.com/v1/anything");',
    'await fetch("/console/audio", { cache: "no-store" });',
  ];
  for (const line of good) {
    assert.deepEqual(problems("x.js", line), [], line);
  }
  // the method is part of the route: a POST to a GET-only route is not listed
  assert.notEqual(problems("x.js", 'await api("POST", "/v1/events");').length, 0);
});
