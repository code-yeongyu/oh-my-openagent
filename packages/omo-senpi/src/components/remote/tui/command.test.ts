import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../../test-support/fake-extension-api"
import { COMMAND_DEADLINE_MS, registerRemoteCommand, SEND_DEADLINE_MS } from "./command"
import type { OmoRun, OmoRunner, OmoRunOptions } from "./run-omo"

const DEVICES = [
  { device: "dev_mac", label: "mengmota-mac", kind: "desktop", platform: "darwin", last_seen_ms: 1, online: true },
  { device: "dev_ny2", label: "ny2", kind: "server", platform: "linux", last_seen_ms: null, online: false },
]
const LISTING = {
  query_id: "q1",
  revision: 1,
  incomplete: [],
  devices: {},
  rows: [
    {
      device: "dev_mac",
      session_id: "s1",
      title: "fix the build",
      project: "omo",
      path: "/w/omo",
      state: "running",
      updated_ms: 1,
      source: "live",
      as_of: 1,
    },
  ],
}

// The one-module CLI (#13414 part 4c) prints the person client's values: DeviceRow {id,name,self,caps}, SessionsList
// {rows: SessionRow {thread,...}, unanswered: DeviceRow[]}, OpenResult {thread, device} and a flat RemoteFailure.
const MODULE_SELF = {
  id: "dev_mac",
  name: "mengmota-mac",
  kind: "cli",
  platform: "darwin",
  online: true,
  last_seen_ms: 1,
  self: true,
  caps: { attach: true, machine: false, control: true },
}
const MODULE_SEOUL = { ...MODULE_SELF, id: "dev_seoul", name: "seoul", platform: "linux", self: undefined }
const MODULE_NY2 = { ...MODULE_SEOUL, id: "dev_ny2", name: "ny2", online: false }
const MODULE_LIST = {
  revision: 2,
  unanswered: [MODULE_NY2],
  rows: [
    {
      thread: "dev_seoul/s7",
      name: "s7",
      title: "nightly",
      device: MODULE_SEOUL,
      project: "omo",
      path: "/w/omo",
      state: "idle",
      archived: false,
      updated_ms: 1,
      source: "live",
    },
  ],
}

type Answer = OmoRun | Promise<OmoRun>

function fakeRunner(
  script: Readonly<Record<string, Answer>>,
): OmoRunner & { readonly calls: string[][]; readonly options: OmoRunOptions[] } {
  const calls: string[][] = []
  const options: OmoRunOptions[] = []
  const run = (args: readonly string[], runOptions: OmoRunOptions) => {
    calls.push([...args])
    options.push(runOptions)
    return Promise.resolve(script[args[1] ?? ""] ?? { code: 0, stdout: "{}\n", stderr: "" })
  }
  return Object.assign(run, { calls, options })
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const WAIT_MS = 5_000

// Resolves with the first note whose message passes `match`; subscribed before the action that produces it.
function nextNote(ui: FakeUi, match: (message: string) => boolean): Promise<FakeUi["notes"][number]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no matching note within ${WAIT_MS} ms`)), WAIT_MS)
    const notify = ui.notify
    ui.notify = (message, type) => {
      notify(message, type)
      if (!match(message)) return
      clearTimeout(timer)
      resolve({ message, type })
    }
  })
}

const ok = (value: unknown): OmoRun => ({ code: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" })

interface FakeUi {
  readonly notes: Array<{ readonly message: string; readonly type: string | undefined }>
  readonly selects: string[][]
  notify(message: string, type?: "info" | "warning" | "error"): void
  select(title: string, options: string[]): Promise<string | undefined>
  input(title: string): Promise<string | undefined>
}

function fakeUi(picks: Array<(options: readonly string[]) => string | undefined> = [], typed?: string): FakeUi {
  const notes: FakeUi["notes"][number][] = []
  const selects: string[][] = []
  return {
    notes,
    selects,
    notify: (message, type) => notes.push({ message, type }),
    select: (_title, options) => {
      selects.push(options)
      return Promise.resolve(picks.shift()?.(options))
    },
    input: () => Promise.resolve(typed),
  }
}

async function invoke(
  run: OmoRunner | undefined,
  args: string,
  ui: FakeUi,
  pi = new FakeExtensionAPI(),
): Promise<void> {
  registerRemoteCommand(pi, run === undefined ? { env: {} } : { run })
  const command = pi.commands.find((entry) => entry.name === "remote")
  if (command === undefined) throw new Error("/remote is not registered")
  const handler = command.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  await handler(args, { ui })
}

describe("/remote", () => {
  it("#given the component registers #when inspecting the api #then /remote exists", () => {
    // given
    const pi = new FakeExtensionAPI()

    // when
    registerRemoteCommand(pi, { env: {} })

    // then
    expect(pi.commands.map((entry) => entry.name)).toEqual(["remote"])
  })

  it("#given two devices #when /remote devices runs #then one omo remote devices --json process runs and each device is listed with its state", async () => {
    // given
    const run = fakeRunner({ devices: ok(DEVICES) })
    const ui = fakeUi()

    // when
    await invoke(run, "devices", ui)

    // then
    expect(run.calls).toEqual([["remote", "devices", "--json"]])
    const printed = ui.notes.map((note) => note.message).join("\n")
    expect(printed).toContain("mengmota-mac")
    expect(printed).toContain("online")
    expect(printed).toContain("ny2")
    expect(printed).toContain("offline")
  })

  it("#given filters #when /remote sessions runs #then the flags pass through and each row names <device>/<session>", async () => {
    // given
    const run = fakeRunner({ sessions: ok(LISTING) })
    const ui = fakeUi()

    // when
    await invoke(run, "sessions --device dev_mac --state running", ui)

    // then
    expect(run.calls).toEqual([["remote", "sessions", "--device", "dev_mac", "--state", "running", "--json"]])
    expect(ui.notes.map((note) => note.message).join("\n")).toContain("dev_mac/s1")
  })

  it("#given a text that starts with -- #when /remote send runs #then the text is sent verbatim after the -- terminator", async () => {
    // given
    const run = fakeRunner({
      send: ok({ kind: "ok", thread: "s1", device: "dev_mac", delivery: { kind: "started" }, reply: "done." }),
    })
    const ui = fakeUi()
    const reply = nextNote(ui, (message) => message.includes("done."))

    // when
    await invoke(run, "send dev_mac/s1 --steer  keep   going", ui)

    // then
    expect(run.calls).toEqual([["remote", "send", "--json", "dev_mac/s1", "--", "--steer  keep   going"]])
    expect(await reply).toEqual({ message: "dev_mac/s1:\ndone.", type: "info" })
  })

  it("#given a remote turn still running #when /remote send runs #then the command returns before the reply and the reply shows when it lands", async () => {
    // given
    const answer = deferred<OmoRun>()
    const run = fakeRunner({ send: answer.promise })
    const ui = fakeUi()

    // when
    await invoke(run, "send dev_mac/s1 hello", ui)
    const reply = nextNote(ui, (message) => message.includes("later"))
    const notesBeforeReply = ui.notes.length
    answer.resolve(ok({ kind: "ok", thread: "s1", delivery: { kind: "started" }, reply: "later" }))

    // then
    expect(notesBeforeReply).toBe(1)
    expect(ui.notes[0]?.type).toBe("info")
    expect(run.options[0]?.deadlineMs).toBe(SEND_DEADLINE_MS)
    expect((await reply).message).toBe("dev_mac/s1:\nlater")
  })

  it("#given a send waiting for its reply #when the session shuts down #then the send's process signal is aborted", async () => {
    // given
    const answer = deferred<OmoRun>()
    const run = fakeRunner({ send: answer.promise })
    const pi = new FakeExtensionAPI()
    await invoke(run, "send dev_mac/s1 hello", fakeUi(), pi)
    const signal = run.options[0]?.signal

    // when
    await pi.dispatch("session_shutdown", {})

    // then
    expect(signal?.aborted).toBe(true)
    answer.resolve({ code: null, stdout: "", stderr: "", ended: "aborted" })
  })

  it("#given a send whose reply did not come within its deadline #when the process is stopped #then the person is told the turn may still run and how to stop it", async () => {
    // given
    const run = fakeRunner({ send: { code: null, stdout: "", stderr: "", ended: "deadline" } })
    const ui = fakeUi()
    const stopped = nextNote(ui, (message) => message.startsWith("No reply"))

    // when
    await invoke(run, "send dev_mac/s1 hello", ui)

    // then
    const note = await stopped
    expect(note.type).toBe("error")
    expect(note.message).toContain("/remote interrupt dev_mac/s1")
  })

  it("#given a listing that does not answer #when its deadline stops it #then the verb is named as stopped", async () => {
    // given
    const run = fakeRunner({ devices: { code: null, stdout: "", stderr: "", ended: "deadline" } })
    const ui = fakeUi()

    // when
    await invoke(run, "devices", ui)

    // then
    expect(run.options[0]?.deadlineMs).toBe(COMMAND_DEADLINE_MS)
    expect(ui.notes.map((note) => note.type)).toEqual(["error"])
  })

  it("#given a verb that succeeds with something on stderr #when the answer renders #then the result is shown and the stderr follows as a warning", async () => {
    // given
    const unlinked = "This device is not linked to your account. Run omo login to link it."
    const run = fakeRunner({
      enable: { code: 0, stdout: `${JSON.stringify({ enabled: true })}\n`, stderr: `${unlinked}\n` },
    })
    const ui = fakeUi()

    // when
    await invoke(run, "enable", ui)

    // then
    expect(ui.notes.map((note) => note.type)).toEqual(["info", "warning"])
    expect(ui.notes[1]?.message).toBe(unlinked)
  })

  it("#given enable stops with a notice and a non-zero exit #when the answer renders #then the CLI's notice is the error, not the exit code", async () => {
    // given
    const stopped = { state: "service_degraded", notice: "Could not download the OmO device service." }
    const run = fakeRunner({ enable: { code: 3, stdout: `${JSON.stringify(stopped)}\n`, stderr: "" } })
    const ui = fakeUi()

    // when
    await invoke(run, "enable", ui)

    // then
    expect(ui.notes).toEqual([{ message: stopped.notice, type: "error" }])
  })

  it("#given enable, disable and control answers #when they render #then each shows a sentence that differs by state, never the raw JSON", async () => {
    // given
    const answers: ReadonlyArray<readonly [string, unknown]> = [
      ["enable", { enabled: true }],
      ["disable", { enabled: false }],
      ["control", { attached: true, changedAt: "" }],
      ["control", { attached: false, changedAt: "" }],
    ]

    // when
    const shown: string[] = []
    for (const [verb, value] of answers) {
      const ui = fakeUi()
      await invoke(fakeRunner({ [verb]: ok(value) }), verb, ui)
      shown.push(ui.notes[0]?.message ?? "")
    }

    // then
    expect(shown.filter((message) => message.trimStart().startsWith("{"))).toEqual([])
    expect(shown[0]).not.toBe(shown[1])
    expect(shown[2]).not.toBe(shown[3])
  })

  it("#given the CLI exits 0 with a typed error #when the verb runs #then it is shown as a failure, not a result", async () => {
    // given
    const failure = {
      kind: "error",
      error: { code: "unsupported", message: "Not on that device.", next_action: "Use another." },
    }
    const run = fakeRunner({ model: ok(failure) })
    const ui = fakeUi()

    // when
    await invoke(run, "model dev_mac/s1 anthropic/x", ui)

    // then
    expect(ui.notes).toEqual([{ message: "Not on that device.\nUse another.", type: "error" }])
  })

  it("#given a running session #when /remote interrupt runs #then the CLI's result is shown", async () => {
    // given
    const run = fakeRunner({ interrupt: ok({ kind: "ok", thread: "s1", device: "dev_mac", interrupted: true }) })
    const ui = fakeUi()

    // when
    await invoke(run, "interrupt dev_mac/s1", ui)

    // then
    expect(run.calls).toEqual([["remote", "interrupt", "dev_mac/s1", "--json"]])
    expect(ui.notes).toEqual([{ message: "Interrupted dev_mac/s1.", type: "info" }])
  })

  it("#given the CLI answers a typed error #when the verb fails #then its message and next action are shown as an error", async () => {
    // given
    const failure = {
      kind: "error",
      error: { code: "device_offline", message: "ny2 is offline.", next_action: "Wake ny2." },
    }
    const run = fakeRunner({ close: { code: 1, stdout: `${JSON.stringify(failure)}\n`, stderr: "" } })
    const ui = fakeUi()

    // when
    await invoke(run, "close dev_ny2/s9", ui)

    // then
    expect(ui.notes).toEqual([{ message: "ny2 is offline.\nWake ny2.", type: "error" }])
  })

  it("#given the device service is stopped #when a verb fails with no JSON #then the CLI's own stderr is shown", async () => {
    // given
    const run = fakeRunner({
      devices: { code: 3, stdout: "", stderr: "The OmO device service is not running on this device.\n" },
    })
    const ui = fakeUi()

    // when
    await invoke(run, "devices", ui)

    // then
    expect(ui.notes).toEqual([{ message: "The OmO device service is not running on this device.", type: "error" }])
  })

  it("#given a session #when /remote attach runs #then no process starts and the new-terminal command is named", async () => {
    // given
    const run = fakeRunner({})
    const ui = fakeUi()

    // when
    await invoke(run, "attach dev_mac/s1", ui)

    // then
    expect(run.calls).toEqual([])
    expect(ui.notes.map((note) => note.message).join("\n")).toContain("omo remote attach dev_mac/s1")
  })

  it("#given an unknown verb #when /remote runs #then the usage is shown and nothing runs", async () => {
    // given
    const run = fakeRunner({})
    const ui = fakeUi()

    // when
    await invoke(run, "frobnicate", ui)

    // then
    expect(run.calls).toEqual([])
    expect(ui.notes[0]?.type).toBe("warning")
    expect(ui.notes[0]?.message).toContain("/remote sessions")
  })

  it("#given omo was not started by its launcher #when /remote runs #then it says why and nothing runs", async () => {
    // given
    const ui = fakeUi()

    // when
    await invoke(undefined, "devices", ui)

    // then
    expect(ui.notes).toHaveLength(1)
    expect(ui.notes[0]?.type).toBe("error")
    expect(ui.notes[0]?.message).toContain("omo")
  })

  it("#given a device and a session are picked #when the person sends from the picker #then the typed text goes to that session", async () => {
    // given
    const run = fakeRunner({
      devices: ok(DEVICES),
      sessions: ok(LISTING),
      send: ok({ kind: "ok", thread: "s1", device: "dev_mac", delivery: { kind: "started" }, reply: "on it" }),
    })
    const ui = fakeUi(
      [
        (options) => options.find((option) => option.includes("mengmota-mac")),
        (options) => options.find((option) => option.includes("dev_mac/s1")),
        (options) => options.find((option) => option.startsWith("Send")),
      ],
      "ship it",
    )
    const reply = nextNote(ui, (message) => message.includes("on it"))

    // when
    await invoke(run, "", ui)

    // then
    expect(run.calls).toEqual([
      ["remote", "devices", "--json"],
      ["remote", "sessions", "--device", "dev_mac", "--json"],
      ["remote", "send", "--json", "dev_mac/s1", "--", "ship it"],
    ])
    expect((await reply).message).toBe("dev_mac/s1:\non it")
  })

  it("#given a device is picked #when the person opens a new session from the picker #then omo remote open runs on that device", async () => {
    // given
    const run = fakeRunner({
      devices: ok(DEVICES),
      sessions: ok(LISTING),
      open: ok({ kind: "ok", thread: "s2", device: "dev_mac", deduplicated: false }),
    })
    const ui = fakeUi([
      (options) => options.find((option) => option.includes("mengmota-mac")),
      (options) => options.find((option) => option.startsWith("Open a new session")),
    ])

    // when
    await invoke(run, "", ui)

    // then
    expect(run.calls.at(-1)).toEqual(["remote", "open", "dev_mac", "--json"])
    expect(ui.notes.map((note) => note.message).join("\n")).toContain("dev_mac/s2")
  })

  it("#given the one-module CLI #when /remote devices and sessions run #then its rows, this device and the unanswered devices are shown", async () => {
    // given
    const run = fakeRunner({ devices: ok([MODULE_SELF, MODULE_SEOUL]), sessions: ok(MODULE_LIST) })
    const ui = fakeUi()

    // when
    await invoke(run, "devices", ui)
    await invoke(run, "sessions", ui)

    // then
    const [devices, sessions] = ui.notes.map((note) => note.message)
    expect(devices).toContain("mengmota-mac  dev_mac  online  (this device)")
    expect(devices).toContain("seoul  dev_seoul  online")
    expect(sessions).toContain("dev_seoul/s7  idle  nightly")
    expect(sessions).toContain("No answer from: ny2")
  })

  it("#given the one-module CLI answers a flat RemoteFailure #when the verb fails #then its message and next action are shown", async () => {
    // given
    const failure = { kind: "error", code: "device_offline", message: "ny2 is offline.", next_action: "Wake ny2." }
    const run = fakeRunner({ interrupt: { code: 3, stdout: `${JSON.stringify(failure)}\n`, stderr: "" } })
    const ui = fakeUi()

    // when
    await invoke(run, "interrupt dev_ny2/s1", ui)

    // then
    expect(ui.notes).toEqual([{ message: "ny2 is offline.\nWake ny2.", type: "error" }])
  })

  it("#given the one-module CLI #when the person opens and then sends from the picker #then the session's thread handle is used", async () => {
    // given
    const run = fakeRunner({
      devices: ok([MODULE_SELF, MODULE_SEOUL]),
      sessions: ok(MODULE_LIST),
      open: ok({ thread: "dev_seoul/s8", device: MODULE_SEOUL }),
      send: ok({ thread: "dev_seoul/s7", device: MODULE_SEOUL, lane: "queued", queue_position: 2 }),
    })
    const pickSeoul = (options: readonly string[]) => options.find((option) => option.startsWith("seoul"))
    const opening = fakeUi([pickSeoul, (options) => options.find((option) => option.startsWith("Open a new session"))])
    const sending = fakeUi(
      [
        pickSeoul,
        (options) => options.find((option) => option.includes("dev_seoul/s7")),
        (options) => options.find((option) => option.startsWith("Send")),
      ],
      "go",
    )
    const queued = nextNote(sending, (message) => message.startsWith("Queued"))

    // when
    await invoke(run, "", opening)
    await invoke(run, "", sending)

    // then
    expect(opening.notes.at(-1)?.message).toBe("Opened dev_seoul/s8.")
    expect(run.calls.at(-1)).toEqual(["remote", "send", "--json", "dev_seoul/s7", "--", "go"])
    expect((await queued).message).toBe("Queued on dev_seoul/s7 at position 2.")
  })

  it("#given the person cancels the picker at each step #when /remote runs #then nothing past the listings runs", async () => {
    // given
    const script = { devices: ok(DEVICES), sessions: ok(LISTING) }
    const pickMac = (options: readonly string[]) => options.find((option) => option.includes("mengmota-mac"))
    const pickRow = (options: readonly string[]) => options.find((option) => option.includes("dev_mac/s1"))
    const pickSend = (options: readonly string[]) => options.find((option) => option.startsWith("Send"))
    const cancels = [
      fakeUi([() => undefined]),
      fakeUi([pickMac, () => undefined]),
      fakeUi([pickMac, pickRow, () => undefined]),
      fakeUi([pickMac, pickRow, pickSend], undefined),
      fakeUi([pickMac, pickRow, pickSend], "   "),
    ]

    // when
    const verbs: string[][] = []
    for (const ui of cancels) {
      const run = fakeRunner(script)
      await invoke(run, "", ui)
      verbs.push(run.calls.map((call) => call[1] ?? ""))
    }

    // then
    expect(verbs).toEqual([
      ["devices"],
      ["devices", "sessions"],
      ["devices", "sessions"],
      ["devices", "sessions"],
      ["devices", "sessions"],
    ])
  })

  it("#given the CLI answers JSON that is not a device list #when the picker starts #then the person is told instead of seeing nothing", async () => {
    // given
    const run = fakeRunner({ devices: ok({ unexpected: true }) })
    const ui = fakeUi()

    // when
    await invoke(run, "", ui)

    // then
    expect(ui.notes).toHaveLength(1)
    expect(ui.notes[0]?.type).toBe("error")
    expect(ui.notes[0]?.message).toContain("omo remote devices answered something /remote cannot read")
  })

  it("#given a picked session #when the person interrupts it from the picker #then omo remote interrupt runs on it", async () => {
    // given
    const run = fakeRunner({
      devices: ok(DEVICES),
      sessions: ok(LISTING),
      interrupt: ok({ kind: "ok", thread: "s1", device: "dev_mac", interrupted: false }),
    })
    const ui = fakeUi([
      (options) => options.find((option) => option.includes("mengmota-mac")),
      (options) => options.find((option) => option.includes("dev_mac/s1")),
      (options) => options.find((option) => option.startsWith("Interrupt")),
    ])

    // when
    await invoke(run, "", ui)

    // then
    expect(run.calls.at(-1)).toEqual(["remote", "interrupt", "dev_mac/s1", "--json"])
    expect(ui.notes.at(-1)).toEqual({ message: "Nothing was running on dev_mac/s1.", type: "info" })
  })
})
