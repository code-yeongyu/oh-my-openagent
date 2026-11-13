import { afterEach, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"
import { derivePhraseKeys, generateRecoveryPhrase } from "../recovery/phrase.ts"
import { enableSync } from "./enable.ts"
import { phraseNoticeStatus } from "./phrase-notice.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"
import { phraseGenesis, scriptedGate, scriptedSurface } from "./testing/phrase-enable.test-support.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

const files = async (dir: string): Promise<string> => {
  let out = ""
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out += (await readFile(join(entry.parentPath, entry.name))).toString("latin1")
  }
  return out
}

// Contract sec 4 / review L1: E in every encoding, the 24 words and the derived private keys never reach any sink a
// ceremony writes: outcomes, status, the logger and refusal lines, every file under the pin dir (intent, markers,
// pins), and everything the service received. The test phrase is a fixed vector (fill 9, nonce fill 41).
test("#given a phrase genesis and a refused one #when every sink is captured #then no canary for E, the words or the derived private keys appears", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  const entropy = new Uint8Array(32).fill(9)
  const reference = generateRecoveryPhrase((bytes) => void bytes.set(entropy))
  const words = reference.reveal()
  const keys = await derivePhraseKeys(reference, ACCOUNT, new Uint8Array(32).fill(41))
  const canaries = [
    Buffer.from(entropy).toString("hex"),
    Buffer.from(entropy).toString("base64"),
    b64urlEncode(entropy),
    Buffer.from(entropy).toString("latin1"),
    words.join(" "),
    Buffer.from(keys.sealPrivate).toString("hex"),
    b64urlEncode(keys.sealPrivate),
    Buffer.from(keys.signSeed).toString("hex"),
    b64urlEncode(keys.signSeed),
  ]
  reference.dispose()

  const logged: string[] = []
  const refusing = scriptedGate(true, "off")
  const { method: _passkey, ...base } = f.input
  const genesis = {
    prfSupported: false,
    phraseSupported: true,
    createGenesis: f.input.genesis.createGenesis,
    createPhraseGenesis: phraseGenesis(scriptedSurface().surface),
  }
  const refused = await enableSync({ ...base, genesis, method: "phrase", phraseGate: refusing.gate })
  const opened = scriptedGate(true, "on")
  const gate = {
    ...opened.gate,
    refused: (reason: string, account: string) => void logged.push(`${reason} ${account}`),
  }
  const created = await enableSync({ ...base, genesis, method: "phrase", phraseGate: gate })
  expect(created).toEqual({ kind: "joined", created: true })

  const sinks = [
    JSON.stringify([refused, created, refusing.refusals, logged]),
    JSON.stringify(
      await phraseNoticeStatus({ pinDir: f.input.pinDir, account: ACCOUNT, principalId: f.keyring.principal().id }),
    ),
    await files(f.input.pinDir),
    JSON.stringify(f.entries),
    JSON.stringify(f.server.syncHeaders),
  ].join("\n")
  expect(canaries.filter((canary) => sinks.includes(canary))).toEqual([])
  // Single words are matched as whole words: "cover" inside the non-secret "recovery" is not a leak.
  const sinkWords = new Set(sinks.toLowerCase().split(/[^a-z]+/u))
  expect(words.filter((word) => word.length >= 5 && sinkWords.has(word))).toEqual([])
})
