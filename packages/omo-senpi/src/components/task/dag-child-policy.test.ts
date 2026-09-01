import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildRpcSpawn } from "@oh-my-opencode/senpi-task"

const tempDirs: string[] = []
const OMO_EXTENSION = "/opt/omo/plugin/extensions/omo.js"
const PROVIDER_EXTENSION = "/tmp/mock-provider.ts"

function rpcSpec(owner?: object) {
  const stateRoot = mkdtempSync(join(tmpdir(), "omo-senpi-dag-rpc-policy-"))
  tempDirs.push(stateRoot)
  const taskId = owner === undefined ? "st_plain_rpc" : "st_dag_rpc"
  const stateDir = join(stateRoot, "children", taskId)
  mkdirSync(join(stateRoot, "tasks"), { recursive: true })
  writeFileSync(join(stateRoot, "tasks", `${taskId}.json`), `${JSON.stringify({
    task_id: taskId,
    ...(owner === undefined ? {} : { owner }),
  })}\n`)
  return {
    task_id: taskId,
    cwd: stateRoot,
    state_dir: stateDir,
    prompt: "do the work",
    extensions: [OMO_EXTENSION, PROVIDER_EXTENSION],
  }
}

function spawnArgs(spec: ReturnType<typeof rpcSpec>): readonly string[] {
  return buildRpcSpawn(spec, {
    isBunBinary: false,
    execPath: "/usr/bin/node",
    platform: "linux",
    parentEnv: {},
    resolveRpcEntry: () => "/pkg/@code-yeongyu/senpi/dist/rpc-entry.js",
    resolveSenpiExecutable: () => null,
  }).args
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("DAG child rpc extension policy", () => {
  test("#given DAG-owned and ordinary rpc tasks #when child spawn args are built #then only the DAG child drops omo-senpi", () => {
    // given
    const dag = rpcSpec({ kind: "dag", runId: "run-1", nodeId: "node-1", fingerprint: "fp-1" })
    const plain = rpcSpec()

    // when
    const dagArgs = spawnArgs(dag)
    const plainArgs = spawnArgs(plain)

    // then
    expect(dagArgs).not.toContain(OMO_EXTENSION)
    expect(dagArgs).toContain(PROVIDER_EXTENSION)
    expect(plainArgs).toContain(OMO_EXTENSION)
    expect(plainArgs).toContain(PROVIDER_EXTENSION)
  })
})
