// The allowlist is the contract, exactly, and refuses everything Console must never call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_FILE, SOURCE_FILE, loadContract, match, plainPath } from "../server/contract.mjs";

const contract = loadContract();
const example = (path) => path.replace(/\{id\}/g, "7").replace(/\{(name|slug|action)\}/g, "fixture");

test("every route in the contract is passed, by its own method only", () => {
  assert.ok(contract.routes.length > 50);
  for (const route of contract.routes) {
    assert.equal(match(contract, route.method, example(route.path))?.path, route.path, route.path);
    const other = route.method === "GET" ? "POST" : "GET";
    const sibling = contract.routes.some((r) => r.method === other && r.path === route.path);
    if (!sibling) assert.equal(match(contract, other, example(route.path)), null, `${other} ${route.path}`);
  }
});

test("nothing Console must never call is passed", () => {
  for (const path of [
    "/v1/hq/desk/7", "/v1/activity/stream", "/v1/sound", "/v1/sound/speakers/1/volume",
    "/v1/terminal/operations/1", "/v1/runner/next", "/v1/team/mcp", "/team-relay/v1/messages",
    "/team-gateway/mcp", "/v1/round", "/v1/projects", "/v1/tasks", "/v1/goals", "/v1/members",
    "/v1/pool/top-up", "/v1/hq/members/1/model", "/v1/session/dashboard", "/v1/audit",
    "/v1/connections/spotify/token", "/v1/mac/heartbeat", "/v1/capabilities/x/invoke",
  ]) {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      assert.equal(match(contract, method, path), null, `${method} ${path}`);
    }
  }
  for (const never of contract.never) {
    assert.ok(!contract.routes.some((r) => r.path.startsWith(never)), never);
  }
});

test("a path is refused before matching if it could be read two ways", () => {
  for (const raw of [
    "/v1/hq/../runner/next", "/v1//hq", "/v1/hq/tasks/%2e%2e", "/v1/hq%2ftasks", "/v1/hq\\tasks",
    "/v1/hq/tasks/1%00", "v1/hq", "/v1/hq/tasks/ 1", "/v1/hq/tasks/é",
  ]) {
    assert.equal(plainPath(raw), false, raw);
  }
  assert.equal(match(contract, "GET", "/v1/hq/tasks/1x"), null, "an id is digits");
  assert.equal(match(contract, "GET", "/v1/hq/tasks/1/live/more"), null);
  assert.equal(match(contract, "POST", "/v1/mcp/servers/a.b-c_d/test")?.path, "/v1/mcp/servers/{name}/test");
});

test("a copy of the contract that does not match its pin is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "console-contract-"));
  const copy = join(dir, "c.json");
  copyFileSync(CONTRACT_FILE, copy);
  writeFileSync(copy, "\n", { flag: "a" });
  assert.throws(() => loadContract(copy, SOURCE_FILE), /does not match its pin/);
});
