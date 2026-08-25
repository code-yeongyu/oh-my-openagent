import { describe, expect, it } from "bun:test"

import type { RpcRunnerSpec } from "../types"
import { createRpcModelAdmission, MODEL_CATALOG_CACHE_TTL_MS } from "./model-admission"
import type { RpcSpawnDescriptor } from "./spawn"

function descriptor(): RpcSpawnDescriptor {
  return { command: "senpi", args: ["--list-models"], cwd: "/tmp", env: { HOME: "/tmp" } }
}

function spec(model: string): RpcRunnerSpec {
  return { task_id: "st_cache", cwd: "/tmp", state_dir: "/tmp/state", prompt: "hello", model }
}

function catalogOutput(models: readonly string[]): string {
  return ["provider  model", ...models.map((entry) => entry.replace("/", "  "))].join("\n")
}

describe("process model admission catalog cache", () => {
  describe("#given a cached successful catalog whose TTL has expired", () => {
    it("#when a later admission runs #then the catalog is re-probed instead of served stale", async () => {
      // given
      let probes = 0
      let visible = ["prov/alpha"]
      let clock = 1_000
      const admit = createRpcModelAdmission({
        buildSpawn: () => descriptor(),
        probe: async () => {
          probes += 1
          return { code: 0, stdout: catalogOutput(visible), stderr: "", timedOut: false }
        },
        now: () => clock,
      })
      await admit(spec("prov/alpha"))
      expect(probes).toBe(1)

      // when
      visible = ["prov/alpha", "prov/beta"]
      clock += MODEL_CATALOG_CACHE_TTL_MS + 1
      await admit(spec("prov/beta"))

      // then
      expect(probes).toBe(2)
    })
  })

  describe("#given a cached successful catalog inside its TTL", () => {
    it("#when a later admission runs #then the cached catalog is reused", async () => {
      // given
      let probes = 0
      let clock = 1_000
      const admit = createRpcModelAdmission({
        buildSpawn: () => descriptor(),
        probe: async () => {
          probes += 1
          return { code: 0, stdout: catalogOutput(["prov/alpha"]), stderr: "", timedOut: false }
        },
        now: () => clock,
      })
      await admit(spec("prov/alpha"))

      // when
      clock += Math.floor(MODEL_CATALOG_CACHE_TTL_MS / 2)
      await admit(spec("prov/alpha"))

      // then
      expect(probes).toBe(1)
    })
  })
})
