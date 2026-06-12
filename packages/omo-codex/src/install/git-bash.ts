import {
  GIT_BASH_ENV_KEY,
  WINGET_INSTALL_ARGS,
  resolveGitBash as resolveSharedGitBash,
  resolveGitBashForCurrentProcess as resolveSharedGitBashForCurrentProcess,
  type GitBashResolution as SharedGitBashResolution,
  type GitBashResolverInput,
} from "@oh-my-opencode/utils/runtime"
import type { RunCommand } from "./types"
import type { GitBashResolution } from "./types"

const SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY = "OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL"

export type { GitBashResolution } from "./types"
export type { GitBashResolverInput, GitBashSource } from "@oh-my-opencode/utils/runtime"

export const resolveGitBash = (input: GitBashResolverInput): GitBashResolution =>
  toCodexResolution(resolveSharedGitBash(input))

export const resolveGitBashForCurrentProcess = (input: {
  readonly platform?: string
  readonly env?: { readonly [key: string]: string | undefined }
} = {}): GitBashResolution => {
  return toCodexResolution(resolveSharedGitBashForCurrentProcess(input))
}

export async function prepareGitBashForInstall(input: {
  readonly platform: string
  readonly env: { readonly [key: string]: string | undefined }
  readonly cwd: string
  readonly runCommand: RunCommand
  readonly resolveGitBash?: () => GitBashResolution
}): Promise<GitBashResolution> {
  const resolve = input.resolveGitBash ?? (() => resolveGitBashForCurrentProcess({ platform: input.platform, env: input.env }))
  const initialResolution = resolve()
  if (input.platform !== "win32" || initialResolution.found) return initialResolution
  if (input.env[SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY] === "1") return initialResolution

  try {
    await input.runCommand("winget", WINGET_INSTALL_ARGS, { cwd: input.cwd })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return initialResolution
  }

  return resolve()
}

function toCodexResolution(resolution: SharedGitBashResolution): GitBashResolution {
  if (resolution.found) {
    return {
      found: true,
      path: resolution.path,
      source: resolution.source,
    }
  }

  return {
    ...resolution,
    installHint: [
      "Git Bash is required for native Windows Codex profile installs.",
      "Install it with: winget install --id Git.Git -e --source winget",
      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\path\\to\\bash.exe`,
      "Then rerun `npx lazycodex-ai install`.",
    ].join("\n"),
  }
}
