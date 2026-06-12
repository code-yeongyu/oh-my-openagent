import type { RunCommand } from "./types"
import type { LazyCodexInstallCliArgs } from "./lazycodex-cli-args"

export type LazyCodexDelegatedCommand = Extract<LazyCodexInstallCliArgs, { readonly kind: "command" }>

export type DelegatedOmoInvocation = {
  readonly command: string
  readonly args: readonly string[]
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
  const env = { ...process.env, OMO_INVOCATION_NAME: "omo" }
  await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd, env })
}

export function buildDelegatedOmoInvocation(parsed: LazyCodexDelegatedCommand): DelegatedOmoInvocation {
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
  return { command: "npx", args }
}
