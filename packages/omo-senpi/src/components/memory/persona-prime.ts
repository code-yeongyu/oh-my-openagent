import {
  loadDreamPersona,
  loadFactsPersona,
  loadKibitzerPersona,
  loadReflectionPersona,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"

export interface PersonaPrimeTarget {
  readonly asset: string
  readonly load: () => unknown
}

const PERSONA_PRIME_TARGETS: readonly PersonaPrimeTarget[] = [
  { asset: "reflection-persona.md", load: loadReflectionPersona },
  { asset: "dream-persona.md", load: loadDreamPersona },
  { asset: "facts-persona.md", load: loadFactsPersona },
  { asset: "kibitzer-persona.md", load: loadKibitzerPersona },
]

// Registration is the last moment this process is guaranteed to see the payload it launched from,
// so every persona is read here and served from memory for the rest of the process lifetime. An
// asset that cannot be read is reported once with its cause instead of failing each later child
// launch, and it is never substituted: the payload validators own that failure at pack time.
export function primeMemoryPersonaAssets(input: {
  readonly logger?: ComponentLogger
  readonly targets?: readonly PersonaPrimeTarget[]
}): readonly string[] {
  const unavailable: string[] = []
  for (const target of input.targets ?? PERSONA_PRIME_TARGETS) {
    try {
      target.load()
    } catch (error: unknown) {
      unavailable.push(target.asset)
      input.logger?.warn("omo-senpi memory persona asset unavailable", {
        asset: target.asset,
        error: error instanceof Error ? error.message : String(error),
        hint: "this build's plugin payload is incomplete; reinstall omo, then start a new session",
      })
    }
  }
  return unavailable
}
