import { describe, expect, test } from "bun:test"
import { runRemoteAttachLaunch } from "../bin/lib/remote-attach-launch.js"

type Outcome = { exits: number; errors: string[] }

async function launch(overrides: { prepare?: () => Promise<readonly string[] | undefined>; runTui?: (args: readonly string[]) => Promise<void> }): Promise<Outcome> {
  const outcome: Outcome = { exits: 0, errors: [] }
  await runRemoteAttachLaunch({
    prepare: overrides.prepare ?? (async () => ["--attach", "sock", "--session", "ref", "--no-extensions"]),
    runTui: overrides.runTui ?? (async () => {}),
    reportError: (error: Error) => outcome.errors.push(error.message),
    exit: () => {
      outcome.exits += 1
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

    expect(outcome).toEqual({ exits: 1, errors: ["spawn senpi ENOENT"] })
  })

  test("#given preparing the attach throws #when the launch runs #then it reports the error and still exits", async () => {
    const outcome = await launch({
      prepare: async () => {
        throw new Error("engine missing")
      },
    })

    expect(outcome).toEqual({ exits: 1, errors: ["engine missing"] })
  })

  test("#given the TUI ends normally #when the launch runs #then it exits once with no error", async () => {
    let tuiArgs: readonly string[] = []
    const outcome = await launch({
      runTui: async args => {
        tuiArgs = args
      },
    })

    expect(tuiArgs).toEqual(["--attach", "sock", "--session", "ref", "--no-extensions"])
    expect(outcome).toEqual({ exits: 1, errors: [] })
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
    expect(outcome).toEqual({ exits: 1, errors: [] })
  })
})
