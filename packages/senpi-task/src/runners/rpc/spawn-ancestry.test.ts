import { afterAll, afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { childOpenInput, sessionClientHarness } from "../rpc-host/session-client.test-support"
import { buildRpcSpawn } from "./spawn"

const PINNED = "2026.10.25-2"
const OLDER = "2026.10.24-3"
const ANCESTRY = { parentSessionId: "nested-parent", rootSessionId: "tree-root", taskId: "worker-task" }

const spec = {
  task_id: "worker-task",
  cwd: "/synthetic/work",
  state_dir: "/synthetic/state",
  prompt: "work",
  parent_session_id: "nested-parent",
  root_session_id: "tree-root",
}

const scratch = mkdtempSync(join(tmpdir(), "spawned-by-gate-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const harness = sessionClientHarness()
afterEach(harness.release)

/** A SENPI_BIN target: the CLI inside an installed package whose manifest carries `version`, or a bare file. */
function senpiBin(version: string | "no-manifest"): string {
  const root = mkdtempSync(join(scratch, "bin-"))
  if (version === "no-manifest") {
    const bare = join(root, "senpi")
    writeFileSync(bare, "")
    return realpathSync.native(bare)
  }
  const pkg = join(root, "node_modules", "@code-yeongyu", "senpi")
  mkdirSync(join(pkg, "dist"), { recursive: true })
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version }))
  writeFileSync(join(pkg, "dist", "cli.js"), "")
  return realpathSync.native(join(pkg, "dist", "cli.js"))
}

type Row = {
  readonly engine: string
  // The version the running engine reports (what the rpc-entry fallback launches).
  readonly running: string | undefined
  readonly bin?: string | "no-manifest"
  // What a daemon launched from the same engine answers get_protocol_info with.
  readonly host: string
  readonly accepts: boolean
}

const rows: readonly Row[] = [
  { engine: "the pinned engine", running: PINNED, host: PINNED, accepts: true },
  { engine: "an older engine", running: OLDER, host: OLDER, accepts: false },
  { engine: "a custom SENPI_BIN at an older version", running: PINNED, bin: OLDER, host: OLDER, accepts: false },
  { engine: "a custom SENPI_BIN at the pinned version", running: OLDER, bin: PINNED, host: PINNED, accepts: true },
  { engine: "an unreadable running version", running: undefined, host: "dev-build", accepts: false },
  { engine: "a custom SENPI_BIN with no readable manifest", running: PINNED, bin: "no-manifest", host: "", accepts: false },
]

test.each(rows)("CLI spawn on $engine sends --spawned-by only when the launched engine accepts it", (row) => {
  // given the engine the descriptor will actually launch
  const bin = row.bin === undefined ? undefined : senpiBin(row.bin)
  // when the child descriptor is built
  const descriptor = buildRpcSpawn(spec, {
    isBunBinary: false, isCompiledEngine: false, execPath: "/synthetic/bun", platform: "linux",
    parentEnv: bin === undefined ? {} : { SENPI_BIN: bin },
    resolveRpcEntry: () => "/synthetic/rpc-entry.js",
    engineVersion: row.running,
  })
  // then SENPI_BIN, when set, is the launch target, and the flag rides exactly when that engine accepts it
  if (bin === undefined) expect(descriptor.args[0]).toBe("/synthetic/rpc-entry.js")
  else expect(descriptor.command).toBe(bin)
  expect(descriptor.args.filter((arg) => arg === "--spawned-by")).toHaveLength(row.accepts ? 1 : 0)
  if (row.accepts) {
    const encoded = descriptor.args[descriptor.args.indexOf("--spawned-by") + 1]
    if (encoded === undefined) throw new Error("ancestry JSON missing")
    expect(JSON.parse(encoded)).toEqual(ANCESTRY)
  }
})

test.each(rows)("host open_session on $engine sends spawnedBy only when the host engine accepts it", async (row) => {
  // given a daemon reporting the engine version it runs
  const host = await harness.fakeHost({ engineVersion: row.host })
  const client = harness.hostClient(host)
  // when a child opens with its ancestry
  await client.open({ ...childOpenInput("/tmp/sessions/spawned-by.jsonl"), spawnedBy: ANCESTRY })
  // then the open still succeeds, and the field rides exactly when the host accepts it
  const open = host.commands.find((command) => command.type === "open_session")
  if (open === undefined) throw new Error("open_session missing")
  expect("spawnedBy" in open.payload).toBe(row.accepts)
  if (row.accepts) expect(open.payload.spawnedBy).toEqual(ANCESTRY)
})
