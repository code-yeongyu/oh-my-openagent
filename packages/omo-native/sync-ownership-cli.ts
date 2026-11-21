// `omo sync ownership` answers memory sync when it cannot tell which account a device's memory belongs to (#14491
// follow-up). "use" uploads that memory to the signed-in account, across an account boundary, so it is the person's
// own choice: it refuses under an agent harness or without a controlling terminal (as phrase genesis does), shows how
// many memory files go to which account, and records nothing without a yes. "set-aside" moves nothing off the device.

import { readdir } from "node:fs/promises"
import { join, resolve } from "node:path"

import { resolveMemoryRoot } from "../memory-core/src/identity/layout.ts"
import {
  decideOwnership,
  type DecideResult,
  type OwnershipChoice,
  readUndecided,
  type UndecidedNotice,
} from "../memory-core/src/sync/engine/ownership-decision.ts"
import { agentMarkerSet, controllingTerminalAvailable } from "./sync-phrase-tty"
import type { SyncCommandDependencies } from "./sync-cli"

export const RUN_OWNERSHIP_YOURSELF = "Run `omo sync ownership use` yourself in a terminal."

interface Waiting {
  readonly repo: string
  readonly notice: UndecidedNotice
}

async function waitingRepos(memoryRoot: string, account: string): Promise<Waiting[]> {
  const agents = join(memoryRoot, "agents")
  const names = await readdir(agents).catch(() => [])
  const found: Waiting[] = []
  for (const name of names.sort()) {
    const repo = join(agents, name, "repo")
    const notice = await readUndecided(join(repo, ".git"))
    if (notice?.account === account) found.push({ repo, notice })
  }
  return found
}

/** `use` is refused before any credential is read when an agent harness asks or no person is at a terminal. */
export function ownershipUseRefused(dependencies: SyncCommandDependencies): boolean {
  const env = dependencies.env ?? process.env
  if (!agentMarkerSet(env) && (dependencies.terminalAvailable ?? controllingTerminalAvailable)()) return false
  dependencies.error("Using this memory with your account uploads it there, so only you can choose it.")
  dependencies.error(RUN_OWNERSHIP_YOURSELF)
  return true
}

function pick(dependencies: SyncCommandDependencies, waiting: readonly Waiting[], repo?: string): Waiting | null {
  const chosen = repo === undefined ? waiting : waiting.filter((w) => w.repo === resolve(repo))
  if (chosen.length === 1) return chosen[0] ?? null
  if (chosen.length === 0) dependencies.error("No memory on this device is waiting for this choice.")
  else {
    dependencies.error("More than one memory is waiting for this choice; name one with --repo:")
    for (const w of chosen) dependencies.error(`  ${w.repo} (${w.notice.files} memory files)`)
  }
  return null
}

function report(dependencies: SyncCommandDependencies, result: DecideResult, choice: OwnershipChoice): number {
  switch (result.kind) {
    case "recorded":
      dependencies.output(
        choice === "use"
          ? "Recorded. Memory sync uploads this memory to your account at its next run."
          : "Recorded. Memory sync sets this memory aside at its next run; nothing leaves this device.",
      )
      return 0
    case "changed":
      dependencies.error(
        `The memory changed since it was counted (now ${result.files} files). Nothing was recorded; run the command again.`,
      )
      return 1
    case "other_account":
      dependencies.error(
        `This memory is waiting for account ${result.account}, not the one signed in. Nothing was recorded.`,
      )
      return 1
    case "not_undecided":
      dependencies.error("This memory is no longer waiting for this choice. Nothing was recorded.")
      return 1
  }
}

export async function ownership(
  dependencies: SyncCommandDependencies,
  account: string,
  choice: OwnershipChoice | null,
  repo?: string,
): Promise<number> {
  const env = dependencies.env ?? process.env
  const waiting = await waitingRepos(resolveMemoryRoot({ ...env }, process.cwd()), account)
  if (choice === null) {
    if (waiting.length === 0) dependencies.output("No memory on this device is waiting for an account choice.")
    for (const w of waiting)
      dependencies.output(`${w.repo}: ${w.notice.files} memory files wait for a choice for account ${w.notice.account}`)
    return 0
  }
  const target = pick(dependencies, waiting, repo)
  if (target === null) return 1
  const { files } = target.notice
  if (
    choice === "use" &&
    !(await dependencies.confirm(`Upload ${files} memory files from ${target.repo} to account ${account}?`))
  ) {
    dependencies.error("Nothing was recorded; this memory stays on this device and nothing is uploaded.")
    return 1
  }
  return report(
    dependencies,
    await decideOwnership(join(target.repo, ".git"), account, choice, choice === "use" ? files : 0),
    choice,
  )
}
