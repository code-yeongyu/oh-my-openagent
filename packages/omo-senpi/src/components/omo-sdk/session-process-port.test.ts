import { describe, expect, test } from "bun:test"

import { createOmoSdk } from "."
import type { OmoSdkOptions } from "./options"

// Security ruling on the diagnostics process port (#14959): the port is part of the trusted base, so the guarantee is that
// no session-reachable path can supply one. The engine plugin provisions this entry (extension/omo-sdk.ts) to sessions;
// it assembles the root with no launcher-side cores, so a session's root has no diagnostics core and no process port.
const session = { kind: "session", session_id: "session-1" } as const

function spyPort() {
  const calls: string[] = []
  const process = {
    spawn: async (command: string) => {
      calls.push(`spawn ${command}`)
      return { exitCode: 0, stdout: "" }
    },
    signal: async (pid: number) => {
      calls.push(`signal ${pid}`)
    },
  }
  return { calls, process }
}

describe("the session-reachable SDK entry and the diagnostics process port", () => {
  test("#given a caller that passes cores to the entry a session reaches #when the root is built #then construction refuses it", () => {
    const options = { cores: { diagnostics: async () => ({}) } } as unknown as OmoSdkOptions
    expect(() => createOmoSdk(options)).toThrow(TypeError)
  })

  test("#given a session root and a process port smuggled into its options #when reapStaleEngines is called #then it is refused and the port is never reached", async () => {
    const { calls, process } = spyPort()
    const sdk = createOmoSdk({ principal: session, ports: { process } } as unknown as OmoSdkOptions)
    expect(await sdk.diagnostics.reapStaleEngines({ pids: [4242] })).toMatchObject({
      kind: "error",
      error: { code: "sender_not_allowed" },
    })
    expect(calls).toEqual([])
  })

  test("#given the entry's own principal and a process port in its options #when reapStaleEngines is called #then no diagnostics core exists there and the port is never reached", async () => {
    const { calls, process } = spyPort()
    const sdk = createOmoSdk({ ports: { process } } as unknown as OmoSdkOptions)
    expect(await sdk.diagnostics.reapStaleEngines({ pids: [4242] })).toMatchObject({
      kind: "error",
      error: { code: "not_implemented" },
    })
    expect(calls).toEqual([])
  })
})
