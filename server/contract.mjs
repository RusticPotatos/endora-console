// The Core <-> Console contract, as Console enforces it.
//
// `contract/console-v1.json` is a copy of Endora Core's `docs/api/console-v1.json`, pinned in
// `contract/SOURCE.json` by the Core commit it came from and its SHA-256. The proxy's allowlist
// is built from it and from nothing else, so "what Console may call" and "what the contract
// lists" cannot drift apart: a changed copy fails the pin, and a route that is not listed is
// never passed on.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACT_FILE = resolve(here, "../contract/console-v1.json");
export const SOURCE_FILE = resolve(here, "../contract/SOURCE.json");

/** What a path parameter may be. Anything else is refused before Core sees it. */
const PARAMETERS = {
  id: /^[0-9]{1,19}$/,
  name: /^[A-Za-z0-9._-]{1,128}$/,
  slug: /^[A-Za-z0-9._-]{1,128}$/,
  action: /^[A-Za-z0-9._-]{1,64}$/,
};

/** Loads the contract, refusing a copy that does not match its pin. */
export function loadContract(file = CONTRACT_FILE, source = SOURCE_FILE) {
  const text = readFileSync(file);
  const pin = JSON.parse(readFileSync(source, "utf8"));
  const sha256 = createHash("sha256").update(text).digest("hex");
  if (sha256 !== pin.sha256) {
    throw new Error(`contract/console-v1.json does not match its pin (${sha256} != ${pin.sha256})`);
  }
  const contract = JSON.parse(text.toString("utf8"));
  return { ...contract, pin, routes: contract.routes.map(compile) };
}

function compile(route) {
  const segments = route.path.split("/").slice(1).map((segment) => {
    const param = /^\{([a-z]+)\}$/.exec(segment);
    if (!param) return { literal: segment };
    const pattern = PARAMETERS[param[1]];
    if (!pattern) throw new Error(`the contract uses an unknown parameter {${param[1]}} in ${route.path}`);
    return { pattern };
  });
  return { ...route, segments };
}

/**
 * Whether a raw request path is one Console will even look at: plain ASCII, no dot segments,
 * no doubled or encoded slashes, no backslashes. Checked on the raw path, before any decoding,
 * so an encoded `..` or `/` cannot slip past the matcher and be decoded by Core.
 */
export function plainPath(raw) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length > 512) return false;
  if (!/^[\x21-\x7e]+$/.test(raw)) return false;
  if (raw.includes("//") || raw.includes("\\")) return false;
  if (/%2f|%5c|%2e|%00/i.test(raw)) return false;
  return !raw.split("/").some((s) => s === "." || s === "..");
}

/** The contract route a request matches, or null. */
export function match(contract, method, rawPath) {
  if (!plainPath(rawPath)) return null;
  const parts = rawPath.split("/").slice(1);
  for (const route of contract.routes) {
    if (route.method !== method || route.segments.length !== parts.length) continue;
    const fits = route.segments.every((s, i) => (s.literal !== undefined ? s.literal === parts[i] : s.pattern.test(parts[i])));
    if (fits) return route;
  }
  return null;
}

/** The major number of a contract version ("1.0" -> 1), or NaN. */
export function major(version) {
  return Number(String(version || "").split(".")[0]);
}
