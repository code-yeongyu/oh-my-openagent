import {
  loadDreamPersona,
  loadFactsPersona,
  loadKibitzerPersona,
  loadReflectionPersona,
} from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import { KIBITZER_TASK_RUNTIME_ASSET, loadKibitzerTaskRuntime } from "./kibitzer/task-runtime"

export interface PersonaPrimeTarget {
  readonly asset: string
  /** A synchronous loader is read before the prime returns; a returned promise is awaited. */
  readonly load: () => unknown
}

// Every asset a gate fire needs in order to START, read from the payload the process booted with:
// the four personas and the lazily bundled task runtime (`#omo-task-runtime` -> extensions/omo-task.js).
export const MEMORY_PRIME_TARGETS: readonly PersonaPrimeTarget[] = [
  { asset: "reflection-persona.md", load: loadReflectionPersona },
  { asset: "dream-persona.md", load: loadDreamPersona },
  { asset: "facts-persona.md", load: loadFactsPersona },
  { asset: "kibitzer-persona.md", load: loadKibitzerPersona },
  { asset: KIBITZER_TASK_RUNTIME_ASSET, load: loadKibitzerTaskRuntime },
]

// Registration is the last moment this process is guaranteed to see the payload it launched from,
// so every asset is loaded here and served from memory for the rest of the process lifetime. An
// asset that cannot be loaded is reported once with its cause instead of failing each later child
// launch, and it is never substituted: the payload validators own that failure at pack time.
// Synchronous reads complete before this returns; the runtime import is awaited by the promise.
export function primeMemoryPersonaAssets(input: {
  readonly logger?: ComponentLogger
  readonly targets?: readonly PersonaPrimeTarget[]
}): Promise<readonly string[]> {
  const unavailable: string[] = []
  const report = (target: PersonaPrimeTarget, error: unknown): void => {
    unavailable.push(target.asset)
    input.logger?.warn("omo-senpi memory boot asset unavailable", {
      asset: target.asset,
      error: error instanceof Error ? error.message : String(error),
      hint: "this build's plugin payload is incomplete; reinstall omo, then start a new session",
    })
  }
  const pending: Promise<void>[] = []
  for (const target of input.targets ?? MEMORY_PRIME_TARGETS) {
    try {
      const loaded = target.load()
      if (loaded instanceof Promise) pending.push(loaded.then(() => undefined, (error: unknown) => report(target, error)))
    } catch (error: unknown) {
      report(target, error)
    }
  }
  return Promise.all(pending).then(() => unavailable)
}
