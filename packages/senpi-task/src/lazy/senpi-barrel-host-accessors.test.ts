/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  loadSenpiBarrel,
  SenpiHostSymbolMissingError,
  senpiDecideHostAction,
  senpiEngineBuildIdentity,
  senpiEnsureHost,
  senpiHandoffHost,
  senpiProbeHost,
  senpiRpcClient,
  senpiStopHost,
} from "./senpi-barrel"

describe("senpi host-daemon accessors", () => {
  test("#given the warmed barrel #when the host-daemon symbols the pinned engine exports are read #then each live value comes back", async () => {
    // given
    await loadSenpiBarrel()

    // when
    const resolved = {
      ensureHost: senpiEnsureHost(),
      RpcClient: senpiRpcClient(),
      probeHost: senpiProbeHost(),
      stopHost: senpiStopHost(),
      handoffHost: senpiHandoffHost(),
      decideHostAction: senpiDecideHostAction(),
      engineBuildIdentity: senpiEngineBuildIdentity(),
    }

    // then
    // The pin (2026.9.24) carries senpi todos 15-17/20, so every accessor resolves. While the
    // pin predated them this test's tripwire proved each one failed closed with its symbol name
    // (see this file's history); that path is the three-line requireHostSymbol with no other branch.
    for (const [name, value] of Object.entries(resolved)) {
      expect(typeof value, `${name} should be a live export of the pinned engine`).toBe("function")
    }
  })

  test("#given a host symbol the engine lacks #when the typed error is raised #then it names the symbol a caller can branch on", () => {
    // given
    const error = new SenpiHostSymbolMissingError("decideHostAction")

    // then
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("SenpiHostSymbolMissingError")
    expect(error.symbol).toBe("decideHostAction")
    expect(error.message).toContain("decideHostAction")
  })
})
