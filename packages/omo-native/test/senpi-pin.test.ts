import { describe, expect, test } from "bun:test"

import omoNativeManifest from "../package.json"
import omoSenpiManifest from "../../omo-senpi/package.json"
import senpiTaskManifest from "../../senpi-task/package.json"
import rootManifest from "../../../package.json"

const SENPI_PIN = "2026.9.3-3"
const EXACT_PIN = /^\d/

describe("senpi dependency pin", () => {
  describe("#given the three manifests that pin @code-yeongyu/senpi", () => {
    describe("#when their pins are read", () => {
      test("#then omo-ai pins the exact senpi version", () => {
        expect(omoNativeManifest.dependencies["@code-yeongyu/senpi"]).toBe(SENPI_PIN)
        expect(omoNativeManifest.dependencies["@code-yeongyu/senpi"]).toMatch(EXACT_PIN)
      })

      test("#then omo-senpi peer and dev pins match", () => {
        expect(omoSenpiManifest.peerDependencies["@code-yeongyu/senpi"]).toBe(SENPI_PIN)
        expect(omoSenpiManifest.devDependencies["@code-yeongyu/senpi"]).toBe(SENPI_PIN)
      })

      test("#then the root devDependency pin matches", () => {
        expect(rootManifest.devDependencies["@code-yeongyu/senpi"]).toBe(SENPI_PIN)
      })

      test("#then senpi-task pins match", () => {
        const pins = [
          ...Object.entries(senpiTaskManifest.dependencies ?? {}),
          ...Object.entries(senpiTaskManifest.devDependencies ?? {}),
          ...Object.entries(senpiTaskManifest.peerDependencies ?? {}),
        ].filter(([name]) => name === "@code-yeongyu/senpi")
        expect(pins.length).toBeGreaterThan(0)
        for (const [, version] of pins) expect(version).toBe(SENPI_PIN)
      })
    })
  })
})
