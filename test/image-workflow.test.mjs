// The image is never published by an ordinary event: scripts/test-image-workflow.py reads
// .github/workflows/ci.yml and checks, event by event, which steps would log in or push.
// It needs PyYAML (on GitHub's ubuntu runners; macOS's /usr/bin/python3 has it too), so this
// tries each python3 on the path and fails loudly when none can import it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/test-image-workflow.py", import.meta.url));
const candidates = ["python3", "/usr/bin/python3"];

test("ci.yml publishes the image only on a manual dispatch with the variable enabled", () => {
  for (const python of candidates) {
    const has = spawnSync(python, ["-c", "import yaml"], { encoding: "utf8" });
    if (has.error || has.status !== 0) continue;
    const run = spawnSync(python, [script], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /image workflow tests passed/);
    return;
  }
  assert.fail("no python3 with PyYAML on this machine; the image workflow cannot be tested");
});
