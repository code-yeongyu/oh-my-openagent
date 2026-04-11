import {
  BEADS_RUNTIME_LIST_IN_PROGRESS_CLI_CONTRACT,
  BEADS_RUNTIME_READY_CLI_CONTRACT,
  BEADS_RUNTIME_SHOW_CLI_CONTRACT,
  type BeadsRuntimeCliContract,
  type BeadsRuntimeListResult,
  type BeadsRuntimeReadyResult,
  type BeadsRuntimeShowResult,
} from "./cli-contracts"
import {
  type BeadsRuntimeCommandRunner,
  runBeadsRuntimeCommand,
} from "./br-command-runner"
import {
  assertBeadsRuntimeCapabilities,
  probeBeadsRuntimeCapabilities,
} from "./capability-probe"
import {
  createBeadsRuntimeCapabilityError,
  createBeadsRuntimeContractError,
} from "./errors"

interface BeadsRuntimeReadArgs {
  cwd: string
  runner?: BeadsRuntimeCommandRunner
}

function getCommandLabel(command: readonly string[]): string {
  return command.join(" ")
}

async function assertContractIsSupported(args: {
  contract: BeadsRuntimeCliContract<unknown>
  runner: BeadsRuntimeCommandRunner
  cwd: string
}): Promise<void> {
  const probe = await probeBeadsRuntimeCapabilities(args.runner, args.cwd)
  assertBeadsRuntimeCapabilities(probe)

  const capability = probe.capabilities.find((entry) => entry.name === args.contract.name)
  if (capability?.supported) {
    return
  }

  throw createBeadsRuntimeCapabilityError({
    message: `beads runtime requires ${getCommandLabel(args.contract.command)} support before the read adapter can continue`,
    details: {
      command: getCommandLabel(args.contract.command),
      cwd: args.cwd,
      missingFlags: capability?.missingFlags ?? [...args.contract.requiredFlags],
    },
  })
}

async function executeReadContract<T>(args: {
  contract: BeadsRuntimeCliContract<T>
  command: readonly string[]
  cwd: string
  runner?: BeadsRuntimeCommandRunner
}): Promise<T> {
  const runner = args.runner ?? runBeadsRuntimeCommand
  await assertContractIsSupported({
    contract: args.contract,
    runner,
    cwd: args.cwd,
  })

  const result = await runner({ command: args.command, cwd: args.cwd })
  if (result.exitCode !== 0) {
    throw createBeadsRuntimeContractError({
      message: `beads runtime expected ${getCommandLabel(args.command)} to succeed from the resolved worktree root`,
      details: {
        command: getCommandLabel(args.command),
        cwd: args.cwd,
        exitCode: result.exitCode,
        stderr: result.stderr,
      },
    })
  }

  return args.contract.parse(result.stdout ?? "")
}

export async function readBeadsRuntimeReady(
  args: BeadsRuntimeReadArgs,
): Promise<BeadsRuntimeReadyResult> {
  return executeReadContract({
    contract: BEADS_RUNTIME_READY_CLI_CONTRACT,
    command: BEADS_RUNTIME_READY_CLI_CONTRACT.command,
    cwd: args.cwd,
    runner: args.runner,
  })
}

export async function readBeadsRuntimeInProgress(
  args: BeadsRuntimeReadArgs,
): Promise<BeadsRuntimeListResult> {
  return executeReadContract({
    contract: BEADS_RUNTIME_LIST_IN_PROGRESS_CLI_CONTRACT,
    command: BEADS_RUNTIME_LIST_IN_PROGRESS_CLI_CONTRACT.command,
    cwd: args.cwd,
    runner: args.runner,
  })
}

export async function readBeadsRuntimeIssueDetails(args: {
  beadID: string
  cwd: string
  runner?: BeadsRuntimeCommandRunner
}): Promise<BeadsRuntimeShowResult> {
  return executeReadContract({
    contract: BEADS_RUNTIME_SHOW_CLI_CONTRACT,
    command: ["br", "show", args.beadID, "--json"],
    cwd: args.cwd,
    runner: args.runner,
  })
}
