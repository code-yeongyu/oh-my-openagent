import { describe, expect, it } from "bun:test"

import type { RpcRunnerSpec } from "../types"
import { createRpcModelAdmission, MODEL_CATALOG_CACHE_TTL_MS } from "./model-admission"
import type { RpcSpawnDescriptor } from "./spawn"

function descriptor(): RpcSpawnDescriptor {
  return { command: "senpi", args: ["--list-models"], cwd: "/tmp", env: { HOME: "/tmp" } }
}

function spec(model: string): RpcRunnerSpec {
  return { task_id: "st_confirm", cwd: "/tmp", state_dir: "/tmp/state", prompt: "hello", model }
}

function catalogOutput(models: readonly string[]): string {
  return ["provider  model", ...models.map((entry) => entry.replace("/", "  "))].join("\n")
}

/**
 * The real `--list-models` child exits 0 with whatever providers resolved inside its own budget, so
 * each scripted catalog stands for one such exit-0 listing: partial ones first, complete ones later.
 */
function scriptedProbe(listings: readonly (readonly string[])[]) {
  let probes = 0
  return {
    probes: () => probes,
    probe: async () => {
      const models = listings[Math.min(probes, listings.length - 1)] ?? []
      probes += 1
      return { code: 0, stdout: catalogOutput(models), stderr: "", timedOut: false }
    },
  }
}

describe("process model admission confirming probe", () => {
  describe("#given an exit-0 catalog that omits the requested model", () => {
    it("#when a fresh confirming probe lists the model #then admission resolves", async () => {
      // given
      const catalog = scriptedProbe([["prov/alpha"], ["prov/alpha", "prov/beta"]])
      const admit = createRpcModelAdmission({ buildSpawn: () => descriptor(), probe: catalog.probe })

      // when
      const admission = admit(spec("prov/beta"))

      // then
      await expect(admission).resolves.toBeUndefined()
      expect(catalog.probes()).toBe(2)
    })
  })

  describe("#given a cached catalog that did not contain the requested model", () => {
    it("#when a later admission runs inside the cache TTL #then the profile is re-probed instead of served the stale catalog", async () => {
      // given
      const catalog = scriptedProbe([["prov/alpha"], ["prov/alpha", "prov/beta"]])
      let clock = 1_000
      const admit = createRpcModelAdmission({
        buildSpawn: () => descriptor(),
        probe: catalog.probe,
        now: () => clock,
      })
      await admit(spec("prov/alpha"))
      expect(catalog.probes()).toBe(1)

      // when
      clock += Math.floor(MODEL_CATALOG_CACHE_TTL_MS / 2)
      const admission = admit(spec("prov/beta"))

      // then
      await expect(admission).resolves.toBeUndefined()
      expect(catalog.probes()).toBe(2)
    })
  })

  describe("#given a model absent from every exit-0 catalog", () => {
    it("#when the confirming probe also omits it #then admission still rejects as model_unavailable", async () => {
      // given
      const catalog = scriptedProbe([["prov/alpha"]])
      const admit = createRpcModelAdmission({ buildSpawn: () => descriptor(), probe: catalog.probe })

      // when
      const admission = admit(spec("prov/beta"))

      // then
      await expect(admission).rejects.toMatchObject({
        failure: {
          kind: "model_unavailable",
          message: expect.stringContaining("prov/beta"),
        },
      })
    })
  })
})
