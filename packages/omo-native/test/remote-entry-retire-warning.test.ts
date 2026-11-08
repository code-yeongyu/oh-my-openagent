import { describe, expect, test } from "bun:test"

import { inProcessAccountShow } from "../remote-entry"

// #12485: the `account show` that `omo remote` runs in process wired the sync-pin retire hook with a no-op logger,
// so a pin left in place on a key discard was never reported. The warning goes to stderr, apart from the captured
// stdout lines that remote-cli parses.

describe("omo remote's in-process account show", () => {
  test("#given the show discards a sign-in whose sync pin is left in place #when it runs #then the retire warning reaches the warning sink and stays out of the captured stdout", async () => {
    // given: a verb that, like a refresh replacing an unreadable stored sign-in, discards keys mid-show and prints one line
    const warnings: string[] = []

    // when
    const result = await inProcessAccountShow({
      warn: (line) => warnings.push(line),
      runVerb: async (dependencies, args) => {
        expect(args).toEqual(["show"])
        await dependencies.beforeKeysDiscarded?.({ kind: "unreadable" })
        dependencies.output("signed in as someone@example.test")
        return 0
      },
    })

    // then
    expect(warnings).toEqual(["memory sync: a stored sign-in could not be read while it was replaced; its sync pin was left in place"])
    expect(result).toEqual({ exitCode: 0, stdout: "signed in as someone@example.test" })
  })

  test("#given no warning sink is passed #when the retire hook warns #then the line is written to process.stderr", async () => {
    // given
    const written: string[] = []
    const write = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    // when
    try {
      await inProcessAccountShow({
        runVerb: async (dependencies) => {
          await dependencies.beforeKeysDiscarded?.({ kind: "unreadable" })
          return 0
        },
      })
    } finally {
      process.stderr.write = write
    }

    // then
    expect(written).toEqual(["memory sync: a stored sign-in could not be read while it was replaced; its sync pin was left in place\n"])
  })
})
