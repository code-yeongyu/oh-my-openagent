import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openDoriReplay, turnIdOf, type DoriReplay } from "./dori-replay"

const directories: string[] = []
const replays: DoriReplay[] = []
afterEach(() => {
  for (const replay of replays.splice(0)) replay.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function journalPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "dori-replay-"))
  directories.push(directory)
  return join(directory, "toolkit-replay.sqlite")
}

async function open(path: string, now: () => number = () => 1_000): Promise<DoriReplay> {
  const replay = await openDoriReplay({ path, now })
  replays.push(replay)
  return replay
}

function counted(value: unknown) {
  let calls = 0
  return { dispatch: async () => { calls += 1; return value }, calls: () => calls }
}

test("#given a recorded turn #when a fresh process replays the same calls in order #then each returns its recorded result without a second dispatch", async () => {
  const path = journalPath()
  const first = await open(path)
  const mark = counted({ kind: "ok", value: { marked: true } })
  const post = counted({ kind: "ok", value: { posted: 1 } })
  expect(await first.run("dur-a:e1", "reply.mark", mark.dispatch)).toEqual({ kind: "ok", value: { marked: true } })
  expect(await first.run("dur-a:e1", "send.post", post.dispatch)).toEqual({ kind: "ok", value: { posted: 1 } })
  first.close()
  const replay = await open(path)
  const markAgain = counted({ kind: "ok", value: { marked: "second" } })
  const postAgain = counted({ kind: "ok", value: { posted: 2 } })
  expect(await replay.run("dur-a:e1", "reply.mark", markAgain.dispatch)).toEqual({ kind: "ok", value: { marked: true } })
  expect(await replay.run("dur-a:e1", "send.post", postAgain.dispatch)).toEqual({ kind: "ok", value: { posted: 1 } })
  expect([mark.calls(), post.calls(), markAgain.calls(), postAgain.calls()]).toEqual([1, 1, 0, 0])
})

test("#given a recorded op at an index #when a replay calls a different op there #then it stops with the typed divergence and dispatches nothing", async () => {
  const path = journalPath()
  await (await open(path)).run("dur-a:e1", "reply.mark", counted({ kind: "ok", value: 1 }).dispatch)
  const replay = await open(path)
  const post = counted({ kind: "ok", value: 2 })
  expect(await replay.run("dur-a:e1", "send.post", post.dispatch)).toEqual({
    kind: "replay_stopped",
    code: "toolkit_replay_divergence",
    key: '["turn","dur-a:e1",0]',
    recorded_op: "reply.mark",
    attempted_op: "send.post",
    message: expect.stringContaining("reply.mark"),
  })
  expect(post.calls()).toBe(0)
})

test("#given two turns #when each makes calls #then call indices count per turn", async () => {
  const replay = await open(journalPath())
  await replay.run("dur-a:e1", "reply.mark", counted(1).dispatch)
  await replay.run("dur-a:e2", "send.post", counted(2).dispatch)
  const third = counted(3)
  expect(await replay.run("dur-a:e1", "send.post", third.dispatch)).toBe(3)
  expect(third.calls()).toBe(1)
})

test("#given a dispatch that throws #when it fails #then the claim is released and a retry dispatches again", async () => {
  const path = journalPath()
  const failing = await open(path)
  await expect(failing.run("dur-a:e1", "reply.mark", async () => { throw new Error("transport down") })).rejects.toThrow("transport down")
  failing.close()
  const retry = counted({ kind: "ok", value: true })
  expect(await (await open(path)).run("dur-a:e1", "reply.mark", retry.dispatch)).toEqual({ kind: "ok", value: true })
  expect(retry.calls()).toBe(1)
})

test("#given a claim whose process died before recording #when a replay reaches it #then it stops as pending instead of re-sending", async () => {
  const path = journalPath()
  const crashed = await open(path)
  let release = (): void => undefined
  const inflight = crashed.run("dur-a:e1", "reply.mark", () => new Promise((resolve) => { release = () => resolve("late") }))
  const replay = await open(path)
  const again = counted("again")
  expect(await replay.run("dur-a:e1", "reply.mark", again.dispatch)).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_pending", key: '["turn","dur-a:e1",0]' })
  expect(again.calls()).toBe(0)
  release()
  expect(await inflight).toBe("late")
})

test("#given keys older than seven days #when the journal is opened later #then they are pruned and the call dispatches again", async () => {
  const path = journalPath()
  const day = 24 * 60 * 60 * 1000
  await (await open(path, () => 0)).run("dur-a:e1", "reply.mark", counted("old").dispatch)
  const kept = counted("kept")
  expect(await (await open(path, () => 7 * day - 1)).run("dur-a:e1", "reply.mark", kept.dispatch)).toBe("old")
  const fresh = counted("fresh")
  expect(await (await open(path, () => 7 * day + 1)).run("dur-a:e1", "reply.mark", fresh.dispatch)).toBe("fresh")
  expect([kept.calls(), fresh.calls()]).toEqual([0, 1])
})

test("#given no turn identity #when a call runs #then it stops as turn_context_missing without dispatching", async () => {
  const call = counted("x")
  expect(await (await open(journalPath())).run(undefined, "reply.mark", call.dispatch)).toMatchObject({ kind: "replay_stopped", code: "turn_context_missing" })
  expect(call.calls()).toBe(0)
})

test("#given a session branch #when the turn id is derived #then it is the caller and the latest assistant entry, stable while tool results append", () => {
  const branch = [
    { type: "message", id: "u1", message: { role: "user" } },
    { type: "message", id: "a1", message: { role: "assistant" } },
  ]
  const ectx = { sessionManager: { getBranch: () => branch } }
  expect(turnIdOf("dur-a", ectx)).toBe("dur-a:a1")
  branch.push({ type: "message", id: "t1", message: { role: "toolResult" } })
  expect(turnIdOf("dur-a", ectx)).toBe("dur-a:a1")
  expect(turnIdOf("dur-a", { sessionManager: { getBranch: () => [branch[0]] } })).toBeUndefined()
  expect(turnIdOf("dur-a", {})).toBeUndefined()
})
