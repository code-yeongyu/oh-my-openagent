import type { BeadsRuntimeCliContract } from "./cli-contracts"

import { BEADS_RUNTIME_CLI_CONTRACTS } from "./cli-contracts"
import type { BeadsRuntimeCommandOutput, BeadsRuntimeCommandRunner } from "./br-command-runner"
import { createBeadsRuntimeCapabilityError } from "./errors"

export interface BeadsRuntimeCapabilityStatus {
  name: string
  command: readonly string[]
  required: boolean
  supported: boolean
  missingFlags: string[]
}

export interface BeadsRuntimeCapabilityProbeResult {
  ok: boolean
  binaryAvailable: boolean
  capabilities: BeadsRuntimeCapabilityStatus[]
}

function getProbeOutput(result: BeadsRuntimeCommandOutput): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`
}

async function probeContract(
  runner: BeadsRuntimeCommandRunner,
  cwd: string,
  contract: BeadsRuntimeCliContract<unknown>,
): Promise<BeadsRuntimeCapabilityStatus> {
  const result = await runner({ command: contract.helpCommand, cwd })
  if (result.exitCode !== 0) {
    return {
      name: contract.name,
      command: contract.helpCommand,
      required: contract.requiredForRuntime,
      supported: false,
      missingFlags: [...contract.requiredFlags],
    }
  }

  const output = getProbeOutput(result)
  const missingFlags = contract.requiredFlags.filter((flag) => !output.includes(flag))
  return {
    name: contract.name,
    command: contract.helpCommand,
    required: contract.requiredForRuntime,
    supported: missingFlags.length === 0,
    missingFlags,
  }
}

export async function probeBeadsRuntimeCapabilities(
  runner: BeadsRuntimeCommandRunner,
  cwd: string,
): Promise<BeadsRuntimeCapabilityProbeResult> {
  const binaryResult = await runner({ command: ["br", "--help"], cwd })
  if (binaryResult.exitCode !== 0) {
    return {
      ok: false,
      binaryAvailable: false,
      capabilities: BEADS_RUNTIME_CLI_CONTRACTS.map((contract) => ({
        name: contract.name,
        command: contract.helpCommand,
        required: contract.requiredForRuntime,
        supported: false,
        missingFlags: [...contract.requiredFlags],
      })),
    }
  }

  const capabilities = await Promise.all(
    BEADS_RUNTIME_CLI_CONTRACTS.map((contract) => probeContract(runner, cwd, contract)),
  )
  return {
    ok: capabilities.every((capability) => !capability.required || capability.supported),
    binaryAvailable: true,
    capabilities,
  }
}

export function assertBeadsRuntimeCapabilities(
  result: BeadsRuntimeCapabilityProbeResult,
): void {
  if (!result.binaryAvailable) {
    throw createBeadsRuntimeCapabilityError({
      message: "beads runtime requires the br CLI to be installed before attach or reconcile can proceed",
    })
  }

  const missingRequiredCapabilities = result.capabilities.filter(
    (capability) => capability.required && !capability.supported,
  )
  if (missingRequiredCapabilities.length === 0) {
    return
  }

  throw createBeadsRuntimeCapabilityError({
    message:
      "beads runtime attach and reconcile require br ready --json and br list --status in_progress --json capability support",
    details: {
      missing: missingRequiredCapabilities.map((capability) => ({
        name: capability.name,
        command: capability.command.join(" "),
        missingFlags: capability.missingFlags,
      })),
    },
  })
}
