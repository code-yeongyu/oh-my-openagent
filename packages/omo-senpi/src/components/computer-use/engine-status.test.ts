/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { DesktopServiceError } from "@oh-my-opencode/senpi-desktop-service"
import { TrackedDesktopService } from "./engine-status"

describe("tracked desktop service error coverage", () => {
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
})
