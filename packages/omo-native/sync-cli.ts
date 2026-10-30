import { createInterface } from "node:readline/promises"

import { approveDevice, type CeremonyClock, enableSync, joinAccount } from "../memory-core/src/sync/account/index.ts"
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
}

const RECOVER_ELSEWHERE =
  "Recovering memory with your passkey runs in the OmO desktop app, which can use the passkey on this computer. " +
  "On a machine without it, approve this device from a device that already syncs: run `omo sync enable` here, then `omo sync approve` there."

const FIRST_DEVICE =
  "Your account has no synced memory yet. Turn memory sync on first in the OmO desktop app, which sets up the recovery passkey, " +
  "then run `omo sync enable` here to join."

const spacedCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`

async function run(dependencies: SyncCommandDependencies, action: (context: SyncContext) => Promise<number>): Promise<void> {
  try {
    process.exitCode = await action(await dependencies.context())
  } catch (error) {
    dependencies.error(error instanceof SignInError || error instanceof Error ? error.message : "omo sync: the operation failed")
    process.exitCode = 1
  }
}

async function enable(dependencies: SyncCommandDependencies, context: SyncContext): Promise<number> {
  const outcome = await enableSync(context)
  if (outcome.kind === "joined") {
    dependencies.output("Memory sync is on for this device.")
    return 0
  }
  if (outcome.kind === "needs_first_device") {
    dependencies.error(FIRST_DEVICE)
    return EXIT_UNSUPPORTED_HERE
  }
  dependencies.output("Approve this device from a device that already syncs: run `omo sync approve` there, or use the desktop app. Waiting...")
  const joined = await joinAccount({ ...context, clock: dependencies.clock, showCode: (code) => dependencies.output(`Check that both screens show ${spacedCode(code)}.`) })
  switch (joined.kind) {
    case "joined":
      dependencies.output("This device joined your memory. Memory sync is on.")
      return 0
    case "expired":
      dependencies.error("The request expired before another device approved it. Run `omo sync enable` again.")
      return 1
    case "refused":
      dependencies.error(`This device did not join: ${joined.reason}. Run \`omo sync enable\` again.`)
      return 1
  }
}

async function approve(dependencies: SyncCommandDependencies, context: SyncContext, requested: string | undefined): Promise<number> {
  if (!dependencies.interactive) {
    dependencies.error("Approving a device needs an interactive terminal, so you can compare the code on both screens.")
    return 1
  }
  const waiting = (await context.pairing.listPending()).filter((row) => row.answer === null)
  const chosen = requested === undefined ? (waiting.length === 1 ? waiting[0] : undefined) : waiting.find((row) => row.id === requested)
  if (chosen === undefined) {
    if (waiting.length === 0) dependencies.error("No device is waiting to join. Run `omo sync enable` on the new device first.")
    else dependencies.error(`More than one device is waiting. Run \`omo sync approve <id>\` with one of: ${waiting.map((row) => row.id).join(", ")}`)
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
      dependencies.error("Not approved. If the codes differed, someone may be intercepting the pairing; start again from the new device.")
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

export function configureSyncCommands(program: Command, dependencies: SyncCommandDependencies = defaultDependencies()): void {
  const sync = program.command("sync").description("End-to-end encrypted memory sync")
  sync.command("enable").description("Turn memory sync on for this device, joining your memory if needed").action(() => run(dependencies, (context) => enable(dependencies, context)))
  sync
    .command("approve [id]")
    .description("Approve a device that is waiting to join, after comparing the code on both screens")
    .action((id: string | undefined) => run(dependencies, (context) => approve(dependencies, context, id)))
  sync.command("recover").description("Recover memory after losing every device").action(() => {
    dependencies.error(RECOVER_ELSEWHERE)
    process.exitCode = EXIT_UNSUPPORTED_HERE
  })
}

export async function runSyncCommand(args: readonly string[]): Promise<void> {
  const { Command: Program } = await import("commander")
  const program = new Program("omo")
  configureSyncCommands(program)
  await program.parseAsync([...args], { from: "user" })
}
