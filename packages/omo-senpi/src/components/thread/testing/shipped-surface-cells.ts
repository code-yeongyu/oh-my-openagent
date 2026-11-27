import { setSystemTime } from "bun:test"
import { basename } from "node:path"

import { sdkOn, type Cleanups } from "../address/testing/entries"
import { createTwoDevices, NAMES, T, type TwoDeviceOptions } from "../address/testing/two-devices"

// The design lane's class check on T1a (ruling of record, 14:39Z): every entry of the shipped thread surface a caller can
// reach today, crossed with the fixture's situations, answered at the dev branch tip and at the head. The same cells run
// in both trees; the dev answers are committed (shipped-surface.dev.json) and shipped-surface.diff.test.ts compares.

type Td = ReturnType<typeof createTwoDevices>
type Call = (td: Td, cleanups: Cleanups) => Promise<unknown>
export type Cell = { readonly key: string; readonly setup: TwoDeviceOptions; readonly call: Call }

const ADDRESSES: Readonly<Record<string, string>> = {
  "here live": T.hereLive,
  "another live here": T.hereSlash,
  "b live": T.bLive,
  missing: T.nowhere,
  "name two threads share": NAMES.shared,
  "ended here": T.hereEnded,
  "ended on b": T.bEnded,
}

const tool =
  (name: Parameters<Td["run"]>[0], params: (thread: string) => Record<string, unknown>): ((thread: string) => Call) =>
  (thread) =>
  async (td) =>
    await td.run(name, params(thread))

const sdk =
  (member: string, input: (thread: string) => Record<string, unknown>): ((thread: string) => Call) =>
  (thread) =>
  async (td, cleanups) => {
    const surface = sdkOn(td, cleanups) as unknown as Record<string, (request: unknown) => Promise<unknown>>
    const call = surface[member]
    return call === undefined ? "absent" : await call(input(thread))
  }

const twice =
  (once: (thread: string) => Call): ((thread: string) => Call) =>
  (thread) =>
  async (td, cleanups) => [await once(thread)(td, cleanups), await once(thread)(td, cleanups)]

const HORIZON_MS = 30 * 86_400_000

const pastHorizon =
  (once: (thread: string) => Call): ((thread: string) => Call) =>
  (thread) =>
  async (td, cleanups) => {
    const start = Date.now()
    setSystemTime(start)
    try {
      const first = await once(thread)(td, cleanups)
      setSystemTime(start + HORIZON_MS + 1)
      return [first, await once(thread)(td, cleanups)]
    } finally {
      setSystemTime()
    }
  }

const BY_ADDRESS: Readonly<Record<string, (thread: string) => Call>> = {
  "tool thread_read": tool("thread_read", (thread) => ({ thread })),
  "tool thread_send": tool("thread_send", (thread) => ({ thread, message: "x" })),
  "tool thread_send keyed twice": twice(
    tool("thread_send", (thread) => ({ thread, message: "x", idempotency_key: "k" })),
  ),
  "tool thread_send keyed past the horizon": pastHorizon(
    tool("thread_send", (thread) => ({ thread, message: "x", idempotency_key: "k" })),
  ),
  "tool thread_handoff": tool("thread_handoff", (thread) => ({ thread, message: "x" })),
  "tool thread_interrupt": tool("thread_interrupt", (thread) => ({ thread })),
  "tool thread_close": tool("thread_close", (thread) => ({ thread })),
  "tool thread_rename": tool("thread_rename", (thread) => ({ thread, name: "renamed" })),
  "tool thread_set_model": tool("thread_set_model", (thread) => ({ thread, model: "anthropic/claude-opus" })),
  "tool thread_set_reasoning": tool("thread_set_reasoning", (thread) => ({ thread, level: "high" })),
  "tool thread_create existing": tool("thread_create", (thread) => ({ thread })),
  "sdk read": sdk("read", (thread) => ({ thread })),
  "sdk send": sdk("send", (thread) => ({ thread, text: "x" })),
  "sdk send keyed twice": twice(sdk("send", (thread) => ({ thread, text: "x", idempotency_key: "k" }))),
  "sdk send keyed past the horizon": pastHorizon(
    sdk("send", (thread) => ({ thread, text: "x", idempotency_key: "k" })),
  ),
  "sdk locate": sdk("locate", (thread) => ({ thread })),
  "sdk interrupt": sdk("interrupt", (thread) => ({ thread })),
  "sdk close": sdk("close", (thread) => ({ thread })),
  "sdk rename": sdk("rename", (thread) => ({ thread, name: "renamed" })),
  "sdk release": sdk("release", (thread) => ({ thread })),
}

const STEERS: readonly Cell[] = (["another live here", "b live"] as const).flatMap((where) =>
  (["running turn 7", "idle"] as const).flatMap((state) =>
    (["with turn 7", "without a turn id"] as const).flatMap((turn) => {
      const thread = ADDRESSES[where] ?? ""
      const running = state === "running turn 7"
      const setup = where === "b live" && running ? { bRunning: true } : {}
      const here = where === "another live here" && running ? { runningTurn: "7" } : {}
      const toolTurn = turn === "with turn 7" ? { expected_turn_id: "7" } : {}
      const sdkTurn = turn === "with turn 7" ? { expected_turn_id: 7 } : {}
      return [
        {
          key: `tool thread_send steer ${turn}, target ${state} | ${where}`,
          setup,
          call: tool("thread_send", () => ({ thread, message: "x", delivery: "steer", ...toolTurn }))(thread),
        },
        {
          key: `sdk send steer ${turn}, target ${state} | ${where}`,
          setup,
          call: async (td: Td, cleanups: Cleanups) =>
            await sdkOn(td, cleanups, here).send({ thread, text: "x", mode: "steer", ...sdkTurn }),
        },
      ]
    }),
  ),
)

export const CELLS: readonly Cell[] = [
  { key: "tool thread_list | -", setup: {}, call: async (td) => await td.run("thread_list", {}) },
  {
    key: "tool thread_list all_scope | -",
    setup: {},
    call: async (td) => await td.run("thread_list", { all_scope: true }),
  },
  { key: "sdk list | -", setup: {}, call: sdk("list", () => ({}))("") },
  { key: "sdk list all_scope | -", setup: {}, call: sdk("list", () => ({ all_scope: true }))("") },
  ...Object.entries(BY_ADDRESS).flatMap(([entry, call]) =>
    Object.entries(ADDRESSES).map(([where, thread]) => ({ key: `${entry} | ${where}`, setup: {}, call: call(thread) })),
  ),
  ...STEERS,
]

/** One cell on a fresh fixture: its answer, or the thrown error's message. */
export async function runCell(cell: Cell): Promise<unknown> {
  const cleanups: Cleanups = []
  const td = createTwoDevices({ ...cell.setup, sessionFiles: true })
  cleanups.push(td.cleanup)
  try {
    return await cell.call(td, cleanups)
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const FIXTURE_IDS = new Set<string>(Object.values(T))
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g

/** Paths, the ids a run draws and the times it reads become placeholders; the fixture's own ids stay. */
export function normalize(answer: unknown, cwd: string): unknown {
  const text = JSON.stringify(answer ?? null)
    .split(cwd)
    .join("<cwd>")
    // A whole string value equal to the directory's name only: a key (a string followed by a colon) or a longer value
    // that starts with it is kept (review of 5774980bda, LOW 4: run from a directory named "source", every "source" key
    // became <cwd-name>).
    .replace(new RegExp(`"${basename(cwd).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"(?!:)`, "g"), '"<cwd-name>"')
    .split(`[${basename(cwd)}]`)
    .join("[<cwd-name>]")
    .replace(/\/tmp\/[A-Za-z0-9._/-]+/g, "<tmp>")
    .replace(UUID, (id) => (FIXTURE_IDS.has(id) ? id : "<id>"))
    .replace(ISO, "<time>")
    .replace(/"(?:created_at|updated_at|updatedAt|receipt_expires_at|at|ts)":\d{10,}/g, (m) =>
      m.replace(/\d+$/, "<ms>"),
    )
  return JSON.parse(text)
}
