// Endora Console's server: the console's files, and a proxy to Endora Core that passes the
// contract's routes and nothing else.
//
// It sits in the browser's trust path (one origin, Console in front), so it is kept small and
// holds nothing worth taking:
//
// - No credential and no session store. The person's Core session travels in the request's
//   `Authorization` header from the browser to Core and back, untouched and unread.
// - Only the contract's routes, by method and path pattern (`contract.mjs`). Everything else is
//   404 here and never reaches Core; HQ is never called.
// - Every write must come from this origin: `Origin` must be this Console's, a browser's
//   `Sec-Fetch-Site` must say same-origin, and the body must be JSON. With the session in a
//   header rather than a cookie a cross-site form cannot carry it anyway; this is the second
//   lock.
// - Only the request headers Core needs go on, and only the response headers the page needs
//   come back.
// - Core's contract version is checked; a Core whose major version this Console does not know
//   is refused with a plain message rather than half-working.

import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract, match, major, plainPath } from "./contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const WEB = resolve(here, "../web");
export const VERSION = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")).version;

/** The console's script: the parts joined in name order, as Core's node joins them. */
export function joinScript(dir = resolve(WEB, "js")) {
  return readdirSync(dir).filter((n) => n.endsWith(".js")).sort()
    .map((n) => readFileSync(resolve(dir, n), "utf8")).join("");
}

const REQUEST_HEADERS = ["authorization", "content-type", "accept", "last-event-id"];
const RESPONSE_HEADERS = ["content-type", "cache-control", "content-disposition", "content-length"];
const MOST_BODY = 1024 * 1024;
const MOST_QUERY = 2048;
const TYPES = { ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".css": "text/css; charset=utf-8" };

const SECURITY = {
  "content-security-policy":
    // HQ's screens load their two typefaces from Google Fonts, as Endora's built-in console does.
    // 'unsafe-inline' for scripts only because six copied screens use inline event handlers
    // (onchange=, onclick=); drop it once those are replaced in Endora (the screen freeze).
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** Reads the configuration from the environment, refusing what would make the proxy unsafe. */
export function configFrom(env = process.env) {
  const core = env.CORE_URL || "";
  if (!/^https?:\/\/[^/?#]+\/?$/.test(core)) throw new Error("CORE_URL must be Core's origin, such as https://endora-node:8443");
  const audioLink = env.AUDIO_PUBLIC_URL || "";
  if (audioLink && !/^https?:\/\//.test(audioLink)) throw new Error("AUDIO_PUBLIC_URL must be an http(s) URL");
  const audio = env.AUDIO_URL || "";
  if (audio && !/^https?:\/\/[^/?#]+\/?$/.test(audio)) throw new Error("AUDIO_URL must be Audio's origin");
  const origins = (env.CONSOLE_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  for (const o of origins) if (!/^https?:\/\/[^/?#]+$/.test(o)) throw new Error(`CONSOLE_ORIGIN: ${o} is not an origin`);
  return {
    core: core.replace(/\/$/, ""),
    coreCa: env.CORE_CA_FILE ? readFileSync(env.CORE_CA_FILE) : null,
    coreServername: env.CORE_TLS_SERVERNAME || "",
    audio: audio.replace(/\/$/, ""),
    audioLink,
    origins,
    port: Number(env.PORT || 8080),
    tls: env.CONSOLE_TLS_CERT && env.CONSOLE_TLS_KEY
      ? { cert: readFileSync(env.CONSOLE_TLS_CERT), key: readFileSync(env.CONSOLE_TLS_KEY) } : null,
    build: env.CONSOLE_BUILD || "dev",
  };
}

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY,
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

/** One request to Core: method, path and query, the allowed headers, and the body if any. */
function toCore(config, method, pathAndQuery, headers) {
  const url = new URL(config.core + pathAndQuery);
  const https = url.protocol === "https:";
  const options = {
    method,
    hostname: url.hostname,
    port: url.port || (https ? 443 : 80),
    path: url.pathname + url.search,
    headers,
  };
  if (https) {
    if (config.coreCa) options.ca = config.coreCa;
    if (config.coreServername) options.servername = config.coreServername;
  }
  return (https ? httpsRequest : httpRequest)(options);
}

/** GETs a small JSON document (a health check), or throws. */
function getJson(config, base, path, timeoutMs = 3000) {
  return new Promise((resolveIt, reject) => {
    const url = new URL(base + path);
    const https = url.protocol === "https:";
    const req = (https ? httpsRequest : httpRequest)({
      method: "GET", hostname: url.hostname, port: url.port || (https ? 443 : 80), path: url.pathname,
      headers: { accept: "application/json" },
      ...(https && base === config.core && config.coreCa ? { ca: config.coreCa } : {}),
      ...(https && base === config.core && config.coreServername ? { servername: config.coreServername } : {}),
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (text.length < 65536) text += c; });
      res.on("end", () => {
        try { resolveIt({ status: res.statusCode, body: JSON.parse(text) }); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("no answer in time")));
    req.on("error", reject);
    req.end();
  });
}

/** Whether a write comes from this Console's own page. */
export function sameOrigin(req, config, secure) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin") return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  if (config.origins.length) return config.origins.includes(origin);
  const host = req.headers.host;
  return !!host && origin === `${secure ? "https" : "http"}://${host}`;
}

/** What a refused change tells the owner: the address the Console expects and the one the change came from.
 *  Both are shown only when they are plain web addresses, since a request's headers are not trusted text. */
export function originRefusal(req, config, secure) {
  const plain = (v) => (typeof v === "string" && /^https?:\/\/[A-Za-z0-9.:\[\]-]{1,200}$/.test(v) ? v : "");
  const host = String(req.headers.host || "");
  const expected = config.origins.length
    ? config.origins.map(plain).filter(Boolean).join(" or ")
    : plain(`${secure ? "https" : "http"}://${host}`);
  const used = plain(req.headers.origin);
  const from = !req.headers.origin ? "it named no Origin address" : used ? `it came from ${used}` : "it came from an address that is not a web address";
  const site = req.headers["sec-fetch-site"];
  const note = used && used === expected && site && site !== "same-origin" ? " (the browser marked it as sent from another site)" : "";
  const open = expected ? ` Open the Console at ${expected} and try again.` : "";
  return `a change must come from this Console's own page: ${expected ? `this Console expects ${expected}, but ` : ""}${from}${note}.${open}`;
}

export function createConsole(config, { contract = loadContract() } = {}) {
  const script = joinScript();
  const index = readFileSync(resolve(WEB, "index.html"), "utf8")
    .replace("/app.js", `/app.js?v=${encodeURIComponent(config.build)}`)
    .replace("/styles.css", `/styles.css?v=${encodeURIComponent(config.build)}`);
  const styles = readFileSync(resolve(WEB, "styles.css"), "utf8");
  const art = resolve(WEB, "hq-art");
  const core = { api: null, reachable: false, checked: 0 };

  async function checkCore() {
    try {
      const { body } = await getJson(config, config.core, "/health");
      core.reachable = true;
      core.api = body && body.api ? String(body.api) : null;
    } catch {
      core.reachable = false;
    }
    core.checked = Date.now();
  }
  const compatible = () => core.api === null || major(core.api) === major(contract.version);

  async function audioStatus() {
    if (!config.audio) return { configured: false, ok: false, link: config.audioLink };
    try {
      const { status, body } = await getJson(config, config.audio, "/health");
      return { configured: true, ok: status === 200 && (!body.status || body.status === "ok"), link: config.audioLink };
    } catch (e) {
      return { configured: true, ok: false, link: config.audioLink, error: "no answer" };
    }
  }

  function proxy(req, res, pathAndQuery) {
    const headers = {};
    for (const name of REQUEST_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    let size = 0;
    const upstream = toCore(config, req.method, pathAndQuery, headers);
    const stream = /^\/v1\/events\/stream(\?|$)/.test(pathAndQuery);
    if (!stream) upstream.setTimeout(30000, () => upstream.destroy(new Error("Core did not answer in time")));
    upstream.on("response", (answer) => {
      const back = { ...SECURITY };
      for (const name of RESPONSE_HEADERS) if (answer.headers[name]) back[name] = answer.headers[name];
      if (stream) back["x-accel-buffering"] = "no";
      res.writeHead(answer.statusCode || 502, back);
      if (stream) res.flushHeaders();
      answer.pipe(res);
    });
    upstream.on("error", (e) => {
      if (res.headersSent) { res.destroy(); return; }
      send(res, 502, { error: `Console could not reach Endora Core: ${e.message}` });
    });
    res.on("close", () => upstream.destroy());
    if (!hasBody) { upstream.end(); return; }
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MOST_BODY) {
        upstream.destroy();
        if (!res.headersSent) send(res, 413, { error: "that request is too large" });
        req.destroy();
        return;
      }
      upstream.write(chunk);
    });
    req.on("end", () => upstream.end());
  }

  async function handle(req, res, secure) {
    const raw = req.url || "/";
    const q = raw.indexOf("?");
    const path = q < 0 ? raw : raw.slice(0, q);
    const query = q < 0 ? "" : raw.slice(q);
    if (query.length > MOST_QUERY) return send(res, 414, { error: "that address is too long" });
    if (!plainPath(path)) return send(res, 400, { error: "not a path Console serves" });

    if (req.method === "GET" || req.method === "HEAD") {
      if (path === "/" || path === "/index.html") {
        return send(res, 200, index, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      }
      if (path === "/app.js") {
        return send(res, 200, script, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" });
      }
      if (path === "/styles.css") {
        return send(res, 200, styles, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" });
      }
      if (path.startsWith("/hq-art/")) {
        const file = resolve(art, "." + path.slice("/hq-art".length));
        const type = TYPES[extname(file)];
        try {
          if (!file.startsWith(art + sep) || !type || !statSync(file).isFile()) throw new Error("no");
          return send(res, 200, readFileSync(file), { "content-type": type, "cache-control": "public, max-age=86400" });
        } catch {
          return send(res, 404, { error: "no such picture" });
        }
      }
      if (path === "/console/health") {
        if (Date.now() - core.checked > 10000) await checkCore();
        return send(res, 200, {
          status: "ok", service: "endora-console", version: VERSION, build: config.build,
          contract: contract.version, core: { reachable: core.reachable, api: core.api, compatible: compatible() },
        });
      }
      if (path === "/console/audio") return send(res, 200, await audioStatus());
    }

    const route = match(contract, req.method, path);
    if (!route) return send(res, 404, { error: "Console does not pass that on: it is not in the Core contract" });
    if (req.method !== "GET") {
      if (!sameOrigin(req, config, secure)) return send(res, 403, { error: originRefusal(req, config, secure) });
      const type = String(req.headers["content-type"] || "");
      const length = Number(req.headers["content-length"] || 0);
      if ((length > 0 || req.headers["transfer-encoding"]) && !/^application\/json\b/i.test(type)) {
        return send(res, 415, { error: "a change is sent as JSON" });
      }
      if (length > MOST_BODY) return send(res, 413, { error: "that request is too large" });
    }
    if (route.path !== "/health" && !compatible()) {
      return send(res, 503, { error: `This Console speaks Endora Core's API ${major(contract.version)}; this Core says ${core.api}. Update one of them.` });
    }
    proxy(req, res, path + query);
  }

  const listener = (secure) => (req, res) => {
    handle(req, res, secure).catch((e) => {
      if (!res.headersSent) send(res, 500, { error: e.message });
    });
  };
  const server = config.tls ? createHttps(config.tls, listener(true)) : createHttp(listener(false));
  server.checkCore = checkCore;
  server.core = core;
  return server;
}
