import { Command } from "commander"

import { createRejectionCounter } from "../../../memory-core/src/sync/crypto/rejection"
import { createRecoveryBridge } from "../../../memory-core/src/sync/recovery/bridge"
import { enrollPhraseRecoveryKey } from "../../../memory-core/src/sync/recovery/enroll-phrase"
import { generateRecoveryPhrase, TypedPhrase } from "../../../memory-core/src/sync/recovery/phrase"
import { fakeAuthenticator } from "../../../memory-core/src/sync/recovery/testing/fake-passkey.test-support"
import {
  createWorld,
  freshStateDir,
  newDevice,
  removeWorldStateDirs,
  transportFor,
} from "../../../memory-core/src/sync/recovery/testing/world.test-support"
import { configureSyncCommands } from "../../sync-cli"

// An account whose recovery phrase is the fixed test vector (fill 17), then `omo sync recover` on a fresh device
// with the REAL controlling terminal; the driver gives it a pty and redirects stdout and stderr to files.
const world = await createWorld()
let shown: ReadonlyArray<string> = []
const enrolled = await enrollPhraseRecoveryKey({
  anchor: world.anchor,
  account: world.account,
  keyring: world.owner.keyring,
  bridge: createRecoveryBridge(fakeAuthenticator(world.provider), world.owner.keyring, {
    phraseSurface: {
      show: async (phrase) => {
        shown = phrase.reveal()
        return true
      },
      confirm: async (positions) => new TypedPhrase(positions.map((p) => shown[p - 1] ?? "").join(" ")),
      enter: async () => null,
    },
    phraseRandom: { phrase: () => generateRecoveryPhrase((bytes) => void bytes.fill(17)), positions: () => [1, 2, 3] },
  }),
  chain: { ...transportFor(world, world.owner), listEntriesAfter: async () => null, state: async () => null },
  rejections: createRejectionCounter(),
  pinDir: freshStateDir(),
  phraseGate: { enabled: true, serviceFloor: async () => "on", refused: () => undefined },
})
if (!enrolled.ok) throw new Error("fixture enrollment failed")
const fresh = await newDevice()
const unused = async (): Promise<never> => {
  throw new Error("not used by recover")
}
const program = new Command("omo").exitOverride()
configureSyncCommands(program, {
  context: async () => ({
    account: world.account,
    serviceDeviceId: "svc-fresh",
    keyring: fresh.keyring,
    pinDir: freshStateDir(),
    chain: { ...transportFor(world, fresh), listEntriesAfter: async () => null, state: async () => null },
    pairing: {
      setAccountSync: unused,
      setDeviceSync: unused,
      listPending: unused,
      openPending: unused,
      readPending: unused,
      answerPending: unused,
      revealPending: unused,
    },
    authority: { signal: new AbortController().signal, admit: (dispatch) => dispatch() },
  }),
  clock: { now: () => 0, sleep: async () => undefined },
  output: (line) => console.log(line),
  error: (line) => console.error(line),
  confirm: async () => false,
  interactive: true,
  env: process.env,
})
try {
  await program.parseAsync(["sync", "recover"], { from: "user" })
} finally {
  removeWorldStateDirs()
}
process.exit(process.exitCode ?? 0)
