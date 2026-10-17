import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TrustAnchor } from "../anchor.ts"
import { appendEntries, emptyChain } from "../chain.ts"
import { createRejectionCounter } from "../rejection.ts"
import { loadTrustAnchor, pinTrustAnchor } from "../trust-pin.ts"
import { ACCOUNT, fixtureAnchor, mainChain } from "./sync-v1.test-support.ts"

/** The fixture account's root as a device pins it: walked under the creator anchor, pinned, loaded back. */
export const pinnedFixtureAnchor = async (): Promise<TrustAnchor> => {
  const walked = await appendEntries(emptyChain(ACCOUNT, fixtureAnchor()), mainChain(), createRejectionCounter())
  if (!walked.ok || walked.state.pin === null) throw new Error("the fixture walk proves no pin")
  const dir = mkdtempSync(join(tmpdir(), "pinned-fixture-"))
  try {
    await pinTrustAnchor(dir, ACCOUNT, walked.state.pin)
    const loaded = await loadTrustAnchor(dir, ACCOUNT)
    if (!loaded.ok) throw new Error(`fixture pin did not load: ${loaded.reason}`)
    return loaded.anchor
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
