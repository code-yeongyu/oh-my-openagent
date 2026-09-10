import { describe, expect, it } from "bun:test"

import type { ComponentLogger } from "../../extension/types"
import { primeMemoryPersonaAssets, type PersonaPrimeTarget } from "./persona-prime"

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
  it("#given every persona readable #when priming #then each asset is read once and nothing is reported", () => {
    // given
    const reads: string[] = []
    const targets: readonly PersonaPrimeTarget[] = [
      { asset: "facts-persona.md", load: () => reads.push("facts") },
      { asset: "kibitzer-persona.md", load: () => reads.push("kibitzer") },
    ]
    const { logger, warnings } = recordingLogger()

    // when
    const unavailable = primeMemoryPersonaAssets({ logger, targets })

    // then
    expect(reads).toEqual(["facts", "kibitzer"])
    expect(unavailable).toEqual([])
    expect(warnings).toEqual([])
  })

  it("#given one unreadable persona #when priming #then registration continues and the asset is named once", () => {
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
    const unavailable = primeMemoryPersonaAssets({ logger, targets })

    // then
    expect(unavailable).toEqual(["kibitzer-persona.md"])
    expect(reads).toEqual(["facts"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.details).toMatchObject({ asset: "kibitzer-persona.md" })
  })
})
