import { stat } from "node:fs/promises"
import { buildGenesis } from "../../genesis/build.ts"
import { createPhraseGenesisBridge, type PhraseSurface } from "../../genesis/phrase-bridge.ts"
import { genesisIntentLocation } from "../../genesis/intent-store.ts"
import { deviceKeyring, entryOf } from "../../genesis/vector.test-support.ts"
import { generateRecoveryPhrase, TypedPhrase } from "../../recovery/phrase.ts"
import { principalOf } from "../join.ts"
import { ACCOUNT } from "./genesis-enable.test-support.ts"

/** Fixed test entropy only: a test phrase is never a real one and is never printed. */
const fixedPhrase = (fill: number) => () => generateRecoveryPhrase((bytes) => void bytes.fill(fill))
const fixedBytes = (length: number) => new Uint8Array(length).fill(41)
const fixedPositions = () => [2, 11, 23]

export type SurfacePlan = { readonly show?: boolean; readonly answers?: ReadonlyArray<"right" | "wrong" | "cancel"> }

/** A scripted person: shows, then answers each 3-word check per plan (default: right first time). */
export const scriptedSurface = (plan: SurfacePlan = {}, during?: { readonly onConfirm?: () => void | Promise<void> }) => {
  const calls = { show: 0, confirm: 0 }
  let shown: ReadonlyArray<string> = []
  const surface: PhraseSurface = {
    show: async (phrase) => {
      calls.show += 1
      shown = phrase.reveal()
      return plan.show ?? true
    },
    confirm: async (positions) => {
      const answer = plan.answers?.[calls.confirm] ?? "right"
      calls.confirm += 1
      await during?.onConfirm?.()
      if (answer === "cancel") return null
      const words = positions.map((position) => shown[position - 1] ?? "")
      return new TypedPhrase((answer === "wrong" ? [...words].reverse() : words).join(" "))
    },
  }
  return { surface, calls }
}

export const phraseGenesis = (surface: PhraseSurface, fill = 9) =>
  createPhraseGenesisBridge(surface, { phrase: fixedPhrase(fill), bytes: fixedBytes, positions: fixedPositions })

/** Another device's valid phrase genesis for the same account: the winner of a lost race. */
export const competingGenesisEntry = async () => {
  const other = await deviceKeyring(30)
  const result = await phraseGenesis(scriptedSurface().surface, 12)(
    { account: ACCOUNT, firstDevice: principalOf(other) },
    { operation: { signal: new AbortController().signal, admit: (begin) => begin() } },
  )
  if (!result.ok) throw new Error("competing genesis fixture")
  const built = await buildGenesis(ACCOUNT, other, result.prepared)
  return entryOf(built.request, other)
}

export const phraseMarkerExists = async (pinDir: string, principalId: string): Promise<boolean> => {
  try {
    await stat(`${genesisIntentLocation(pinDir, ACCOUNT, principalId)}.phrase-pending`)
    return true
  } catch {
    return false
  }
}
