import { afterEach, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readTaskStoreIndex } from "@oh-my-opencode/senpi-task"
import { removeWorldDirs, sessionCtx, world } from "./host-prewarm.test-support"

afterEach(removeWorldDirs)

// Skipped on win32 like the sibling host-prewarm suites: the first-turn host resolves its shard through the POSIX
// socket layout (sun_path limit, owner-checked /tmp alternate root), which a win32 filesystem cannot host. What
// prewarm does on win32 (nothing is ensured) is pinned everywhere by host-prewarm.test.ts.
const posixPreviewTest = test.skipIf(process.platform === "win32")

function files(dir: string): unknown {
  return readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const path = join(dir, entry.name)
    return [entry.name, entry.isDirectory() ? files(path) : readFileSync(path).toString("base64")]
  })
}

posixPreviewTest("#given a first-turn task host #when its prompt is previewed #then no launcher, warm, registry, socket, lock or pid state changes", async () => {
  // given: the world's injected ensureDaemon is the process-launch boundary.
  const w = world({ prewarm: "first-turn", ensure: "reject", platform: "darwin" })
  await w.sessionStart("preview")
  const before = files(w.root)
  const registry = readTaskStoreIndex(w.indexPath)
  const mode = w.host.executionModeGate.current()
  const socket = w.host.shardSocket()
  // when
  const result = await w.pi.dispatch("before_agent_start", {
    type: "before_agent_start", systemPrompt: "BASE", preview: true,
  }, sessionCtx("preview"))
  await w.settled("preview")
  // then
  expect(result).toEqual([undefined])
  expect(w.ensures).toEqual([])
  expect(w.probes).toEqual([])
  expect(w.hostStarted(socket)).toBe(false)
  expect(await w.commandsAt(socket, "warm")).toEqual([])
  expect(existsSync(socket)).toBe(false)
  expect(readTaskStoreIndex(w.indexPath)).toEqual(registry)
  expect(w.host.executionModeGate.current()).toBe(mode)
  expect(files(w.root)).toEqual(before)
})
