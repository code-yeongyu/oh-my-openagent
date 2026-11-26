import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Captures what the SHIPPED thread SDK answers for its control refusals, at a named base commit, into the fixture
// packages/omo-senpi/src/components/thread/sdk-control-refusals.shipped.json that sdk-control-refusals.test.ts compares
// the facade with byte for byte. Run: bun script/capture-shipped-thread-refusals.ts [--base <commit>] (default dev
// cab771c006). The base is checked out into a scratch worktree, the calls run against its own source there, and the
// worktree is removed afterwards.

const REPO = resolve(import.meta.dir, "..")
const FIXTURE = join(REPO, "packages/omo-senpi/src/components/thread/sdk-control-refusals.shipped.json")
const DEFAULT_BASE = "cab771c006"

const CALLS = `
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGatewayStore } from "./packages/omo-senpi/src/components/thread/gateway/store"
import { createThreadSdk } from "./packages/omo-senpi/src/components/thread/sdk"

const unused = async () => { throw new Error("not used") }
const host = {
  socket: "/tmp/capture-legacy.sock",
  listSessions: async () => [],
  listView: async () => ({ sessions: [], hosts: [], disk: [] }),
  openSession: unused, getMessages: unused, getState: unused, prompt: unused, interrupt: unused,
  setSessionName: unused, setModel: unused, getAvailableModels: unused, setThinkingLevel: unused,
  getAvailableThinkingLevels: unused,
  gateway: { wake: async () => ({ admitted: [] }), releaseSession: unused },
}
const agentDir = mkdtempSync(join(tmpdir(), "capture-controls-"))
const store = createGatewayStore({ agentDir })
const sdk = createThreadSdk({ agentDir, cwd: process.cwd(), uid: 501, user: "qa-user", host, store, firstPromptWaitMs: 0 })
const answers = {
  interrupt: await sdk.interrupt({ thread: "self" }),
  closeSelf: await sdk.close({ thread: "self" }),
  closeDefault: await sdk.close({}),
  renameSelf: await sdk.rename({ thread: "self", name: "mine" }),
  renameDefault: await sdk.rename({ name: "mine" }),
  setModel: await sdk.set_model({ thread: "self", model: "opus" }),
  interruptMissing: await sdk.interrupt({ thread: "nope-thread" }),
  closeMissing: await sdk.close({ thread: "nope-thread" }),
  renameMissing: await sdk.rename({ thread: "nope-thread", name: "mine" }),
  setModelMissing: await sdk.set_model({ thread: "nope-thread", model: "opus" }),
  interruptBogus: await sdk.interrupt({ thread: "self", bogus: 1 }),
  releaseNoEndpoint: await sdk.release({ thread_id: "dur-x", title: "x", cwd: "/w", status: "live", session_path: null, endpoint: null, surface: null, alive: true, device: "studio", address: "studio/dur-x" }, { interrupt: false }),
}
await sdk.dispose()
await store.dispose()
rmSync(agentDir, { recursive: true, force: true })
console.log(JSON.stringify(answers))
`

const git = (...args: string[]): string => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim()

function linkDependencies(tree: string): void {
  symlinkSync(join(REPO, "node_modules"), join(tree, "node_modules"))
  for (const name of readdirSync(join(REPO, "packages"))) {
    const modules = join(REPO, "packages", name, "node_modules")
    if (existsSync(modules) && existsSync(join(tree, "packages", name)))
      symlinkSync(modules, join(tree, "packages", name, "node_modules"))
  }
}

const baseIndex = process.argv.indexOf("--base")
const base = git("rev-parse", baseIndex < 0 ? DEFAULT_BASE : (process.argv[baseIndex + 1] ?? DEFAULT_BASE))
const tree = join(mkdtempSync(join(tmpdir(), "shipped-refusals-")), "tree")
git("worktree", "add", "--detach", tree, base)
try {
  linkDependencies(tree)
  writeFileSync(join(tree, "capture-calls.ts"), CALLS)
  const output = execFileSync(process.execPath, ["capture-calls.ts"], { cwd: tree, encoding: "utf8" })
  const answers = JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>
  const command = "bun script/capture-shipped-thread-refusals.ts --base " + base
  writeFileSync(FIXTURE, `${JSON.stringify({ base, command, count: Object.keys(answers).length, answers }, null, 2)}\n`)
  console.log(`wrote ${Object.keys(answers).length} answers captured at ${base} to ${FIXTURE}`)
} finally {
  git("worktree", "remove", "--force", tree)
  rmSync(resolve(tree, ".."), { recursive: true, force: true })
}
