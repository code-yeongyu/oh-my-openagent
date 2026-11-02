import { describe, expect, it } from "bun:test"

import type { RpcRunnerSpec } from "../types"
import {
  createRpcModelAdmission,
  MODEL_CATALOG_CACHE_TTL_MS,
  MODEL_CATALOG_MAX_STALE_MS,
  type ModelCatalogProbeResult,
  probeModelCatalog,
  type RpcModelAdmissionVerdict,
} from "./model-admission"
import type { RpcSpawnDescriptor } from "./spawn"

// A loaded host where a Senpi cold start takes ~25 s: the real probe's 20 s timer fires first and
// reports `timedOut`, so the stub advances the injected clock by that budget and answers the same way.
const PROBE_BUDGET_MS = 20_000

function descriptor(): RpcSpawnDescriptor {
  return { command: "senpi", args: ["--list-models"], cwd: "/tmp", env: { HOME: "/tmp" } }
}

function spec(model: string): RpcRunnerSpec {
  return { task_id: "st_inconclusive", cwd: "/tmp", state_dir: "/tmp/state", prompt: "hello", model }
}

function catalog(models: readonly string[]): ModelCatalogProbeResult {
  return {
    code: 0,
    stdout: ["provider  model", ...models.map((entry) => entry.replace("/", "  "))].join("\n"),
    stderr: "",
    timedOut: false,
  }
}

const TIMED_OUT: ModelCatalogProbeResult = { code: null, stdout: "", stderr: "", timedOut: true }

function harness(answers: (attempt: number) => ModelCatalogProbeResult) {
  let clock = 1_000
  let probes = 0
  const verdicts: RpcModelAdmissionVerdict[] = []
  const admit = createRpcModelAdmission({
    buildSpawn: () => descriptor(),
    probe: async () => {
      const answer = answers(probes)
      probes += 1
      if (answer.timedOut) clock += PROBE_BUDGET_MS
      return answer
    },
    now: () => clock,
    onInconclusive: (verdict) => {
      verdicts.push(verdict)
    },
  })
  return {
    admit,
    verdicts,
    probes: () => probes,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe("process model admission under an inconclusive catalog probe (#10863)", () => {
  describe("#given a cold start slower than the probe budget on both attempts", () => {
    it("#when a valid model is admitted #then the start proceeds and the inconclusive verdict is recorded", async () => {
      // given
      const world = harness(() => TIMED_OUT)

      // when
      const admission = world.admit(spec("prov/alpha"))

      // then
      await expect(admission).resolves.toBeUndefined()
      expect(world.probes()).toBe(2)
      expect(world.verdicts).toEqual([
        {
          verdict: "inconclusive",
          model: "prov/alpha",
          profileKey: expect.stringContaining("--list-models"),
          elapsedMs: 2 * PROBE_BUDGET_MS,
        },
      ])
    })

    it("#when the next start runs #then the inconclusive result was not cached and the profile is probed again", async () => {
      // given
      const world = harness(() => TIMED_OUT)
      await world.admit(spec("prov/alpha"))

      // when
      await world.admit(spec("prov/alpha"))

      // then
      expect(world.probes()).toBe(4)
    })
  })

  describe("#given a successful catalog older than the cache TTL but inside the max-stale bound", () => {
    it("#when a fresh probe times out and the stale catalog lists the model #then the model is admitted against it", async () => {
      // given
      const world = harness((attempt) => (attempt === 0 ? catalog(["prov/alpha"]) : TIMED_OUT))
      await world.admit(spec("prov/alpha"))
      world.advance(MODEL_CATALOG_CACHE_TTL_MS + 10 * 60_000)

      // when
      const admission = world.admit(spec("prov/alpha"))

      // then
      await expect(admission).resolves.toBeUndefined()
      expect(world.probes()).toBe(3)
      expect(world.verdicts).toEqual([
        expect.objectContaining({
          verdict: "stale_catalog",
          model: "prov/alpha",
          catalogAgeMs: MODEL_CATALOG_CACHE_TTL_MS + 10 * 60_000 + 2 * PROBE_BUDGET_MS,
        }),
      ])
    })

    it("#when a fresh probe times out and the stale catalog lacks the model #then absence is not proof and the start is admitted inconclusive", async () => {
      // given
      const world = harness((attempt) => (attempt === 0 ? catalog(["prov/alpha"]) : TIMED_OUT))
      await world.admit(spec("prov/alpha"))
      world.advance(MODEL_CATALOG_CACHE_TTL_MS + 1)

      // when
      const admission = world.admit(spec("prov/beta"))

      // then
      await expect(admission).resolves.toBeUndefined()
      expect(world.verdicts).toEqual([expect.objectContaining({ verdict: "inconclusive", model: "prov/beta" })])
    })
  })

  describe("#given a successful catalog older than the max-stale bound", () => {
    it("#when a fresh probe times out #then the old catalog is not consulted and the start is admitted inconclusive", async () => {
      // given
      const world = harness((attempt) => (attempt === 0 ? catalog(["prov/alpha"]) : TIMED_OUT))
      await world.admit(spec("prov/alpha"))
      world.advance(MODEL_CATALOG_MAX_STALE_MS + 1)

      // when
      await world.admit(spec("prov/alpha"))

      // then
      expect(world.verdicts).toEqual([expect.objectContaining({ verdict: "inconclusive", model: "prov/alpha" })])
    })
  })

  describe("#given a complete catalog that omits the model", () => {
    it("#when the confirming re-probe times out #then absence is unconfirmed and the start is admitted inconclusive", async () => {
      // given
      const world = harness((attempt) => (attempt === 0 ? catalog(["prov/alpha"]) : TIMED_OUT))

      // when
      const admission = world.admit(spec("prov/beta"))

      // then
      await expect(admission).resolves.toBeUndefined()
      expect(world.verdicts).toEqual([expect.objectContaining({ verdict: "inconclusive", model: "prov/beta" })])
    })

    it("#when the confirming re-probe also omits it #then admission still refuses typed", async () => {
      // given
      const world = harness(() => catalog(["prov/alpha"]))

      // when
      const admission = world.admit(spec("prov/beta"))

      // then
      await expect(admission).rejects.toMatchObject({
        failure: { kind: "model_unavailable", reason: "model_not_in_child_profile" },
      })
      expect(world.verdicts).toEqual([])
    })
  })

  describe("#given concurrent starts for one profile", () => {
    it("#when the first probe is still in flight #then every start shares it", async () => {
      // given
      let probes = 0
      const answer = Promise.withResolvers<ModelCatalogProbeResult>()
      const admit = createRpcModelAdmission({
        buildSpawn: () => descriptor(),
        probe: () => {
          probes += 1
          return answer.promise
        },
        now: () => 1_000,
      })

      // when
      const starts = [admit(spec("prov/alpha")), admit(spec("prov/alpha")), admit(spec("prov/alpha"))]
      answer.resolve(catalog(["prov/alpha"]))

      // then
      await expect(Promise.all(starts)).resolves.toEqual([undefined, undefined, undefined])
      expect(probes).toBe(1)
    })
  })

  describe("#given the real probe against a child that is still cold-starting at the deadline", () => {
    it("#when both attempts hit the injected timeout #then the start is admitted inconclusive", async () => {
      // given: the fake CLI would print its catalog only after 25 s; the injected budget is 200 ms.
      const verdicts: RpcModelAdmissionVerdict[] = []
      const admit = createRpcModelAdmission({
        buildSpawn: () => ({
          command: process.execPath,
          args: ["-e", "setTimeout(() => console.log('prov  alpha'), 25_000)"],
          cwd: process.cwd(),
          env: process.env,
        }),
        probe: (probeDescriptor) => probeModelCatalog(probeDescriptor, { timeoutMs: 200 }),
        onInconclusive: (verdict) => {
          verdicts.push(verdict)
        },
      })

      // when
      const admission = admit(spec("prov/alpha"))

      // then
      await expect(admission).resolves.toBeUndefined()
      expect(verdicts).toEqual([expect.objectContaining({ verdict: "inconclusive", model: "prov/alpha" })])
    })
  })
})
