import { describe, expect, test } from "bun:test"

import { DISPLAY_UNSAFE, ORDINARY, unsafeCodeUnits } from "@oh-my-opencode/utils/testing/display-unsafe"
import { loadThreadSdk, runThreadCommand } from "../bin/lib/thread.js"
import { humanLines } from "../bin/lib/thread-output.js"

function capture() {
  const chunks: string[] = []
  return { write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

async function run(args: readonly string[], answers: Record<string, unknown>) {
  const stdout = capture()
  const stderr = capture()
  const method = (name: string) => async (request: unknown) => answers[name] ?? { kind: "ok", method: name, request }
  const sdk = {
    ...Object.fromEntries(["list", "read", "send"].map((name) => [name, method(name)])),
    principal: "cli:501",
    dispose: async () => {},
  }
  await runThreadCommand([...args], {
    engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    pluginRoot: "/plugin",
    agentDir: "/agent",
    env: {},
    cwd: "/work",
    stdout,
    stderr,
    platform: "darwin",
    loadSqlite: async () => ({}),
    importSdk: async () => ({ createThreadSdk: () => sdk }),
    identity: { uid: 501, user: "qa" },
  })
  return { stdout: stdout.text(), stderr: stderr.text() }
}

const linesOf = (text: string): string[] => text.replace(/\n$/, "").split("\n")

const listResult = (value: string) => ({
  kind: "ok",
  scope: "workspace",
  threads: [
    { thread: value, surface: value, state: value, name: value, cwd: value, device: "dev-b" },
    { thread: "t2", surface: "tui", status: value, name: "", cwd: "/w", device: value },
  ],
  devices: [
    { device: "dev-b", name: value, platform: value, online: true, threads: 1, this_device: false },
    { device: value, name: value, platform: "linux", online: false, threads: 2, listing: "incomplete" },
  ],
  remote_unavailable: value,
})

const sendResult = (value: string) => ({
  kind: "ok",
  delivery: { kind: value },
  delivery_id: value,
  thread: value,
  deduplicated: true,
})

const readResult = (value: string) => ({
  kind: "ok",
  items: [
    { role: value, content: `${value}\nsecond ${value}` },
    { role: "assistant", content: value },
  ],
  truncated: true,
  next_cursor: value,
})

const closeResult = (value: string) => ({
  kind: "ok",
  closed: true,
  thread: value,
  graceful: { turn: value, waited_ms: value },
  dropped_deliveries: [value, value],
})

const RESULTS = { list: listResult, send: sendResult, read: readResult, close: closeResult } as const

describe("omo thread human output", () => {
  test("#given every display fixture in every human field #when the lines are built #then no line carries a listed code unit", () => {
    for (const fixture of DISPLAY_UNSAFE) {
      for (const [name, build] of Object.entries(RESULTS)) {
        const lines = humanLines(name, build(fixture)).flatMap((line: string) => line.split("\n"))
        for (const line of lines)
          expect({ name, fixture, units: unsafeCodeUnits(line) }).toEqual({ name, fixture, units: [] })
      }
    }
  })

  test("#given read content with a line feed #when the lines are built #then the line feed is kept as a line break", () => {
    const [first] = humanLines("read", { kind: "ok", items: [{ role: "user", content: "one\ntwo" }], truncated: false })
    expect(first).toBe("[user] one\ntwo")
  })

  test("#given ordinary text in every human field #when the lines are built #then it appears unchanged", () => {
    for (const text of ORDINARY) {
      for (const [name, build] of Object.entries(RESULTS)) {
        expect(humanLines(name, build(text)).join("\n")).toContain(text)
      }
    }
  })

  test("#given a fixture-bearing result #when printed with --json #then stdout is the result's JSON unchanged", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const answer = readResult(fixture)
      const { stdout } = await run(["read", "t1", "--json"], { read: answer })
      expect(stdout).toBe(`${JSON.stringify(answer)}\n`)
    }
  })
})

describe("omo thread error lines", () => {
  test("#given a refusal carrying a fixture #when printed #then the stderr lines carry no listed code unit and --json stdout is unchanged", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const answer = { kind: "error", error: { code: fixture, message: fixture, next_action: fixture } }
      const human = await run(["read", "t1"], { read: answer })
      for (const line of linesOf(human.stderr))
        expect({ fixture, units: unsafeCodeUnits(line) }).toEqual({ fixture, units: [] })
      const json = await run(["read", "t1", "--json"], { read: answer })
      expect(json.stdout).toBe(`${JSON.stringify(answer)}\n`)
    }
  })

  test("#given a usage refusal naming a fixture value #when printed #then the stderr line is escaped and the --json message keeps the value", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const human = await run(["list", "--state", fixture], {})
      for (const line of linesOf(human.stderr))
        expect({ fixture, units: unsafeCodeUnits(line) }).toEqual({ fixture, units: [] })
      const json = await run(["list", "--state", fixture, "--json"], {})
      const parsed = JSON.parse(linesOf(json.stdout)[0] ?? "{}") as { error?: { message?: string } }
      expect(parsed.error?.message).toContain(fixture)
    }
  })

  test("#given a refusal with ordinary text #when printed #then the text appears unchanged", async () => {
    for (const text of ORDINARY) {
      const human = await run(["read", "t1"], {
        read: { kind: "error", error: { code: "not_found", message: text, next_action: text } },
      })
      expect(human.stderr).toContain(text)
    }
  })
})

describe("omo thread diagnostic lines", () => {
  test("#given a gateway store whose close fails with each fixture #when a command finishes #then the diagnostic line holds no unsafe unit", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const stderr = capture()
      await runThreadCommand(["list"], {
        engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
        pluginRoot: "/plugin",
        agentDir: "/agent",
        env: {},
        cwd: "/work",
        stdout: capture(),
        stderr,
        platform: "darwin",
        loadSqlite: async () => ({}),
        importSdk: async () => ({
          createThreadSdk: () => ({
            list: async () => ({ kind: "ok", scope: "workspace", threads: [] }),
            principal: "cli:501",
            dispose: async () => {
              throw new Error(fixture)
            },
          }),
        }),
        identity: { uid: 501, user: "qa" },
      })
      for (const line of linesOf(stderr.text())) expect(unsafeCodeUnits(line)).toEqual([])
      expect(stderr.text()).toContain("closing the gateway store failed")
    }
  })

  test("#given a thread client that fails to load with each fixture #when the SDK loads #then the diagnostic line holds no unsafe unit", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const stderr = capture()
      await loadThreadSdk({
        pluginRoot: "/plugin",
        agentDir: "/agent",
        env: {},
        cwd: "/work",
        stderr,
        reinstall: fixture,
        loadSqlite: async () => ({}),
        importSdk: async () => ({ createThreadSdk: () => ({ dispose: async () => {} }) }),
        importThreadClient: async () => {
          throw new Error(fixture)
        },
        identity: { uid: 501, user: "qa" },
      })
      for (const line of linesOf(stderr.text())) expect(unsafeCodeUnits(line)).toEqual([])
      expect(stderr.text()).toContain("could not be loaded")
    }
  })
})
