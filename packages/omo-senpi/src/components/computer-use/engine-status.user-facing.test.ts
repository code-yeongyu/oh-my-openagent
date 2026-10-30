/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { DesktopEngineAbiMismatchError } from "@oh-my-opencode/senpi-desktop-engine"
import { DesktopEngineUnavailableError } from "@oh-my-opencode/senpi-desktop-service"

import { ComputerEngineUnavailableError } from "./engine-status"

// senpi#4990: an engine failure that reaches the extension runner carries the structural
// `userFacing` contract, so senpi shows what happened and what to do instead of a crash dump.
const PREBUILT = "/Users/someone/.omo/omo-versions/9.9.9/node_modules/omo-ai/native/prebuilds/senpi-desktop-engine"

function unavailable(code: "native-unavailable" | "quarantined", reason?: "no-release-asset") {
  return new DesktopEngineUnavailableError({
    code,
    host: "darwin-arm64",
    attemptedPaths: [PREBUILT],
    message: `No senpi-desktop-engine binary is available at ${PREBUILT}.`,
    cause: `${PREBUILT}: missing`,
    ...(reason === undefined ? {} : { reason }),
  })
}

const cases = [
  ["quarantined", new ComputerEngineUnavailableError("quarantined", unavailable("quarantined")), "COMPUTER_ENGINE_QUARANTINED"],
  ["missing engine", new ComputerEngineUnavailableError("native-unavailable", unavailable("native-unavailable")), "COMPUTER_ENGINE_UNAVAILABLE"],
  [
    "unsupported platform",
    new ComputerEngineUnavailableError("native-unavailable", unavailable("native-unavailable", "no-release-asset")),
    "COMPUTER_UNSUPPORTED_PLATFORM",
  ],
  [
    "ABI mismatch",
    new ComputerEngineUnavailableError("abi-mismatch", new DesktopEngineAbiMismatchError(PREBUILT, { abi: "0", protocolVersion: "0" })),
    "COMPUTER_ENGINE_VERSION_MISMATCH",
  ],
] as const

describe("ComputerEngineUnavailableError user-facing contract", () => {
  for (const [name, error, code] of cases) {
    test(`#given ${name} #when the engine fails to start #then userFacing names the problem and fix without paths`, () => {
      expect(error.userFacing.code).toBe(code)
      for (const text of [error.userFacing.message, error.userFacing.action]) {
        expect(text.length).toBeGreaterThan(0)
        expect(text).not.toContain(PREBUILT)
        expect(text).not.toMatch(/[\\/][^\s]+[\\/]/)
        expect(text).not.toContain("\n")
      }
      expect(error.message).toContain(PREBUILT)
    })
  }
})
