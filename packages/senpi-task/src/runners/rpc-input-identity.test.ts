import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { RpcProcessRunner } from "./rpc-process"
import { spawnFakeChild } from "./rpc/__fixtures__/spawn-fake"

test("#given a stdio task #when initial, steer, and follow-up inputs are sent #then parsed wire identities share the durable sequence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t12-stdio-"))
  const store = createTaskRecordStore({ project_dir: dir })
  const record = createTaskRecord({
    parent_session_id: "parent", root_session_id: "parent", depth: 1,
    execution_mode: "process", model: "test/model", notify_on_terminal: false,
  })
  store.save(record)
  const log = join(dir, "commands.jsonl")
  const runner = new RpcProcessRunner({
    spawnChild: () => spawnFakeChild({ ...process.env, FAKE_COMMAND_LOG: log }),
    modelAdmission: () => Promise.resolve(), heartbeatIntervalMs: 60_000,
  })
  const handle = await runner.start({
    task_id: record.task_id, cwd: dir, taskStoreDir: store.stateDir,
    state_dir: join(store.stateDir, "children", record.task_id), prompt: "hold",
  })
  try {
    await handle.steer("first")
    await handle.followUp("second")
    const inputs: unknown[] = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line))
    const commands = inputs.filter((value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && "type" in value
      && ["prompt", "steer", "follow_up"].includes(String(value.type)))
    expect(commands.map(command => command.clientMessageId)).toEqual([
      `${record.task_id}:0:1`, `${record.task_id}:0:2`, `${record.task_id}:0:3`,
    ])
    expect(store.load(record.task_id)?.effect_seq).toBe(3)
  } finally {
    await handle.terminate()
    await handle.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
