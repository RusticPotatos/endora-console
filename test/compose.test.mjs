// The compose file's container name is a variable whose default is the name every standalone
// install already has. Rendered by Compose itself (no YAML parser is a dependency here), so the
// test checks what Compose would run, not the text of the file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const compose = join(here, "..", "compose.yaml");

// Renders compose.yaml with only the given variables set: the host's environment and any .env
// beside the file are left out, so a developer's own settings cannot change the result.
function render(vars) {
  const work = mkdtempSync(join(tmpdir(), "console-compose-"));
  try {
    const envFile = join(work, "empty.env");
    writeFileSync(envFile, "");
    const env = { PATH: process.env.PATH, HOME: work, CORE_URL: "http://core.example.com:8787", ...vars };
    const out = execFileSync(
      "docker",
      ["compose", "-f", compose, "--env-file", envFile, "config", "--format", "json"],
      { env, encoding: "utf8" },
    );
    return JSON.parse(out).services.console;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("with no name set, the container keeps today's name", () => {
  assert.equal(render({}).container_name, "endora-console");
});

test("a name set in the variable is the container's name", () => {
  assert.equal(render({ CONSOLE_CONTAINER_NAME: "endora-console-second" }).container_name, "endora-console-second");
});

test("the name variable changes nothing else the service runs with", () => {
  const before = render({});
  const after = render({ CONSOLE_CONTAINER_NAME: "endora-console-second" });
  const { container_name: _a, ...rest } = before;
  const { container_name: _b, ...restAfter } = after;
  assert.deepEqual(restAfter, rest);
});
