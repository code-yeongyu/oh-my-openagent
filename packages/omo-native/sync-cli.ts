import { createInterface } from "node:readline/promises"

import { approveDevice, type CeremonyClock, enableSync, joinAccount } from "../memory-core/src/sync/account/index.ts"
import { acknowledgePhraseVoid, type PhraseVoidNotice } from "../memory-core/src/sync/account/phrase-notice.ts"
import { createRejectionCounter } from "../memory-core/src/sync/crypto/rejection.ts"
import { createRecoveryBridge } from "../memory-core/src/sync/recovery/bridge.ts"
import type { PasskeyAuthenticator } from "../memory-core/src/sync/recovery/ports.ts"
import { recoverOnFreshDevice } from "../memory-core/src/sync/recovery/recover.ts"
import { createPhraseGenesisBridge } from "../memory-core/src/sync/genesis/phrase-bridge.ts"
import type { PhraseGate } from "../memory-core/src/sync/genesis/phrase-gate.ts"
import {
  agentMarkerSet,
  controllingTerminalAvailable,
  lazyTerminalSurface,
  openControllingTerminal,
  type PhraseTerminal,
} from "./sync-phrase-tty"
import type { Command } from "commander"

import { SignInError } from "../omo-opencode/src/cli/service-auth/protocol"
import { type SyncContext, signedInSyncContext } from "./sync-context"

export const EXIT_UNSUPPORTED_HERE = 2

export interface SyncCommandDependencies {
  readonly context: () => Promise<SyncContext>
  readonly clock: CeremonyClock
  readonly output: (line: string) => void
  readonly error: (line: string) => void
  readonly confirm: (question: string) => Promise<boolean>
  readonly interactive: boolean
  /** The environment the refusal markers and the phrase flag are read from. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Opens the controlling terminal; null when there is none. Words never go anywhere else. */
  readonly terminal?: () => PhraseTerminal | null
  readonly terminalAvailable?: () => boolean
  /** The service floor reader; absent (production until the A1.1 gate conditions hold) reads unknown and refuses. */
  readonly phraseFloor?: PhraseGate["serviceFloor"]
}

const RECOVER_ELSEWHERE =
  "Recovering memory with your passkey runs in the OmO desktop app, which can use the passkey on this computer. " +
  "On a machine without it, approve this device from a device that already syncs: run `omo sync enable` here, then `omo sync approve` there."

export const PHRASE_GENESIS_FLAG = "OMO_MEMORY_SYNC_PHRASE_GENESIS"
const RUN_IT_YOURSELF = "Run `omo sync enable` yourself in a terminal."
// A1.1-L2: creation unavailable is never worded as "recovery is optional".
const CREATION_UNAVAILABLE =
  "Turning on memory sync isn't available on this device yet. Update OmO later, or turn it on from a Mac with Touch ID."
const PHRASE_VOID = "The recovery phrase you saw was not saved to your account. Do not keep it."
const CANCELLED = "Turning on memory sync was cancelled. Nothing was saved."

// Review L9: an enrollment or rotation also holds this lock, so the line must not say "turning on sync".
const RECOVERY_CEREMONY_RUNNING =
  "Another OmO window or terminal on this device is in the middle of a recovery setup. Finish or cancel it there, then run `omo sync enable` again."

const spacedCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`

async function run(
  dependencies: SyncCommandDependencies,
  action: (context: SyncContext) => Promise<number>,
): Promise<void> {
  try {
    process.exitCode = await action(await dependencies.context())
  } catch (error) {
    dependencies.error(
      error instanceof SignInError || error instanceof Error ? error.message : "omo sync: the operation failed",
    )
    process.exitCode = 1
  }
}

// A ceremony pinned a different memory root than this device held before its keys were discarded (#12280).
const ROOT_CHANGED_JOINED =
  "This account's memory history changed since this device last joined. If you did not reset memory sync, stop and check your devices."
const ROOT_CHANGED_CREATED = "This device started a new memory history for this account."

type PhraseSetup = { readonly refused: boolean; readonly gate: PhraseGate }

const phraseSetup = (dependencies: SyncCommandDependencies, env: Readonly<Record<string, string | undefined>>): PhraseSetup => ({
  // Checked before any secret exists: an agent harness, CI, or no controlling terminal never sees words (sec 7).
  refused: agentMarkerSet(env) || !(dependencies.terminalAvailable ?? controllingTerminalAvailable)(),
  gate: {
    enabled: env[PHRASE_GENESIS_FLAG] === "1",
    ...(dependencies.phraseFloor === undefined ? {} : { serviceFloor: dependencies.phraseFloor }),
    refused: (reason, account) =>
      dependencies.error(`memory sync refused to create a recovery phrase (${reason}) for account ${account}.`),
  },
})

/**
 * Delivers a void notice (A1.1-M4): under a refusal it is printed to stderr (it holds no secret) and NEVER
 * acknowledged; otherwise it is written to the opened terminal, and only after the person presses Enter there
 * is it acknowledged. Returns whether it was acknowledged.
 */
async function deliverVoidNotice(
  dependencies: SyncCommandDependencies,
  context: SyncContext,
  notice: PhraseVoidNotice,
  refused: boolean,
): Promise<boolean> {
  const text = notice.purpose === "rotate" ? `${PHRASE_VOID} Your old recovery phrase still works.` : PHRASE_VOID
  if (refused) {
    dependencies.error(text)
    return false
  }
  const terminal = (dependencies.terminal ?? openControllingTerminal)()
  if (terminal === null) {
    dependencies.error(text)
    return false
  }
  try {
    terminal.write(`${text}\r\nPress Enter once you have read this.\r\n`)
    if ((await terminal.readLine(false)) === null) {
      // Review LOW (#13337): a cancelled notice says why nothing happened instead of exiting silently.
      dependencies.error("The notice was not confirmed, so nothing changed. Run the command again to read it.")
      return false
    }
  } finally {
    terminal.close()
  }
  await acknowledgePhraseVoid({ ...context, purpose: notice.purpose })
  return true
}

async function enable(dependencies: SyncCommandDependencies, context: SyncContext): Promise<number> {
  const env = dependencies.env ?? process.env
  const setup = phraseSetup(dependencies, env)
  const surface = setup.refused ? null : lazyTerminalSurface(dependencies.terminal ?? openControllingTerminal, context.account)
  const run = () =>
    enableSync({
      ...context,
      method: "phrase",
      phraseGate: setup.gate,
      ...(surface === null
        ? {}
        : {
            genesis: {
              prfSupported: false,
              phraseSupported: true,
              createGenesis: async () => ({ ok: false as const, reason: "unavailable" as const }),
              createPhraseGenesis: createPhraseGenesisBridge(surface),
            },
          }),
    })
  let outcome
  try {
    outcome = await run()
    if (outcome.kind === "acknowledge_required") {
      if (!(await deliverVoidNotice(dependencies, context, outcome.phraseVoid, setup.refused))) {
        if (setup.refused) dependencies.error(RUN_IT_YOURSELF)
        return EXIT_UNSUPPORTED_HERE
      }
      outcome = await run()
    }
  } finally {
    surface?.done()
  }
  if ("phraseVoid" in outcome && outcome.phraseVoid !== undefined && outcome.kind !== "acknowledge_required")
    await deliverVoidNotice(dependencies, context, outcome.phraseVoid, setup.refused)
  switch (outcome.kind) {
    case "joined":
      dependencies.output("Memory sync is on for this device.")
      if (outcome.rootChanged === true) dependencies.error(ROOT_CHANGED_CREATED)
      return 0
    case "in_progress":
      dependencies.error(RECOVERY_CEREMONY_RUNNING)
      return 1
    case "cancelled":
      dependencies.error(CANCELLED)
      return 1
    case "phrase_unavailable":
      dependencies.error(outcome.reason === "no-surface" ? RUN_IT_YOURSELF : CREATION_UNAVAILABLE)
      return EXIT_UNSUPPORTED_HERE
    case "acknowledge_required":
    case "method_required":
    case "passkey_unavailable":
      dependencies.error(CREATION_UNAVAILABLE)
      return EXIT_UNSUPPORTED_HERE
    case "join_required":
      break
  }
  dependencies.output(
    "Approve this device from a device that already syncs: run `omo sync approve` there, or use the desktop app. Waiting...",
  )
  const joined = await joinAccount({
    ...context,
    clock: dependencies.clock,
    showCode: (code) => dependencies.output(`Check that both screens show ${spacedCode(code)}.`),
  })
  switch (joined.kind) {
    case "joined":
      dependencies.output("This device joined your memory. Memory sync is on.")
      if (joined.rootChanged === true) dependencies.error(ROOT_CHANGED_JOINED)
      return 0
    case "expired":
      dependencies.error("The request expired before another device approved it. Run `omo sync enable` again.")
      return 1
    case "refused":
      dependencies.error(`This device did not join: ${joined.reason}. Run \`omo sync enable\` again.`)
      return 1
  }
}

// The CLI has no passkey authenticator: phrase recovery is the only key source it can drive.
const noPasskeys: PasskeyAuthenticator = {
  prfSupported: false,
  create: async () => null,
  assert: async () => null,
  discover: async () => null,
  signalRemoved: async () => "unsupported",
}

const RECOVER_YOURSELF = "Run `omo sync recover` yourself in a terminal."
const RECOVERED = "Your memory is recovered on this device and memory sync is on."
const RECOVERED_READ_ONLY =
  "This device can read your recovered memory, but another step is still pending before it can write. Run `omo sync recover` again later."

async function recover(dependencies: SyncCommandDependencies, context: SyncContext): Promise<number> {
  const env = dependencies.env ?? process.env
  if (agentMarkerSet(env) || !(dependencies.terminalAvailable ?? controllingTerminalAvailable)()) {
    dependencies.error(RECOVER_YOURSELF)
    dependencies.error(RECOVER_ELSEWHERE)
    return EXIT_UNSUPPORTED_HERE
  }
  const surface = lazyTerminalSurface(dependencies.terminal ?? openControllingTerminal, context.account)
  try {
    const outcome = await recoverOnFreshDevice({
      account: context.account,
      rpId: "",
      keyring: context.keyring,
      bridge: createRecoveryBridge(noPasskeys, context.keyring, { phraseSurface: surface }),
      transport: context.chain,
      rejections: createRejectionCounter(),
      stateDir: context.pinDir,
      method: "phrase",
    })
    if (outcome.ok) {
      dependencies.output(outcome.state === "recovered" ? RECOVERED : RECOVERED_READ_ONLY)
      return 0
    }
    switch (outcome.reason) {
      case "cancelled":
        dependencies.error("Recovery was cancelled. Nothing changed.")
        return 1
      case "no-recovery-key":
        dependencies.error(`This account has no recovery phrase. ${RECOVER_ELSEWHERE}`)
        return EXIT_UNSUPPORTED_HERE
      case "history-incomplete":
        dependencies.error(
          "That recovery phrase does not match this account's history. Your account history looks incomplete; check the phrase, or recover from another device.",
        )
        return 1
      default:
        dependencies.error(`Recovery did not complete (${outcome.reason}). Nothing secret was stored.`)
        return 1
    }
  } finally {
    surface.done()
  }
}

async function approve(
  dependencies: SyncCommandDependencies,
  context: SyncContext,
  requested: string | undefined,
): Promise<number> {
  if (!dependencies.interactive) {
    dependencies.error("Approving a device needs an interactive terminal, so you can compare the code on both screens.")
    return 1
  }
  const waiting = (await context.pairing.listPending()).filter((row) => row.answer === null)
  const chosen =
    requested === undefined
      ? waiting.length === 1
        ? waiting[0]
        : undefined
      : waiting.find((row) => row.id === requested)
  if (chosen === undefined) {
    if (waiting.length === 0)
      dependencies.error("No device is waiting to join. Run `omo sync enable` on the new device first.")
    else
      dependencies.error(
        `More than one device is waiting. Run \`omo sync approve <id>\` with one of: ${waiting.map((row) => row.id).join(", ")}`,
      )
    return 1
  }
  const outcome = await approveDevice({
    ...context,
    clock: dependencies.clock,
    pendingId: chosen.id,
    confirmCode: (code) => dependencies.confirm(`Does the other device show ${spacedCode(code)}?`),
  })
  switch (outcome.kind) {
    case "approved":
      dependencies.output("The device is approved and will start syncing.")
      return 0
    case "declined":
      dependencies.error(
        "Not approved. If the codes differed, someone may be intercepting the pairing; start again from the new device.",
      )
      return 1
    case "expired":
      dependencies.error("The request expired. Run `omo sync enable` on the new device again.")
      return 1
    case "refused":
      dependencies.error(`Not approved: ${outcome.reason}.`)
      return 1
  }
}

const defaultDependencies = (): SyncCommandDependencies => ({
  context: () => signedInSyncContext({ env: process.env, cwd: process.cwd() }),
  clock: { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  output: (line) => console.log(line),
  error: (line) => console.error(line),
  confirm: async (question) => {
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim())
    } finally {
      prompt.close()
    }
  },
  interactive: process.stdin.isTTY === true,
})

export function configureSyncCommands(
  program: Command,
  dependencies: SyncCommandDependencies = defaultDependencies(),
): void {
  const sync = program.command("sync").description("End-to-end encrypted memory sync")
  sync
    .command("enable")
    .description("Turn memory sync on for this device, joining your memory if needed")
    .action(() => run(dependencies, (context) => enable(dependencies, context)))
  sync
    .command("approve [id]")
    .description("Approve a device that is waiting to join, after comparing the code on both screens")
    .action((id: string | undefined) => run(dependencies, (context) => approve(dependencies, context, id)))
  sync
    .command("recover")
    .description("Recover memory after losing every device")
    .action(() => run(dependencies, (context) => recover(dependencies, context)))
}

export async function runSyncCommand(args: readonly string[]): Promise<void> {
  const { Command: Program } = await import("commander")
  const program = new Program("omo")
  configureSyncCommands(program)
  await program.parseAsync([...args], { from: "user" })
}
