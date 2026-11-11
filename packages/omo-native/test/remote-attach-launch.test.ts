import { describe, expect, test } from "bun:test"
import { runRemoteAttachLaunch } from "../bin/lib/remote-attach-launch.js"

type Ended = { readonly reason: string; readonly exitCode: number; readonly message: string }
type Launch = { readonly engineArgs: readonly string[]; readonly ended: Promise<Ended> }
type Outcome = { exitCodes: (number | undefined)[]; errors: string[]; reported: string[] }

const ENGINE_ARGS = ["--attach", "sock", "--session", "ref", "--no-extensions"]
const never = new Promise<Ended>(() => {})

async function launch(overrides: {
  prepare?: () => Promise<Launch | undefined>
  runTui?: (args: readonly string[], ended: Promise<unknown>) => Promise<void>
}): Promise<Outcome> {
  const outcome: Outcome = { exitCodes: [], errors: [], reported: [] }
  await runRemoteAttachLaunch({
    prepare: overrides.prepare ?? (async () => ({ engineArgs: ENGINE_ARGS, ended: never })),
    runTui: overrides.runTui ?? (async () => {}),
    reportError: (error: Error) => outcome.errors.push(error.message),
    reportEnd: (line: string) => outcome.reported.push(line),
    exit: (code?: number) => {
      outcome.exitCodes.push(code)
    },
  })
  return outcome
}

describe("omo remote attach launcher", () => {
  test("#given the attach TUI cannot start #when the launch runs #then it reports the error and still exits", async () => {
    const outcome = await launch({
      runTui: async () => {
        throw new Error("spawn senpi ENOENT")
      },
    })

    expect(outcome).toEqual({ exitCodes: [undefined], errors: ["spawn senpi ENOENT"], reported: [] })
  })

  test("#given preparing the attach throws #when the launch runs #then it reports the error and still exits", async () => {
    const outcome = await launch({
      prepare: async () => {
        throw new Error("engine missing")
      },
    })

    expect(outcome).toEqual({ exitCodes: [undefined], errors: ["engine missing"], reported: [] })
  })

  test("#given the TUI ends normally #when the launch runs #then it exits once with no error", async () => {
    let tuiArgs: readonly string[] = []
    const outcome = await launch({
      runTui: async args => {
        tuiArgs = args
      },
    })

    expect(tuiArgs).toEqual(ENGINE_ARGS)
    expect(outcome).toEqual({ exitCodes: [undefined], errors: [], reported: [] })
  })

  test("#given preparation already reported its exit code #when the launch runs #then no TUI starts and it exits", async () => {
    let tuiStarted = false
    const outcome = await launch({
      prepare: async () => undefined,
      runTui: async () => {
        tuiStarted = true
      },
    })

    expect(tuiStarted).toBe(false)
    expect(outcome).toEqual({ exitCodes: [undefined], errors: [], reported: [] })
  })

  test("#given the remote side ends the attach while the TUI runs #when the launch runs #then the TUI is stopped, then the end is reported with its exit code", async () => {
    let end!: (value: Ended) => void
    const ended = new Promise<Ended>(resolve => {
      end = resolve
    })
    const order: string[] = []
    const outcome = await launch({
      prepare: async () => ({ engineArgs: ENGINE_ARGS, ended }),
      runTui: async (_args, stop) => {
        end({ reason: "peer_detached", exitCode: 0, message: "The remote session b/s ended (peer_detached)." })
        await stop
        order.push("tui left")
      },
    })

    expect(order).toEqual(["tui left"])
    expect(outcome).toEqual({ exitCodes: [0], errors: [], reported: ["The remote session b/s ended (peer_detached)."] })
  })
})
