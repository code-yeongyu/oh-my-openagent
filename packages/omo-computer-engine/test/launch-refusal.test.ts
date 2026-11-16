import { describe, expect, it } from "vitest"

import { LaunchRefusalReader } from "../src/index.ts"

const record = (reason: string) => `OMO_COMPUTER_LAUNCH_REFUSED {"version":1,"reason":"${reason}"}\n`

function read(chunks: readonly string[], code: number | null = 1, signal: string | null = null) {
  const reader = new LaunchRefusalReader()
  for (const chunk of chunks) reader.push(chunk)
  return reader.finish(code, signal)
}

describe("launch-refusal parser", () => {
  it("reads one structured refusal record from a child that exited 1, across chunk boundaries", () => {
    const line = record("self-responsible")
    expect(read([line.slice(0, 10), line.slice(10)])).toEqual({ reason: "self-responsible" })
    expect(read(["noise\n", record("unresolved")])).toEqual({ reason: "unresolved" })
  })

  it("is diagnostics only: any other exit, a signal, or a second record yields no refusal", () => {
    expect(read([record("unresolved")], 0)).toBeUndefined()
    expect(read([record("unresolved")], 1, "SIGKILL")).toBeUndefined()
    expect(read([record("unresolved"), record("self-responsible")])).toBeUndefined()
  })

  it("rejects malformed records: unknown reason, extra or duplicate keys, wrong version, oversized line, a partial record", () => {
    expect(read([record("granted")])).toBeUndefined()
    expect(read(['OMO_COMPUTER_LAUNCH_REFUSED {"version":1,"reason":"unresolved","x":1}\n'])).toBeUndefined()
    expect(
      read(['OMO_COMPUTER_LAUNCH_REFUSED {"version":1,"reason":"unresolved","reason":"unresolved"}\n']),
    ).toBeUndefined()
    expect(read(['OMO_COMPUTER_LAUNCH_REFUSED {"version":2,"reason":"unresolved"}\n'])).toBeUndefined()
    expect(
      read([`OMO_COMPUTER_LAUNCH_REFUSED {"version":1,"reason":"unresolved"}${" ".repeat(600)}\n`]),
    ).toBeUndefined()
    expect(read(['OMO_COMPUTER_LAUNCH_REFUSED {"version":1,"reas'])).toBeUndefined()
  })

  it("stops reading once disabled (after hello), so a later line can never turn a live engine into a refusal", () => {
    const reader = new LaunchRefusalReader()
    reader.disable()
    reader.push(record("unresolved"))
    expect(reader.finish(1, null)).toBeUndefined()
  })
})
