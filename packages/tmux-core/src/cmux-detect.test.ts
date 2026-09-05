/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { isCmuxCompatEnvironment } from "./cmux-detect"

describe("isCmuxCompatEnvironment", () => {
  let savedTmux: string | undefined
  let savedCmuxSocketPath: string | undefined
  let savedCmuxAgentLaunchKind: string | undefined

  beforeEach(() => {
    savedTmux = process.env.TMUX
    savedCmuxSocketPath = process.env.CMUX_SOCKET_PATH
    savedCmuxAgentLaunchKind = process.env.CMUX_AGENT_LAUNCH_KIND
    delete process.env.TMUX
    delete process.env.CMUX_SOCKET_PATH
    delete process.env.CMUX_AGENT_LAUNCH_KIND
  })

  afterEach(() => {
    if (savedTmux !== undefined) {
      process.env.TMUX = savedTmux
    } else {
      delete process.env.TMUX
    }
    if (savedCmuxSocketPath !== undefined) {
      process.env.CMUX_SOCKET_PATH = savedCmuxSocketPath
    } else {
      delete process.env.CMUX_SOCKET_PATH
    }
    if (savedCmuxAgentLaunchKind !== undefined) {
      process.env.CMUX_AGENT_LAUNCH_KIND = savedCmuxAgentLaunchKind
    } else {
      delete process.env.CMUX_AGENT_LAUNCH_KIND
    }
  })

  it("#given TMUX contains cmuxterm without CMUX_SOCKET_PATH #when isCmuxCompatEnvironment called #then returns false (cmux never writes cmuxterm into a socket path)", () => {
    // given
    process.env.TMUX = "/tmp/cmuxterm-12345.sock,1234,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given a real tmux socket whose session name contains cmuxterm #when isCmuxCompatEnvironment called #then returns false", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
    process.env.TMUX = "/private/tmp/tmux-501/cmuxterm-notes,123,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given every cmux socket path shape observed in the shipped binary #when isCmuxCompatEnvironment called #then each is detected as cmux", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"

    const socketPaths = [
      "/tmp/cmux-omo/workspace",
      "/tmp/cmux-nightly-501/default",
      "/tmp/cmux-staging-501/default",
      "/tmp/cmux-debug-501/default",
      "/tmp/cmux-ssh-relay/default",
      "/tmp/cmux-cli-shims/default",
      "/tmp/cmux-wait-for-boot/default",
      "/tmp/cmux-xctest-1/default",
      "/tmp/cmux.sock",
      "/tmp/cmux-cloud-cli.sock",
    ]

    for (const socketPath of socketPaths) {
      // when
      process.env.TMUX = `${socketPath},surface,pane`
      const result = isCmuxCompatEnvironment()

      // then
      expect(result).toBe(true)
    }
  })

  it("#given standard tmux TMUX without cmuxterm #when isCmuxCompatEnvironment called #then returns false (regression guard)", () => {
    // given
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given CMUX_SOCKET_PATH set without TMUX #when isCmuxCompatEnvironment called #then returns true", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/var/run/cmux.sock"
    // TMUX is already unset in beforeEach

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(true)
  })

  it("#given cmux injected TMUX under a cmux socket directory #when isCmuxCompatEnvironment called #then returns true", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/Users/someone/.local/state/cmux/cmux-501.sock"
    process.env.TMUX = "/tmp/cmux-omo/70D4AC33-11CD-4B66-926C-C72CEFEC7E60,EEC79E0A-E474-4386-B185-8B6652A9E55F,473026479299511386"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(true)
  })

  it("#given real tmux nested inside cmux #when isCmuxCompatEnvironment called #then returns false (regression guard)", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
    process.env.TMUX = "/private/tmp/tmux-501/default,123,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given a tmux socket whose directory name contains a literal backslash #when isCmuxCompatEnvironment called #then returns false (backslash is not a Unix separator)", () => {
    // given
    process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
    process.env.TMUX = "/private/tmp/tmux-501/weird\\cmux-omo,123,0"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given cmux socket directory TMUX without CMUX_SOCKET_PATH #when isCmuxCompatEnvironment called #then returns false", () => {
    // given
    process.env.TMUX = "/tmp/cmux-omo/workspace,surface,pane"

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  it("#given neither TMUX nor CMUX_SOCKET_PATH #when isCmuxCompatEnvironment called #then returns false", () => {
    // given
    // both are already unset in beforeEach

    // when
    const result = isCmuxCompatEnvironment()

    // then
    expect(result).toBe(false)
  })

  describe("precedence between CMUX_SOCKET_PATH and CMUX_AGENT_LAUNCH_KIND", () => {
    const socketPath = "/Users/someone/.local/state/cmux/cmux-501.sock"
    const cmuxShapedTmux =
      "/tmp/cmux-omo/97BEE327-9847-42AE-B98C-8848BA583ECE,EEC79E0A-E474-4386-B185-8B6652A9E55F,1632462732908491017"
    const realTmux = "/private/tmp/tmux-501/omo-pr6390-probe,52728,0"

    type PrecedenceRow = {
      readonly socket: boolean
      readonly kind: string | undefined
      readonly tmux: "absent" | "cmux" | "real"
      readonly expected: boolean
    }

    function buildEnvironment(row: PrecedenceRow): Record<string, string | undefined> {
      const environment: Record<string, string | undefined> = {}
      if (row.socket) environment.CMUX_SOCKET_PATH = socketPath
      if (row.kind !== undefined) environment.CMUX_AGENT_LAUNCH_KIND = row.kind
      if (row.tmux === "cmux") environment.TMUX = cmuxShapedTmux
      if (row.tmux === "real") environment.TMUX = realTmux
      return environment
    }

    function describeRow(row: PrecedenceRow): string {
      return `socket=${row.socket} kind=${row.kind ?? "absent"} tmux=${row.tmux}`
    }

    const rows: readonly PrecedenceRow[] = [
      { socket: true, kind: "omo", tmux: "absent", expected: true },
      { socket: true, kind: "omo", tmux: "cmux", expected: true },
      { socket: true, kind: "omo", tmux: "real", expected: false },
      { socket: true, kind: "claude", tmux: "absent", expected: true },
      { socket: true, kind: "claude", tmux: "cmux", expected: true },
      { socket: true, kind: "claude", tmux: "real", expected: false },
      { socket: true, kind: undefined, tmux: "absent", expected: true },
      { socket: true, kind: undefined, tmux: "cmux", expected: true },
      { socket: true, kind: undefined, tmux: "real", expected: false },
      { socket: false, kind: "omo", tmux: "absent", expected: false },
      { socket: false, kind: "omo", tmux: "cmux", expected: true },
      { socket: false, kind: "omo", tmux: "real", expected: false },
      { socket: false, kind: "claude", tmux: "absent", expected: false },
      { socket: false, kind: "claude", tmux: "cmux", expected: false },
      { socket: false, kind: "claude", tmux: "real", expected: false },
      { socket: false, kind: undefined, tmux: "absent", expected: false },
      { socket: false, kind: undefined, tmux: "cmux", expected: false },
      { socket: false, kind: undefined, tmux: "real", expected: false },
    ]

    it("#given every combination of both cmux signals and a TMUX shape #when isCmuxCompatEnvironment called #then each combination resolves as documented", () => {
      // given
      const expected = rows.map((row) => `${describeRow(row)} -> ${row.expected}`)

      // when
      const actual = rows.map((row) => `${describeRow(row)} -> ${isCmuxCompatEnvironment(buildEnvironment(row))}`)

      // then
      expect(actual).toEqual(expected)
    })

    it("#given a cmux-shaped TMUX without CMUX_SOCKET_PATH #when only the launch kind differs #then the launch kind is what decides (fallback is load-bearing)", () => {
      // given
      const withLaunchKind = { TMUX: cmuxShapedTmux, CMUX_AGENT_LAUNCH_KIND: "omo" }
      const withoutLaunchKind = { TMUX: cmuxShapedTmux }

      // when
      const withLaunchKindResult = isCmuxCompatEnvironment(withLaunchKind)
      const withoutLaunchKindResult = isCmuxCompatEnvironment(withoutLaunchKind)

      // then
      expect(withLaunchKindResult).toBe(true)
      expect(withoutLaunchKindResult).toBe(false)
    })

    it("#given a real tmux socket inherited alongside both cmux signals #when isCmuxCompatEnvironment called #then the socket shape outranks both signals", () => {
      // given
      const nestedRealTmux = {
        CMUX_SOCKET_PATH: socketPath,
        CMUX_AGENT_LAUNCH_KIND: "omo",
        TMUX: realTmux,
      }

      // when
      const result = isCmuxCompatEnvironment(nestedRealTmux)

      // then
      expect(result).toBe(false)
    })

    it("#given only CMUX_AGENT_LAUNCH_KIND with no socket path and no TMUX #when isCmuxCompatEnvironment called #then returns false (fails closed on an inherited-only signal)", () => {
      // given
      const launchKindOnly = { CMUX_AGENT_LAUNCH_KIND: "omo" }

      // when
      const result = isCmuxCompatEnvironment(launchKindOnly)

      // then
      expect(result).toBe(false)
    })

    it("#given a non-omo launch kind standing in for a missing socket path #when isCmuxCompatEnvironment called #then returns false (only omo carries the CLI contract)", () => {
      // given
      const otherAgentKinds = ["claude", "codex", "OMO", "omo-nightly", ""]

      // when
      const results = otherAgentKinds.map((kind) =>
        isCmuxCompatEnvironment({ TMUX: cmuxShapedTmux, CMUX_AGENT_LAUNCH_KIND: kind }),
      )

      // then
      expect(results).toEqual(otherAgentKinds.map(() => false))
    })
  })
})
