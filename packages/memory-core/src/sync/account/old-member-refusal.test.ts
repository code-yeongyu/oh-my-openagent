import { afterEach, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { KeyringEntry } from "../crypto/entry.ts"
import { jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts"
import { signedAppend } from "../recovery/keyring-append.ts"
import { enableSync } from "./enable.ts"
import { principalOf } from "./join.ts"
import { openAccountSession } from "./session.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

const snapshot = async (dir: string): Promise<ReadonlyArray<string>> => {
  const out: string[] = []
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) await walk(full)
      else out.push(`${full}:${(await readFile(full)).toString("base64")}`)
    }
  }
  await walk(dir)
  return out.sort()
}

// Contract r3 sec 8 / review M5: an engine whose parser does not know a recovery-key label (exactly a pre-phrase
// engine meeting "phrase") must stop with an error and never re-create a genesis, overwrite its pin, append, store
// an intent or touch the switches. An unknown label takes the same parseBody -> null -> bad_record path.
test("#given a pinned member whose served chain gains a recovery-key record its parser refuses #when enable and the sync session open #then both stop with an error and nothing is written", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  expect(await enableSync(f.input)).toEqual({ kind: "joined", created: true })
  const genesis = f.entries[0]
  if (genesis === undefined || genesis.kind !== "keyring") throw new Error("expected the genesis entry")
  const body = {
    kind: "recovery-key",
    account: ACCOUNT,
    epoch: 1,
    credential_id: "AAAAAAAAAAAAAAAAAAAAAA",
    rp_id: "omo-sync/v1/recovery-later",
    enrollment_nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sealing_public_key: f.keyring.publicKeys().sealing,
    signing_public_key: f.keyring.publicKeys().signing,
    survivable: "quantum",
    countersign: "AA",
    wraps_digest: "AA",
  }
  const appended = await signedAppend(f.keyring, genesis, body, [])
  const unknown: KeyringEntry = {
    seq: 2,
    kind: "keyring",
    account: ACCOUNT,
    epoch: 1,
    author: principalOf(f.keyring),
    body: appended.record,
    digest: await sha256B64(jcsBytes(appended.record)),
    base_seq: appended.base_seq,
    link: appended.link,
    keyring_link: appended.keyring_link,
    record_sig: appended.record_sig,
    wraps: [],
  }
  f.entries.push(unknown)
  const before = await snapshot(f.input.pinDir)
  const appendsBefore = f.server.keyAppendsReceived
  f.server.switches.length = 0

  await expect(enableSync(f.input)).rejects.toThrow()
  const token = f.server.tokenFor(principalOf(f.keyring), "service-first")
  expect(
    await openAccountSession({
      baseUrl: f.server.url,
      token: () => token,
      account: ACCOUNT,
      keyring: f.keyring,
      pinDir: f.input.pinDir,
      spaceId: new Uint8Array(16).fill(3),
    }),
  ).toMatchObject({ ok: false })

  expect(f.ceremonies()).toBe(1)
  expect(f.server.keyAppendsReceived).toBe(appendsBefore)
  expect(f.server.switches).toEqual([])
  expect(f.entries.length).toBe(2)
  expect(await snapshot(f.input.pinDir)).toEqual(before)
})
