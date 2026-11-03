/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { DesktopEngineAbiMismatchError, DesktopLaunchContextError } from "@oh-my-opencode/senpi-desktop-engine"
import { DesktopEngineUnavailableError, DesktopServiceError } from "@oh-my-opencode/senpi-desktop-service"
import { fakeEngineFactory } from "../../../../senpi-desktop-service/test/harness"
import { TrackedDesktopService } from "./engine-status"

describe("tracked desktop service error coverage", () => {
  for (const failure of [
    new DesktopEngineAbiMismatchError("/fixture", { abi: "wrong", protocolVersion: "wrong" }),
    new DesktopEngineUnavailableError({
      code: "native-unavailable", host: "darwin-arm64", attemptedPaths: ["/fixture"],
      message: "missing engine", cause: "fixture",
    }),
    new DesktopEngineUnavailableError({
      code: "quarantined", host: "darwin-arm64", attemptedPaths: ["/fixture"],
      message: "quarantined engine", cause: "fixture",
    }),
  ]) {
    test(`#given activation succeeded #when ${failure.name} is reported #then later replies keep the hard diagnostic`, async () => {
      const engine = fakeEngineFactory()
      const service = new TrackedDesktopService({ createChild: engine.factory })
      const diagnostic = failure instanceof DesktopEngineAbiMismatchError ? failure.code : failure.diagnostic.code
      try {
        await service.open({})
        expect(service.engineState).toBe("ready")
        service.reportError(failure)
        expect(service.engineState).toBe(diagnostic)
        await service.capabilities()
        await service.stopPathStatus()
        expect(service.engineState).toBe(diagnostic)
        // Explicit successful activation, rather than an unrelated reply, verifies recovery.
        await service.open({})
        expect(service.engineState).toBe("ready")
      } finally {
        await service.close()
      }
    })
  }

  test("#given a launch-context failure #when a later operation succeeds #then status recovers to ready", async () => {
    const engine = fakeEngineFactory()
    const service = new TrackedDesktopService({ createChild: engine.factory })
    try {
      await service.open({})
      service.reportError(new DesktopLaunchContextError("unresolved", "fixture"))
      expect(service.engineState).toBe("launch-context-unavailable")
      await service.capabilities()
      expect(service.engineState).toBe("ready")
    } finally {
      await service.close()
    }
  })

  test("#given stop-path setup fails #when ensureStopPath rejects #then the telemetry error seam observes it", async () => {
    const errors: Error[] = []
    const service = new TrackedDesktopService({
      createChild: () => {
        throw new Error("must not spawn")
      },
      onError: (error) => void errors.push(error),
    })

    await expect(service.ensureStopPath("ctrl+alt+shift+escape")).rejects.toBeInstanceOf(DesktopServiceError)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(DesktopServiceError)
    expect(errors[0]).toMatchObject({ code: "Closed" })
  })

  test("#given a failure nobody awaits reaches the service error hub #when it is reported #then the telemetry error seam observes it (#9967)", () => {
    // given: a failed run's best-effort revoke rejecting with a non-engine error
    const errors: Error[] = []
    const service = new TrackedDesktopService({
      createChild: () => {
        throw new Error("must not spawn")
      },
      onError: (error) => void errors.push(error),
    })
    const bug = new TypeError("revoke bug")

    // when
    service.reportError(bug)

    // then
    expect(errors).toEqual([bug])
  })
})
