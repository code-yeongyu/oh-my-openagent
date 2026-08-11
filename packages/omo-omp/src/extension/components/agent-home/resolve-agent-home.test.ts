import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"

import { AGENT_HOME_SENTINEL, resolveAgentHome } from "./resolve-agent-home"

const HOME = "/home/tester"

describe("resolveAgentHome", () => {
  describe("#given an explicitly configured agent directory", () => {
    describe("#when several prefixes are set", () => {
      test("#then the branded name wins over the legacy names", () => {
        const home = resolveAgentHome({
          env: {
            OMP_CODING_AGENT_DIR: "/explicit/omp",
            OMO_CODING_AGENT_DIR: "/explicit/omo",
            PI_CODING_AGENT_DIR: "/explicit/pi",
          },
          homeDir: HOME,
          exists: () => false,
        })

        expect(home).toBe(resolve("/explicit/omp"))
      })

      test("#then each legacy name still works on its own", () => {
        expect(
          resolveAgentHome({ env: { OMO_CODING_AGENT_DIR: "/explicit/omo" }, homeDir: HOME, exists: () => false }),
        ).toBe(resolve("/explicit/omo"))
        expect(
          resolveAgentHome({ env: { PI_CODING_AGENT_DIR: "/explicit/pi" }, homeDir: HOME, exists: () => false }),
        ).toBe(resolve("/explicit/pi"))
      })

      test("#then a blank value is ignored", () => {
        expect(resolveAgentHome({ env: { OMP_CODING_AGENT_DIR: "   " }, homeDir: HOME, exists: () => false })).toBe(
          join(HOME, ".omp", "agent"),
        )
      })
    })
  })

  describe("#given no configured directory", () => {
    describe("#when the branded home holds engine state", () => {
      test("#then the flat branded home is used", () => {
        const home = resolveAgentHome({
          env: {},
          homeDir: HOME,
          exists: (path) => path === join(HOME, ".omo", AGENT_HOME_SENTINEL),
        })

        expect(home).toBe(join(HOME, ".omo"))
      })
    })

    describe("#when only the engine layout exists", () => {
      test("#then the legacy agent directory is used", () => {
        expect(resolveAgentHome({ env: {}, homeDir: HOME, exists: () => false })).toBe(join(HOME, ".omp", "agent"))
      })
    })
  })
})
