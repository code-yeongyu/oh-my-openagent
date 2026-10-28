import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApprovalCache } from "./approval-cache"
import { readThroughHelper } from "./darwin-read"
import { A, fakeKeychain } from "./fake-keychain.test-support"
import { promptLockAt } from "./prompt-lock"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Rows 12, 13: two readers in one process (two backends) that both reach approveOnce while the first approve is still
// waiting on its dialog. The second must attach to it; without the attach it would find the machine-wide lock held by
// this very process and refuse with "pending".
describe("a second reader attaches to the approve already in flight (#11589 review, #11613 delta)", () => {
  test("#given the first approve is pending #when a second reader reaches approveOnce #then it attaches and there is one dialog", async () => {
    let open = () => {}
    let started = () => {}
    const approveStarted = new Promise<void>(resolve => (started = resolve))
    const keychain = fakeKeychain({ approveGate: new Promise<void>(resolve => (open = resolve)), onApprove: () => started() })
    keychain.put(A, "stored-value", "runtime", "ours")
    const { access } = keychain
    if (access.kind !== "ready") throw new Error("fake helper not ready")
    const root = mkdtempSync(join(tmpdir(), "attach-"))
    roots.push(root)
    const lockPath = join(root, "account.keychain-prompt")
    const cache = createApprovalCache()
    const reader = () =>
      readThroughHelper(
        {
          account: A,
          access,
          cache,
          background: false,
          takePromptLock: promptLockAt(lockPath),
          ownSilentGet: async () => {
            throw new Error("SecKeychainSearchCopyNext: -25293")
          },
        },
        true,
      )
    const first = reader()
    await approveStarted
    const second = reader()
    open()
    const [a, b] = await Promise.all([first, second])
    expect([a.kind, b.kind]).toEqual(["value", "value"])
    expect(keychain.stats.approves).toBe(1)
  })
})
