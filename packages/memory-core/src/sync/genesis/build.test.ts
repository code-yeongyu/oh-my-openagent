import { describe, expect, test } from "bun:test"
import { parseBody } from "../crypto/parse.ts"
import { openWrap } from "../crypto/unwrap.ts"
import { foldRefusal } from "../crypto/vendor/sync-format/fold.ts"
import { b64urlDecode, jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import { openWrapWithKey, sealWrap } from "../recovery/key-material.ts"
import { prepareGenesis } from "./prepare.ts"
import { buildGenesis } from "./build.ts"
import { bytes } from "./seal.test-support.ts"
import { ACCOUNT, entryOf, vector, walk } from "./vector.test-support.ts"
import golden from "./fixtures/genesis.json"

describe("genesis builder conformance", () => {
  test("recreates every wire byte of the builder-produced golden vector", async () => {
    const { built } = await vector()
    expect(jcsBytes(built)).toEqual(jcsBytes(golden))
  })

  test("builds a closed, linked genesis from local device and recovery keys", async () => {
    // Given real locally derived keys and test-owned deterministic sealing.
    const { built, bootstrap, keyring } = await vector()
    // When the public request crosses the existing parser and complete receiver.
    const parsed = parseBody(built.request.record)
    const result = await walk(built.request, keyring)
    // Then it anchors exactly the creator, member, recovery credential and epoch.
    expect(parsed?.kind).toBe("genesis")
    expect(Object.keys(built.request).sort()).toEqual(["base_seq", "keyring_link", "link", "record", "record_sig", "wraps"])
    expect(built.request.base_seq).toBe(0)
    expect(built.digest).toBe(await sha256B64(jcsBytes(built.request.record)))
    expect(built.request.link).toBe(await sha256B64(b64urlDecode(built.digest)))
    expect(built.request.keyring_link).toBe(built.request.link)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.state.anchored).toBe(true)
    expect(result.state.pin?.pinnedBy).toBe("creator")
    expect(result.state.genesisDigest).toBe(built.digest)
    expect(result.state.authority?.epoch).toBe(1)
    expect([...result.state.authority?.members.values() ?? []]).toEqual([bootstrap.first_device])
    expect([...result.state.authority?.registry.values() ?? []]).toEqual([bootstrap.recovery_key])
  })

  test("folds the new builder vector through the vendored service receiver", async () => {
    const { built, keyring, bootstrap } = await vector()
    const folded = foldRefusal([await entryOf(built.request, keyring)])
    expect(folded.ok).toBe(true)
    if (!folded.ok) throw new Error(folded.reason)
    expect([...folded.fold.members.values()]).toEqual([bootstrap.first_device])
    expect([...folded.fold.registry.values()]).toEqual([bootstrap.recovery_key])
  })

  test.each(["deterministic", "production"] as const)("opens both %s wraps to the same epoch-one key and empty history", async (mode) => {
    const v = await vector()
    const prepared = mode === "deterministic" ? v.prepared : await prepareGenesis(v.bootstrap, {
      ...v.capabilities,
      seal: async (address, recipient) => (await sealWrap(address, recipient, { epoch: 1, current: bytes(32, 7), history: [] })).wrap,
    })
    const built = await buildGenesis(ACCOUNT, v.keyring, prepared)
    const result = await walk(built.request, v.keyring)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    const own = result.state.received[0]?.wraps[0]
    const recoveryWrap = result.state.received[0]?.wraps[1]
    if (own === undefined || recoveryWrap === undefined) throw new Error("missing committed wraps")
    const device = await openWrap(v.keyring, own, ACCOUNT, new Map())
    const recovery = await openWrapWithKey(v.recovery.sealPrivate, v.recovery.sealPublic, recoveryWrap, { account: ACCOUNT, epoch: 1, id: recoveryWrap.id }, new Map())
    expect(device.ok).toBe(true)
    expect(recovery.ok).toBe(true)
    if (!device.ok || !recovery.ok) throw new Error("dual unwrap failed")
    expect(device.keys.current).toEqual(bytes(32, 7))
    expect(recovery.material.current).toEqual(device.keys.current)
    expect(device.keys.history.size).toBe(0)
    expect(recovery.material.history).toEqual([])
  })
})
