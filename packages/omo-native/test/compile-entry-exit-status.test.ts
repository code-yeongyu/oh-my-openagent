import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

// Guards #10227. Under Bun, `process.exitCode = undefined` does not clear a code that was already
// set (Node does), so a test that restores a saved `undefined` leaves the runner exiting non-zero
// after every test passed. Exit-code gates read that status, so the file's own exit code is the contract.
test("#given every compile-entry test passes #when the file runs under bun #then it exits 0", () => {
  const run = spawnSync(process.execPath, ["test", join(import.meta.dir, "compile-entry.test.ts")], {
    encoding: "utf8",
    env: { ...process.env, BUN_TEST_EXIT_STATUS_PROBE: "1" },
  })
  const summary = `${run.stdout}${run.stderr}`.split("\n").filter((line) => / (pass|fail)$/.test(line)).join(" | ")
  expect({ status: run.status, summary }).toEqual({ status: 0, summary: expect.stringMatching(/ 0 fail/) })
}, 120_000)
