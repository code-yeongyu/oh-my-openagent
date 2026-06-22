import type { RunCommand } from "./types"
import type { LazyCodexInstallCliArgs } from "./lazycodex-cli-args"

export type LazyCodexDelegatedCommand = Extract<LazyCodexInstallCliArgs, { readonly kind: "command" }>

export type DelegatedOmoInvocation = {
  readonly command: string
  readonly args: readonly string[]
  readonly delegatesToOmo: boolean
}

export async function runDelegatedOmoCommand(
  parsed: LazyCodexDelegatedCommand,
  options: {
    readonly cwd: string
    readonly log: (line: string) => void
    readonly runCommand: RunCommand
  },
): Promise<void> {
  const invocation = buildDelegatedOmoInvocation(parsed)
  if (parsed.dryRun) {
    options.log(`${invocation.command} ${invocation.args.join(" ")}`)
    return
  }
  const env = invocation.delegatesToOmo ? { ...process.env, OMO_INVOCATION_NAME: "omo" } : process.env
  await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd, env })
}

export function buildDelegatedOmoInvocation(parsed: LazyCodexDelegatedCommand): DelegatedOmoInvocation {
  if (parsed.command === "doctor") return buildLazyCodexDoctorInvocation(parsed.args)

  const args = ["--yes", "--package", "oh-my-openagent", "omo", parsed.command]
  if (parsed.command === "install") {
    args.push("--platform=codex")
    if (parsed.noTui) args.push("--no-tui")
    if (parsed.skipAuth) args.push("--skip-auth")
    if (parsed.autonomousPermissions !== false) args.push("--codex-autonomous")
    if (parsed.autonomousPermissions === false) args.push("--no-codex-autonomous")
    if (parsed.repoRoot) args.push(`--repo-root=${parsed.repoRoot}`)
  } else if (parsed.command === "cleanup") {
    args.push("--platform=codex", ...parsed.args)
  } else {
    args.push(...parsed.args)
  }
  return { command: "npx", args, delegatesToOmo: true }
}

function buildLazyCodexDoctorInvocation(doctorArgs: readonly string[]): DelegatedOmoInvocation {
  return {
    command: "codex",
    args: [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--cd",
      ".",
      buildLazyCodexDoctorPrompt(doctorArgs),
    ],
    delegatesToOmo: false,
  }
}

function buildLazyCodexDoctorPrompt(doctorArgs: readonly string[]): string {
  return [
    "Use $omo:lcx-doctor to diagnose this LazyCodex/Codex installation.",
    "This command is already the lazycodex doctor surface, so do not invoke lazycodex doctor recursively.",
    "Sync the latest LazyCodex and OpenAI Codex sources into /tmp, inventory the local installation,",
    "probe the Codex plugin/cache/hooks/MCP state, and report PASS/WARN/FAIL findings with evidence and remediations.",
    doctorArgs.length > 0 ? `Requested doctor arguments: ${doctorArgs.join(" ")}` : "Requested doctor arguments: none",
  ].join(" ")
}
