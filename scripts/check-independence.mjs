#!/usr/bin/env node
// Console imports nothing of Endora Core's, and reaches nothing of HQ's.
//
// Console is its own deployable (Endora ADR 0145). It knows Core only through the contract
// (contract/console-v1.json) and HTTP. So no file here may:
// - import anything but Node's own modules and files in this repository (there are no
//   dependencies at all: package.json has none, and this keeps it that way);
// - name Core's source (its crates, app folders or Cargo), which would mean code was shared
//   rather than called;
// - name HQ's port or its engine routes, which Console never calls.
// The contract's own `never` list, and the tests that prove those routes are refused, are the
// places such names belong.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n").filter(Boolean);
const failures = [];

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
  if (pkg[field] && Object.keys(pkg[field]).length) failures.push(`package.json: ${field} is not empty`);
}

const SAYS_WHAT_IS_REFUSED = new Set(["contract/console-v1.json", "test/contract.test.mjs", "test/proxy.test.mjs", "scripts/check-independence.mjs"]);
const CORE_SOURCE = /\b(app\/(node|hq|runner|worker|sound)\/|domains\/(team|capabilities|platform|sound|mail)\b|crates\/endora-|shared\/(kernel|persistence|protocol)\b|Cargo\.toml)/;
const HQ_ROUTES = /(:8790\b|\/v1\/runner\b|\/v1\/team\/|team-relay|team-gateway|HQ_URL)/;

for (const file of files) {
  if (!/\.(m?js|json|html|css|ya?ml|md|feature)$|Dockerfile$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (/\.m?js$/.test(file)) {
    for (const m of text.matchAll(/\bimport\s[^"'`;]*?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']/g)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec.startsWith("node:") && !spec.startsWith("./") && !spec.startsWith("../")) {
        failures.push(`${file}: imports ${spec}`);
      }
    }
  }
  if (SAYS_WHAT_IS_REFUSED.has(file) || file === "README.md" || file === "AGENTS.md" || file === "SOURCE.md") continue;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (CORE_SOURCE.test(line)) failures.push(`${file}:${i + 1}: names Core's source: ${line.trim().slice(0, 100)}`);
    if (HQ_ROUTES.test(line)) failures.push(`${file}:${i + 1}: names HQ's port or routes: ${line.trim().slice(0, 100)}`);
  });
}

if (failures.length) {
  console.error(`independence: ${failures.length} problem(s)\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`independence: ${files.length} files, no dependency, nothing of Core's source, nothing of HQ's`);
