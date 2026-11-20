import { createInterface } from "node:readline/promises"

import { type CeremonyClock, disableSync, enableSync, joinAccount } from "../memory-core/src/sync/account/index.ts"
import { createPhraseGenesisBridge } from "../memory-core/src/sync/genesis/phrase-bridge.ts"
import { type PhraseGate, readServiceFloor } from "../memory-core/src/sync/genesis/phrase-gate.ts"
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
import { approve, spacedCode } from "./sync-approve-cli"
import { deliverVoidNotice } from "./sync-void-notice"
import { CREATION_UNAVAILABLE, phraseCreationGuidance, RUN_IT_YOURSELF } from "./sync-creation-guidance"
import { readEngineSyncStatus, type EngineSyncRead } from "./sync-engine-status"
import { recover, recoverRefused } from "./sync-recover-cli"
import { collectSyncStatus, syncStatusLines } from "./sync-status-cli"

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
  /**
   * The service floor reader; tests inject one. Absent, the gate reads the service's own `accepts_phrase_keys`
   * fresh for every creation through the operation's signed-in chain, and any failure refuses (#13631).
   */
  readonly phraseFloor?: PhraseGate["serviceFloor"]
  /** Reads the running engine's sync state for `omo sync status`; this machine's operator socket by default. */
  readonly engineStatus?: () => Promise<EngineSyncRead>
}

export const PHRASE_GENESIS_FLAG = "OMO_MEMORY_SYNC_PHRASE_GENESIS"
const CANCELLED = "Turning on memory sync was cancelled. Nothing was saved."

// Review L9: an enrollment or rotation also holds this lock, so the line must not say "turning on sync".
const RECOVERY_CEREMONY_RUNNING =
  "Another OmO window or terminal on this device is in the middle of a recovery setup. Finish or cancel it there, then run `omo sync enable` again."

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
// The ceremony pinned, but the retired pins could not be read, so a changed history cannot be ruled out (#12382).
const rootCheckSkipped = (reason: string): string =>
  `This device could not check whether this account's memory history changed (${reason}). If you did not reset memory sync, check your devices.`

type PhraseSetup = { readonly refused: boolean; readonly gate: PhraseGate }

const phraseSetup = (
  dependencies: SyncCommandDependencies,
  env: Readonly<Record<string, string | undefined>>,
): PhraseSetup => ({
  // Checked before any secret exists: an agent harness, CI, or no controlling terminal never sees words (sec 7).
  refused: agentMarkerSet(env) || !(dependencies.terminalAvailable ?? controllingTerminalAvailable)(),
  gate: {
    enabled: env[PHRASE_GENESIS_FLAG] === "1",
    serviceFloor: dependencies.phraseFloor ?? readServiceFloor,
    refused: (reason, account) =>
      dependencies.error(`memory sync refused to create a recovery phrase (${reason}) for account ${account}.`),
  },
})

async function enable(dependencies: SyncCommandDependencies, context: SyncContext): Promise<number> {
  const env = dependencies.env ?? process.env
  const setup = phraseSetup(dependencies, env)
  const surface = setup.refused
    ? null
    : lazyTerminalSurface(dependencies.terminal ?? openControllingTerminal, context.account)
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
  let outcome: Awaited<ReturnType<typeof enableSync>>
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
      if (outcome.rootCheck !== undefined) dependencies.error(rootCheckSkipped(outcome.rootCheck.reason))
      return 0
    case "in_progress":
      dependencies.error(RECOVERY_CEREMONY_RUNNING)
      return 1
    case "cancelled":
      dependencies.error(CANCELLED)
      return 1
    case "phrase_unavailable":
      dependencies.error(phraseCreationGuidance[outcome.reason])
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
      if (joined.rootCheck !== undefined) dependencies.error(rootCheckSkipped(joined.rootCheck.reason))
      return 0
    case "expired":
      dependencies.error("The request expired before another device approved it. Run `omo sync enable` again.")
      return 1
    case "refused":
      dependencies.error(`This device did not join: ${joined.reason}. Run \`omo sync enable\` again.`)
      return 1
  }
}

/** Turns sync off on this device only (#14093): its switch on the service, then the local one; memory stays. */
async function disable(dependencies: SyncCommandDependencies, context: SyncContext): Promise<number> {
  const outcome = await disableSync(context)
  if (outcome.kind === "refused") {
    dependencies.error("The service did not turn memory sync off for this device. Run `omo sync disable` again.")
    return 1
  }
  dependencies.output(
    "Memory sync is off for this device. Memory on this device stays as it is, and your other devices keep syncing.",
  )
  dependencies.output("Run `omo sync enable` to turn it on again.")
  return 0
}

const defaultDependencies = (): SyncCommandDependencies => ({
  context: () => signedInSyncContext({ env: process.env, cwd: process.cwd() }),
  clock: {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
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
    .command("disable")
    .description("Turn memory sync off for this device only; memory on this device stays")
    .action(() => run(dependencies, (context) => disable(dependencies, context)))
  sync
    .command("status")
    .description("Show this device's memory sync state, the account's devices and the running engine")
    .option("--json", "print one JSON object")
    .action((options: { readonly json?: boolean }) =>
      run(dependencies, async (context) => {
        const report = await collectSyncStatus(
          context,
          dependencies.engineStatus ?? (() => readEngineSyncStatus(dependencies.env)),
        )
        if (options.json === true) dependencies.output(JSON.stringify(report))
        else for (const line of syncStatusLines(report)) dependencies.output(line)
        return 0
      }),
    )
  sync
    .command("approve [id]")
    .description("Approve a device that is waiting to join, after comparing the code on both screens")
    .action((id: string | undefined) => run(dependencies, (context) => approve(dependencies, context, id)))
  sync
    .command("recover")
    .description("Recover memory after losing every device")
    .action(async () => {
      if (recoverRefused(dependencies)) {
        process.exitCode = EXIT_UNSUPPORTED_HERE
        return
      }
      await run(dependencies, (context) => recover(dependencies, context))
    })
}

export async function runSyncCommand(args: readonly string[]): Promise<void> {
  const { Command: Program } = await import("commander")
  const program = new Program("omo")
  configureSyncCommands(program)
  await program.parseAsync([...args], { from: "user" })
}
