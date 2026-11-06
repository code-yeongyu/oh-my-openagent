import { describe, expect, test } from "bun:test"

import { REFLECTION_DIR, SCENARIOS, probeFor } from "../../memory-core/src/reflection/stale-holder.scenarios.test-support"
import { classifyReflectionLock } from "../bin/lib/doctor-reflection-lock.js"
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
