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

  it("counts only the exact marker and its space as a record, so a look-alike line neither refuses nor hides one", () => {
    // A line that merely starts with the marker text is not a record: no separator, a wrong separator, a longer word.
    expect(read(['OMO_COMPUTER_LAUNCH_REFUSEDX{"version":1,"reason":"unresolved"}\n'])).toBeUndefined()
    expect(read(['OMO_COMPUTER_LAUNCH_REFUSED\t{"version":1,"reason":"unresolved"}\n'])).toBeUndefined()
    expect(read(["OMO_COMPUTER_LAUNCH_REFUSED_TRACE starting\n", record("unresolved")])).toEqual({
      reason: "unresolved",
    })
  })

  it("treats a stream cut off inside the marker as a truncated record, never as the last word", () => {
    expect(read([record("unresolved"), "OMO_COMPUTER_LAUNCH_REF"])).toBeUndefined()
    expect(read([record("unresolved"), "OMO_COMPUTER_LAUNCH_REFUSED"])).toBeUndefined()
    expect(read([record("unresolved"), 'OMO_COMPUTER_LAUNCH_REFUSED {"version":1,"reas\n'])).toBeUndefined()
  })

  it("refuses to pick one of two markers, whether on two lines or run together on one", () => {
    expect(read([record("unresolved"), 'OMO_COMPUTER_LAUNCH_REFUSED {"version":1\n'])).toBeUndefined()
    expect(read([`OMO_COMPUTER_LAUNCH_REFUSED ${record("unresolved")}`])).toBeUndefined()
    expect(read([`${record("unresolved").trimEnd()}${record("self-responsible")}`])).toBeUndefined()
  })

  it("stops reading once disabled (after hello), so a later line can never turn a live engine into a refusal", () => {
    const reader = new LaunchRefusalReader()
    reader.disable()
    reader.push(record("unresolved"))
    expect(reader.finish(1, null)).toBeUndefined()
  })
})
