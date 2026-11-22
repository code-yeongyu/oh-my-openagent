import { afterEach, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { failAnchorListingAfterPin } from "../crypto/testing/retired-pin-listing.test-support.ts"
import { ACCOUNT, fixtureAnchor, mainChain } from "../crypto/testing/sync-v1.test-support.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import type { RecoveryEvent } from "./ports.ts"
import { pinRecoveredRoot } from "./recover-join.ts"

const dirs: string[] = []
afterEach(() => {
  mock.restore()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// #12382 review L2: a recovery that pinned but could not read the retired pins reports the skipped root-change check
// through its own seams, the outcome and `onEvent`, instead of answering "no change".
test("#given a recovery pin whose retired pins cannot be listed #when the root is pinned #then the skipped check is an event and part of the result", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "recover-join-"))
  dirs.push(stateDir)
  const walked = await appendEntries(emptyChain(ACCOUNT, fixtureAnchor()), mainChain(), createRejectionCounter())
  if (!walked.ok || walked.state.pin === null) throw new Error("the fixture creator walk proves no pin")
  const fault = failAnchorListingAfterPin(stateDir, "EIO")
  const events: RecoveryEvent[] = []

  const pinned = await pinRecoveredRoot(
    { stateDir, account: ACCOUNT, onEvent: (event) => events.push(event) },
    walked.state.pin,
  )
  mock.restore()

  expect(fault.pinned()).toBe(true)
  expect(pinned).toEqual({ ok: true, changed: { rootCheck: { kind: "skipped", reason: "EIO" } } })
  expect(events).toEqual(["sync.trust.root_check_skipped"])
  const loaded = await loadTrustAnchor(stateDir, ACCOUNT)
  expect(loaded.ok && loaded.anchor.genesisDigest).toBe(walked.state.pin.genesisDigest)
})
