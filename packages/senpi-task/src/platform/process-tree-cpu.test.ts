import { describe, expect, test } from "bun:test"
import { type ProcessTable, sumProcessTreeCpuSeconds } from "./process-tree-cpu"

const ENGINE = 4100
const ENGINE_CHILD = 4200
const ENGINE_GRANDCHILD = 4300
const RUNNER = 3000
const RUNNER_WORKER = 3100

function table(rows: ReadonlyArray<{ pid: number; parent: number; cpu: number; start: bigint }>): ProcessTable {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  return {
    parents: new Map(rows.map((row) => [row.pid, row.parent])),
    cpuSeconds: (pid) => byPid.get(pid)?.cpu ?? null,
    startTime: (pid) => byPid.get(pid)?.start ?? null,
  }
}

// The startup CPU cap reads the engine child's tree. Windows keeps a process's creation-time parent pid after that
// parent exits and reuses pids, so a test runner started minutes earlier by a since-exited parent whose pid the engine
// now holds names the engine as its parent. Its lifetime CPU must not count, or a 3 s old engine trips the 120 s cap
// (#13953: 231.3 s reported for a child 1.5 s into its boot).
describe("sumProcessTreeCpuSeconds", () => {
  test("#given a long-lived process naming the engine's reused pid as its parent #when the engine's tree is summed #then only processes born after their parent count", () => {
    // given
    const processes = table([
      { pid: ENGINE, parent: 1, cpu: 2.5, start: 1_000n },
      { pid: ENGINE_CHILD, parent: ENGINE, cpu: 0.4, start: 1_010n },
      { pid: ENGINE_GRANDCHILD, parent: ENGINE_CHILD, cpu: 0.1, start: 1_020n },
      { pid: RUNNER, parent: ENGINE, cpu: 215, start: 10n },
      { pid: RUNNER_WORKER, parent: RUNNER, cpu: 13.3, start: 20n },
    ])

    // when
    const total = sumProcessTreeCpuSeconds(ENGINE, processes)

    // then
    expect(total).toBe(3)
  })

  test("#given a child whose start stamp equals its parent's #when the tree is summed #then it counts", () => {
    // given: darwin stamps are whole seconds, so a child spawned in its parent's first second carries the same stamp;
    // only a stamp strictly earlier than the parent's proves a stale parent pid
    const processes = table([
      { pid: ENGINE, parent: 1, cpu: 0.2, start: 1_000n },
      { pid: ENGINE_CHILD, parent: ENGINE, cpu: 1.3, start: 1_000n },
    ])

    // when
    const total = sumProcessTreeCpuSeconds(ENGINE, processes)

    // then
    expect(total).toBe(1.5)
  })

  test("#given a descendant whose start time cannot be read #when the tree is summed #then its CPU still counts", () => {
    // given: an unreadable stamp is not proof of a stale parent, and dropping it would undercount a booting engine
    const processes: ProcessTable = {
      ...table([{ pid: ENGINE, parent: 1, cpu: 0.2, start: 1_000n }]),
      parents: new Map([
        [ENGINE, 1],
        [ENGINE_CHILD, ENGINE],
      ]),
      cpuSeconds: (pid) => (pid === ENGINE ? 0.2 : pid === ENGINE_CHILD ? 1.3 : null),
    }

    // when
    const total = sumProcessTreeCpuSeconds(ENGINE, processes)

    // then
    expect(total).toBe(1.5)
  })
})
