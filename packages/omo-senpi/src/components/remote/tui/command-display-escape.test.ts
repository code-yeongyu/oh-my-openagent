import { describe, expect, it } from "bun:test"

import { DISPLAY_UNSAFE, ORDINARY, unsafeCodeUnits } from "@oh-my-opencode/utils/testing/display-unsafe"
import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { registerRemoteCommand } from "./command"
import type { OmoRun, OmoRunner } from "./run-omo"

type Shown = { readonly kind: "note" | "title" | "option"; readonly text: string }

const ok = (value: unknown, stderr = ""): OmoRun => ({ code: 0, stdout: `${JSON.stringify(value)}\n`, stderr })

function runner(script: Readonly<Record<string, OmoRun | Error>>): OmoRunner {
  return (args) => {
    const answer = script[args[1] ?? ""] ?? { code: 0, stdout: "{}\n", stderr: "" }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }
}

function recordingUi(picks: Array<(options: readonly string[]) => string | undefined> = [], typed?: string) {
  const shown: Shown[] = []
  let settle: (() => void) | undefined
  const notified = (count: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no note within 5000 ms")), 5_000)
      settle = () => {
        if (shown.filter((entry) => entry.kind === "note").length < count) return
        clearTimeout(timer)
        resolve()
      }
      settle()
    })
  return {
    shown,
    notified,
    ui: {
      notify: (message: string) => {
        shown.push({ kind: "note", text: message })
        settle?.()
      },
      select: (title: string, options: string[]) => {
        shown.push({ kind: "title", text: title }, ...options.map((text) => ({ kind: "option" as const, text })))
        return Promise.resolve(picks.shift()?.(options))
      },
      input: (title: string) => {
        shown.push({ kind: "title", text: title })
        return Promise.resolve(typed)
      },
    },
  }
}

async function invoke(run: OmoRunner, args: string, ui: ReturnType<typeof recordingUi>["ui"]): Promise<void> {
  const pi = new FakeExtensionAPI()
  registerRemoteCommand(pi, { run })
  const command = pi.commands.find((entry) => entry.name === "remote")
  if (command === undefined) throw new Error("/remote is not registered")
  await (command.options["handler"] as (args: string, ctx: unknown) => Promise<void>)(args, { ui })
}

const devices = (value: string) => [{ id: value, name: value, online: true, self: false }]
const sessions = (value: string) => ({
  rows: [{ thread: value, title: value, state: value }],
  unanswered: [{ id: "u", name: value }],
})

async function everyShown(value: string): Promise<Shown[]> {
  const all: Shown[] = []
  const scenario = async (
    script: Readonly<Record<string, OmoRun | Error>>,
    args: string,
    picks: Array<(options: readonly string[]) => string | undefined> = [],
    notes = 1,
  ) => {
    const recorder = recordingUi(picks, value)
    await invoke(runner(script), args, recorder.ui)
    await recorder.notified(notes)
    all.push(...recorder.shown)
  }
  const first = (options: readonly string[]) => options[0]
  const second = (options: readonly string[]) => options[1]
  const attach = (options: readonly string[]) => options.find((option) => option.startsWith("Attach"))
  const closeIt = (options: readonly string[]) => options.find((option) => option === "Close")
  await scenario({ devices: ok(devices(value), value) }, "devices", [], 2)
  await scenario({ sessions: ok(sessions(value)) }, "sessions")
  await scenario(
    { status: ok({ state: value, enabled: true, device: { name: value }, detail: { action: value } }) },
    "status",
  )
  await scenario({ open: ok({ thread: value, device: value }) }, "open x")
  await scenario({ model: ok({ model: { provider: value, id: value } }) }, "model x")
  await scenario({ close: ok({ closed: false, dropped_deliveries: [value] }) }, "close x")
  await scenario({ enable: ok({ other: value }) }, "enable")
  await scenario({ send: ok({ reply: `${value}\nline ${value}` }) }, "send x hello", [], 2)
  await scenario({ send: ok({ queue_position: 1 }) }, "send x hello", [], 2)
  await scenario(
    {
      interrupt: {
        code: 1,
        stdout: `${JSON.stringify({ kind: "error", error: { message: value, next_action: value } })}\n`,
        stderr: "",
      },
    },
    "interrupt x",
  )
  await scenario(
    { interrupt: { code: 1, stdout: `${JSON.stringify({ kind: "error", message: value })}\n`, stderr: "" } },
    "interrupt x",
  )
  await scenario({ interrupt: { code: 2, stdout: "", stderr: `${value}\n${value}` } }, "interrupt x")
  await scenario({ enable: { code: 3, stdout: `${JSON.stringify({ notice: value })}\n`, stderr: "" } }, "enable")
  await scenario({ interrupt: new Error(value) }, "interrupt x")
  await scenario({ send: new Error(value) }, "send x hello", [], 2)
  await scenario({ devices: { code: 0, stdout: `not json ${value}\n`, stderr: "" } }, "", [])
  await scenario({ devices: ok(devices(value)), sessions: ok(sessions(value)) }, "", [first, second, attach])
  await scenario(
    {
      devices: ok(devices(value)),
      sessions: ok(sessions(value)),
      close: {
        code: 1,
        stdout: `${JSON.stringify({ kind: "error", error: { message: value, details: { pending_deliveries: [value] } } })}\n`,
        stderr: "",
      },
    },
    "",
    [first, second, closeIt, () => undefined],
  )
  return all
}

describe("/remote display escaping", () => {
  it("#given every display fixture in every answer field #when /remote renders notes, titles and options #then no line carries a listed code unit", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      for (const entry of await everyShown(fixture)) {
        for (const line of entry.text.split("\n"))
          expect({ fixture, kind: entry.kind, units: unsafeCodeUnits(line) }).toEqual({
            fixture,
            kind: entry.kind,
            units: [],
          })
      }
    }
  })

  it("#given ordinary text in every answer field #when /remote renders #then it appears unchanged", async () => {
    for (const text of ORDINARY) {
      const shown = (await everyShown(text)).map((entry) => entry.text).join("\n")
      expect(shown.split(text).length - 1).toBeGreaterThanOrEqual(20)
    }
  })

  it("#given a picked row #when it is sent to #then the omo argv still carries the raw value", async () => {
    for (const fixture of DISPLAY_UNSAFE.slice(0, 3)) {
      const calls: string[][] = []
      const run: OmoRunner = (args) => {
        calls.push([...args])
        if (args[1] === "devices") return Promise.resolve(ok(devices("dev")))
        if (args[1] === "sessions") return Promise.resolve(ok(sessions(fixture)))
        return Promise.resolve(ok({ reply: "done" }))
      }
      const recorder = recordingUi(
        [(options) => options[0], (options) => options[1], (options) => options.find((o) => o.startsWith("Send"))],
        "hi",
      )
      await invoke(run, "", recorder.ui)
      await recorder.notified(2)
      expect(calls.find((args) => args[1] === "send")).toEqual(["remote", "send", "--json", fixture, "--", "hi"])
    }
  })
})
