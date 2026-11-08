import { describe, expect, test } from "bun:test"

import {
  REAPER_SCENARIOS,
  REFLECTION_DIR,
  SCENARIOS,
  STRANDED_RUN_DIR,
  STRANDED_SCENARIOS,
  probeFor,
  reaperProbeFor,
} from "../../memory-core/src/reflection/stale-holder.scenarios.test-support"
import { decideStaleReflectionLock, decideStrandedRun } from "../../memory-core/src/reflection/stale-lock-reaper"
import { classifyReflectionLock, decideReflectionLock, decideStrandedReflectionRun } from "../bin/lib/doctor-reflection-lock.js"
import { classifyActiveReflectionHolder } from "../../omo-senpi/src/components/memory/reflection-stale-active"

describe("the session and omo doctor decide a reflection lock the same way (#10377)", () => {
  test.each(SCENARIOS.map((scenario) => [scenario.name, scenario] as const))(
    "#given %s #when both surfaces classify the holder #then they return the same verdict",
    async (_name, scenario) => {
      const session = await classifyActiveReflectionHolder(REFLECTION_DIR, probeFor(scenario.facts))
      const cli = await classifyReflectionLock(REFLECTION_DIR, probeFor(scenario.facts))
      expect(cli).toEqual(session)
      expect(session).toEqual(scenario.expected)
    },
  )
})

describe("the session and omo doctor --fix take the same stale-lock decision (#11976)", () => {
  test.each(REAPER_SCENARIOS.map((scenario) => [scenario.name, scenario] as const))(
    "#given %s #when the source and the generated bundle decide the active lock #then they agree",
    async (_name, scenario) => {
      const source = await decideStaleReflectionLock(REFLECTION_DIR, reaperProbeFor(scenario.facts))
      const cli: unknown = await decideReflectionLock(REFLECTION_DIR, reaperProbeFor(scenario.facts))
      expect(cli).toEqual(source)
      expect(source.decision).toEqual(scenario.expected)
    },
  )

  test.each(STRANDED_SCENARIOS.map((scenario) => [scenario.name, scenario] as const))(
    "#given %s #when the source and the generated bundle decide a stranded run #then they agree",
    async (_name, scenario) => {
      const source = await decideStrandedRun(STRANDED_RUN_DIR, reaperProbeFor(scenario.facts))
      const cli: unknown = await decideStrandedReflectionRun(STRANDED_RUN_DIR, reaperProbeFor(scenario.facts))
      expect(cli).toEqual(source)
      expect(source).toEqual(scenario.expected)
    },
  )
})
