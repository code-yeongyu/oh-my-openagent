import { Command } from "commander"

import { createRejectionCounter } from "../../memory-core/src/sync/crypto/rejection"
import { createRecoveryBridge } from "../../memory-core/src/sync/recovery/bridge"
import { enrollPhraseRecoveryKey } from "../../memory-core/src/sync/recovery/enroll-phrase"
import { generateRecoveryPhrase, TypedPhrase } from "../../memory-core/src/sync/recovery/phrase"
import { fakeAuthenticator } from "../../memory-core/src/sync/recovery/testing/fake-passkey.test-support"
import {
  createWorld,
  freshStateDir,
  newDevice,
  transportFor,
} from "../../memory-core/src/sync/recovery/testing/world.test-support"
import { configureSyncCommands, type SyncCommandDependencies } from "../sync-cli"
import type { PhraseTerminal } from "../sync-phrase-tty"

export const OFFLINE = {
  baseUrl: "https://unused.invalid",
  token: () => {
    throw new Error("unexpected HTTP request")
  },
}

export const words = (fill: number): ReadonlyArray<string> => {
  const phrase = generateRecoveryPhrase((bytes) => void bytes.fill(fill))
  const out = phrase.reveal()
  phrase.dispose()
  return out
}
export const ENROLLED = words(17)

const enrolledAccount = async () => {
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
      phraseRandom: {
        phrase: () => generateRecoveryPhrase((bytes) => void bytes.fill(17)),
        positions: () => [1, 2, 3],
      },
    }),
    chain: { ...transportFor(world, world.owner), listEntriesAfter: async () => null, state: async () => null },
    rejections: createRejectionCounter(),
    pinDir: freshStateDir(),
    phraseGate: { enabled: true, serviceFloor: async () => "on", refused: () => undefined },
  })
  if (!enrolled.ok) throw new Error("fixture enrollment failed")
  return world
}

export const typing = (entries: ReadonlyArray<string>) => {
  const written: string[] = []
  let opened = 0
  let next = 0
  const open = (): PhraseTerminal => {
    opened += 1
    return {
      write: (text) => void written.push(text),
      readLine: async () => (next < entries.length ? (entries[next++] ?? null) : null),
      close: () => undefined,
    }
  }
  return { open, written, opened: () => opened }
}

const unused = async (): Promise<never> => {
  throw new Error("not used by recover")
}

type RecoverSetup = {
  readonly plain?: boolean
  readonly chain?: Record<string, unknown>
  readonly contexts?: { count: number }
  readonly pairing?: Record<string, unknown>
  readonly pinDir?: string
}

/** The service's read gate (svc sync/store/consent.ts): a pull answers 200 only once both switches are on. */
export const consentService = (failDevice = false) => {
  const state = { account: false, device: false }
  return {
    state,
    pull: (): 200 | 403 => (state.account && state.device ? 200 : 403),
    pairing: {
      setAccountSync: async (on: boolean) => {
        state.account = on
      },
      setDeviceSync: async (_device: string, on: boolean) => {
        if (failDevice) throw new Error("device switch unavailable")
        state.device = on
      },
    },
  }
}

export const runRecover = async (dependencies: Partial<SyncCommandDependencies>, setup: RecoverSetup = {}) => {
  const world = setup.plain === true ? await createWorld() : await enrolledAccount()
  const fresh = await newDevice()
  const out: string[] = []
  const err: string[] = []
  const pinDir = setup.pinDir ?? freshStateDir()
  const initial = process.exitCode
  const program = new Command("omo").exitOverride()
  configureSyncCommands(program, {
    context: async () => {
      if (setup.contexts !== undefined) setup.contexts.count += 1
      return {
        account: world.account,
        serviceDeviceId: "svc-fresh",
        keyring: fresh.keyring,
        pinDir,
        chain: {
          ...transportFor(world, fresh),
          listEntriesAfter: async () => null,
          state: async () => null,
          ...setup.chain,
        },
        pairing: {
          setAccountSync: async () => undefined,
          setDeviceSync: async () => undefined,
          disableDeviceSync: unused,
          listPending: unused,
          openPending: unused,
          readPending: unused,
          answerPending: unused,
          revealPending: unused,
          ...setup.pairing,
        },
        authority: { signal: new AbortController().signal, admit: (dispatch) => dispatch() },
      }
    },
    clock: { now: () => 0, sleep: async () => undefined },
    output: (line) => void out.push(line),
    error: (line) => void err.push(line),
    confirm: async () => false,
    interactive: true,
    env: {},
    terminalAvailable: () => true,
    ...dependencies,
  })
  await program.parseAsync(["sync", "recover"], { from: "user" })
  const exit = process.exitCode
  process.exitCode = initial ?? 0
  return { world, out, err, exit, pinDir }
}
