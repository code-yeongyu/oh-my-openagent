import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const TESTS = [
  "packages/senpi-task/src/runners/rpc-host-own-endpoint.test.ts",
  "packages/senpi-task/src/runners/rpc-host-endpoint.test.ts",
  "packages/senpi-task/src/lifecycle/host-endpoint-inside-host.test.ts",
  "packages/senpi-task/src/lifecycle/host-session-endpoint.test.ts",
  "packages/senpi-task/src/store/rollback-migrate.test.ts",
  "packages/omo-native/test/daemon-rollback.test.ts",
  "packages/omo-native/test/daemon-rollback-options.test.ts",
  "packages/omo-native/test/daemon-drain-wait.test.ts",
  "packages/omo-senpi/src/components/task/shard-routing.test.ts",
  "packages/senpi-task/src/runners/rpc-host/shard-socket.test.ts",
]

export function runContractMatrix(repoRoot, artifacts) {
  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  }
  const result = spawnSync("bun", ["test", ...TESTS], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const logPath = join(artifacts, "contract-tests.log")
  writeFileSync(
    logPath,
    [
      `command=bun test ${TESTS.join(" ")}`,
      `exit=${result.status}`,
      result.stdout ?? "",
      result.stderr ?? "",
    ].join("\n"),
  )
  if (result.status !== 0) {
    return {
      status: "fail",
      evidence: [logPath],
      reason: `contract test gate exited ${result.status}`,
    }
  }
  return {
    status: "pass",
    evidence: [logPath],
    facts: {
      gate: "targeted product contract tests",
      command: `bun test ${TESTS.join(" ")}`,
    },
  }
}
