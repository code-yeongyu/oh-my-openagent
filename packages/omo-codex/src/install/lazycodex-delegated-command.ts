import type { RunCommand } from "./types"
import type { LazyCodexInstallCliArgs } from "./lazycodex-cli-args"

export type LazyCodexDelegatedCommand = Extract<LazyCodexInstallCliArgs, { readonly kind: "command" }>

export type DelegatedOmoInvocation = {
  readonly command: string
  readonly args: readonly string[]
  readonly delegatesToOmo: boolean
  readonly env?: Readonly<Record<string, string>>
}

type LazyCodexDoctorOptions = {
  readonly args: readonly string[]
  readonly model?: string
  readonly sourceRoot?: string
}

export async function runDelegatedOmoCommand(
  parsed: LazyCodexDelegatedCommand,
  options: {
    readonly cwd: string
    readonly log: (line: string) => void
    readonly runCommand: RunCommand
  },
): Promise<void> {
  if (parsed.command === "doctor" && process.env.LAZYCODEX_DOCTOR_LCX_ACTIVE === "1") {
    throw new Error("Refusing recursive lazycodex doctor invocation from inside $omo:lcx-doctor")
  }
  const invocation = buildDelegatedOmoInvocation(parsed)
  if (parsed.dryRun) {
    options.log(formatShellCommand(invocation.command, invocation.args))
    return
  }
  const env = invocation.delegatesToOmo
    ? { ...process.env, OMO_INVOCATION_NAME: "omo", ...invocation.env }
    : { ...process.env, ...invocation.env }
  await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd, env })
}

export function buildDelegatedOmoInvocation(parsed: LazyCodexDelegatedCommand): DelegatedOmoInvocation {
  if (parsed.command === "doctor") return buildLazyCodexDoctorInvocation(parsed.args)

  if (parsed.command === "install") {
    const args = ["--yes", "oh-my-openagent@latest", parsed.command, "--platform=codex"]
    if (parsed.noTui) args.push("--no-tui")
    if (parsed.skipAuth) args.push("--skip-auth")
    if (parsed.autonomousPermissions !== false) args.push("--codex-autonomous")
    if (parsed.autonomousPermissions === false) args.push("--no-codex-autonomous")
    if (parsed.repoRoot) args.push(`--repo-root=${parsed.repoRoot}`)
    return { command: "npx", args, delegatesToOmo: true }
  }

  const args = ["--yes", "--package", "oh-my-openagent", "omo", parsed.command]
  if (parsed.command === "cleanup") {
    args.push("--platform=codex", ...parsed.args)
  } else {
    args.push(...parsed.args)
  }
  return { command: "npx", args, delegatesToOmo: true }
}

function buildLazyCodexDoctorInvocation(doctorArgs: readonly string[]): DelegatedOmoInvocation {
  const doctorOptions = parseLazyCodexDoctorOptions(doctorArgs)
  const codexArgs = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "danger-full-access",
    "--skip-git-repo-check",
    "--cd",
    ".",
  ]
  if (doctorOptions.model !== undefined) codexArgs.push("--model", doctorOptions.model)
  codexArgs.push(buildLazyCodexDoctorPrompt(doctorOptions.args))
  return {
    command: "codex",
    args: codexArgs,
    delegatesToOmo: false,
    env: {
      LAZYCODEX_DOCTOR_LCX_ACTIVE: "1",
      ...(doctorOptions.sourceRoot === undefined ? {} : { LAZYCODEX_SOURCE_ROOT: doctorOptions.sourceRoot }),
    },
  }
}

function buildLazyCodexDoctorPrompt(doctorArgs: readonly string[]): string {
  return [
    "Use $omo:lcx-doctor to diagnose this LazyCodex/Codex installation.",
    "This command is already the lazycodex doctor surface; never invoke lazycodex doctor from inside the doctor workflow.",
    "Use the resolved source root from LAZYCODEX_SOURCE_ROOT when set; otherwise use ${TMPDIR:-/tmp}/lazycodex-sources.",
    "Validate cached source checkouts before reuse, quarantine corrupt caches, and do not rely on /tmp/lazycodex-source.",
    "Sync the latest LazyCodex and OpenAI Codex sources there, inventory the local installation,",
    "probe the Codex plugin/cache/hooks/MCP state, and report PASS/WARN/FAIL findings with evidence and remediations.",
    buildDoctorOutputInstruction(doctorArgs),
    doctorArgs.length > 0 ? `Requested doctor arguments: ${doctorArgs.join(" ")}` : "Requested doctor arguments: none",
  ].join(" ")
}

function parseLazyCodexDoctorOptions(doctorArgs: readonly string[]): LazyCodexDoctorOptions {
  const args: string[] = []
  let model: string | undefined
  let sourceRoot: string | undefined
  let index = 0
  while (index < doctorArgs.length) {
    const arg = doctorArgs[index]
    if (arg === "--model") {
      const value = doctorArgs[index + 1]
      if (typeof value !== "string" || value.trim().length === 0) throw new Error("--model requires a value")
      model = value
      index += 2
      continue
    }
    if (typeof arg === "string" && arg.startsWith("--model=")) {
      const value = arg.slice("--model=".length)
      if (value.trim().length === 0) throw new Error("--model requires a value")
      model = value
      index += 1
      continue
    }
    if (arg === "--source-root") {
      const value = doctorArgs[index + 1]
      if (typeof value !== "string" || value.trim().length === 0) throw new Error("--source-root requires a path")
      sourceRoot = value
      index += 2
      continue
    }
    if (typeof arg === "string" && arg.startsWith("--source-root=")) {
      const value = arg.slice("--source-root=".length)
      if (value.trim().length === 0) throw new Error("--source-root requires a path")
      sourceRoot = value
      index += 1
      continue
    }
    args.push(arg)
    index += 1
  }
  return { args, ...(model === undefined ? {} : { model }), ...(sourceRoot === undefined ? {} : { sourceRoot }) }
}

function buildDoctorOutputInstruction(doctorArgs: readonly string[]): string {
  if (doctorArgs.includes("--json")) {
    return "Return exactly one JSON object with summary, environment, checks, remediations, and knownIssues fields; do not wrap it in Markdown."
  }
  return "Return the standard Markdown LazyCodex Doctor Report."
}

function formatShellCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellQuote).join(" ")
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}
