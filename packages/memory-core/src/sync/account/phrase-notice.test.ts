import { afterEach, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { genesisIntentLocation } from "../genesis/intent-store.ts"
import { writePhraseGenesisMarker } from "../genesis/phrase-marker.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import { enableSync } from "./enable.ts"
import { phraseNoticeStatus } from "./phrase-notice.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"
import { openGate, phraseGenesis, scriptedSurface } from "./testing/phrase-enable.test-support.ts"
import { remainingTestTime } from "../../../../../test-support/test-deadline.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

/** Resolves on the child's first stdout line equal to `line`; fails with a message at the test budget. */
const firstLine = async (stream: ReadableStream<Uint8Array>, line: string): Promise<void> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let seen = ""
  const read = (async () => {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error(`child exited before printing ${line}; saw: ${seen.slice(-200)}`)
      seen += decoder.decode(chunk.value)
      if (seen.split("\n").includes(line)) return
    }
  })()
  const timeout = Bun.sleep(remainingTestTime()).then(() => {
    throw new Error(`waited out the test budget for the child to print ${line}`)
  })
  try {
    await Promise.race([read, timeout])
  } finally {
    reader.releaseLock()
  }
}

test("#given a process killed after the phrase was shown and before the intent was stored #when status is read twice with no enable between #then both reads report the void phrase, and the next enable reclaims the dead lock and asks for acknowledgement", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  const place = { pinDir: f.input.pinDir, account: ACCOUNT, principalId: f.keyring.principal().id }
  const child = Bun.spawn(["bun", join(import.meta.dir, "testing/phrase-crash.fixture.ts")], {
    env: {
      ...process.env,
      PHRASE_CRASH_URL: f.server.url,
      PHRASE_CRASH_TOKEN: f.server.tokenFor(f.prepared.body.bootstrap.first_device, "service-first"),
      PHRASE_CRASH_PIN_DIR: f.input.pinDir,
    },
    stdout: "pipe",
    stderr: "inherit",
  })
  cleanups.push(async () => {
    child.kill("SIGKILL")
    await child.exited
  })
  await firstLine(child.stdout, "SHOWN")
  expect(await phraseNoticeStatus(place)).toEqual({ inProgress: true })
  child.kill("SIGKILL")
  await child.exited
  await stat(`${genesisIntentLocation(f.input.pinDir, ACCOUNT, place.principalId)}.lock`)

  expect(await phraseNoticeStatus(place)).toEqual({ phraseVoid: { purpose: "genesis" } })
  expect(await phraseNoticeStatus(place)).toEqual({ phraseVoid: { purpose: "genesis" } })

  const person = scriptedSurface()
  const genesis = {
    prfSupported: false,
    phraseSupported: true,
    createGenesis: f.input.genesis.createGenesis,
    createPhraseGenesis: phraseGenesis(person.surface),
  }
  expect(await enableSync({ ...f.input, genesis, method: "phrase", phraseGate: openGate() })).toEqual({
    kind: "acknowledge_required",
    phraseVoid: { purpose: "genesis" },
  })
  expect(person.calls.show).toBe(0)
  expect(f.server.switches).toEqual([])
}, 60_000)

test("#given a phrase genesis that committed and a crash after its intent was retired #when status is read #then the leftover marker matches the pinned root and reads as saved, not void", async () => {
  const f = await fixture()
  cleanups.push(f.close)
  const place = { pinDir: f.input.pinDir, account: ACCOUNT, principalId: f.keyring.principal().id }
  const genesis = {
    prfSupported: false,
    phraseSupported: true,
    createGenesis: f.input.genesis.createGenesis,
    createPhraseGenesis: phraseGenesis(scriptedSurface().surface),
  }
  expect(await enableSync({ ...f.input, genesis, method: "phrase", phraseGate: openGate() })).toEqual({
    kind: "joined",
    created: true,
  })
  const pin = await loadTrustAnchor(f.input.pinDir, ACCOUNT)
  if (!pin.ok) throw new Error("expected a pin after the phrase genesis")
  await writePhraseGenesisMarker(place, {
    version: 1,
    account: ACCOUNT,
    startedAt: 3,
    genesisDigest: pin.anchor.genesisDigest,
  })
  expect(await phraseNoticeStatus(place)).toEqual({})
})
