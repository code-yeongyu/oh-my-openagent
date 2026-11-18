import { describe, expect, test } from "bun:test"
import { desktopRecoveryBridge } from "./desktopRecoveryBridge"

const PHRASE = "abandon ability able about above absent absorb abstract absurd abuse access accident"

const begun = {
  ok: true,
  handle: "h1",
  credentialId: "cred",
  sealing_public_key: "seal",
  signing_public_key: "sign",
} as const

describe("desktop recovery bridge (#14122)", () => {
  test("#given a phrase recovery #when the engine begins #then only the account and public hints reach desktop main", async () => {
    // given
    const sent: unknown[] = []
    const bridge = desktopRecoveryBridge(async (data) => {
      sent.push(data)
      return begun
    }, false)

    // when
    const result = await bridge.recoverBeginWithPhrase?.({ account: "acct", hints: [] })

    // then
    expect(result).toEqual(begun)
    expect(sent).toEqual([{ op: "recoverBeginPhrase", account: "acct", hints: [] }])
    expect(JSON.stringify(sent)).not.toContain(PHRASE.split(" ")[0])
  })

  test("#given desktop main refuses #when the engine begins #then the typed refusal comes back", async () => {
    const bridge = desktopRecoveryBridge(async () => ({ ok: false, reason: "cancelled" }), true)
    expect(await bridge.recoverBegin({ account: "a", rpId: "r", salts: [], knownCredentialIds: [], acknowledgeUnknown: false })).toEqual({
      ok: false,
      reason: "cancelled",
    })
  })

  test("#given a reply that carries private material or the wrong shape #when parsed #then it is refused", async () => {
    const bridge = desktopRecoveryBridge(async () => ({ ok: true, handle: "h" }), true)
    await expect(
      bridge.recoverBegin({ account: "a", rpId: "r", salts: [], knownCredentialIds: [], acknowledgeUnknown: false }),
    ).rejects.toThrow()
  })

  test("#given an abort #when the engine aborts #then main gets the handle only", async () => {
    const sent: unknown[] = []
    const bridge = desktopRecoveryBridge(async (data) => {
      sent.push(data)
      return { op: "recoverAbort" }
    }, true)
    await bridge.recoverAbort("h9")
    expect(sent).toEqual([{ op: "recoverAbort", handle: "h9" }])
  })
})
