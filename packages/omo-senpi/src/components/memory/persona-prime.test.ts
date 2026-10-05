import { describe, expect, it } from "bun:test"

import type { ComponentLogger } from "../../extension/types"
import { MEMORY_PRIME_TARGETS, primeMemoryPersonaAssets, type PersonaPrimeTarget } from "./persona-prime"

interface RecordedWarning {
  readonly message: string
  readonly details?: unknown
}

function recordingLogger(): { readonly logger: ComponentLogger; readonly warnings: RecordedWarning[] } {
  const warnings: RecordedWarning[] = []
  const logger: ComponentLogger = {
    info: () => {},
    warn: (message, details) => {
      warnings.push({ message, details })
    },
    error: () => {},
  }
  return { logger, warnings }
}

describe("primeMemoryPersonaAssets", () => {
  it("#given every persona readable #when priming #then each asset is read once and nothing is reported", async () => {
    // given
    const reads: string[] = []
    const targets: readonly PersonaPrimeTarget[] = [
      { asset: "facts-persona.md", load: () => reads.push("facts") },
      { asset: "kibitzer-persona.md", load: () => reads.push("kibitzer") },
    ]
    const { logger, warnings } = recordingLogger()

    // when
    const unavailable = await primeMemoryPersonaAssets({ logger, targets })

    // then
    expect(reads).toEqual(["facts", "kibitzer"])
    expect(unavailable).toEqual([])
    expect(warnings).toEqual([])
  })

  it("#given one unreadable persona #when priming #then registration continues and the asset is named once", async () => {
    // given
    const reads: string[] = []
    const targets: readonly PersonaPrimeTarget[] = [
      {
        asset: "kibitzer-persona.md",
        load: () => {
          throw new Error("ENOENT: no such file or directory, open 'kibitzer-persona.md'")
        },
      },
      { asset: "facts-persona.md", load: () => reads.push("facts") },
    ]
    const { logger, warnings } = recordingLogger()

    // when
    const unavailable = await primeMemoryPersonaAssets({ logger, targets })

    // then
    expect(unavailable).toEqual(["kibitzer-persona.md"])
    expect(reads).toEqual(["facts"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.details).toMatchObject({ asset: "kibitzer-persona.md" })
  })

  it("#given the registration targets #when listed #then the task runtime module is primed beside the four personas", () => {
    // then: every asset a fire needs to START is resolved at registration, from the payload the process booted with
    expect(MEMORY_PRIME_TARGETS.map((target) => target.asset)).toEqual([
      "reflection-persona.md",
      "dream-persona.md",
      "facts-persona.md",
      "kibitzer-persona.md",
      "#omo-task-runtime",
    ])
  })

  it("#given the task runtime import rejects #when priming #then it is awaited and reported unavailable while sync personas are still read first", async () => {
    // given: the install tree lost extensions/omo-task.js under the live process
    const reads: string[] = []
    const targets: readonly PersonaPrimeTarget[] = [
      { asset: "kibitzer-persona.md", load: () => reads.push("kibitzer") },
      { asset: "#omo-task-runtime", load: () => Promise.reject(new Error("Cannot find module './extensions/omo-task.js'")) },
    ]
    const { logger, warnings } = recordingLogger()

    // when
    const pending = primeMemoryPersonaAssets({ logger, targets })
    const readSynchronously = [...reads]
    const unavailable = await pending

    // then
    expect(readSynchronously).toEqual(["kibitzer"])
    expect(unavailable).toEqual(["#omo-task-runtime"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.details).toMatchObject({ asset: "#omo-task-runtime", error: "Cannot find module './extensions/omo-task.js'" })
  })

  it("#given the task runtime import resolves #when priming #then nothing is reported", async () => {
    // given
    const targets: readonly PersonaPrimeTarget[] = [
      { asset: "#omo-task-runtime", load: () => Promise.resolve({ createInProcessJudgeRunner: () => undefined }) },
    ]
    const { logger, warnings } = recordingLogger()

    // when
    const unavailable = await primeMemoryPersonaAssets({ logger, targets })

    // then
    expect(unavailable).toEqual([])
    expect(warnings).toEqual([])
  })
})
