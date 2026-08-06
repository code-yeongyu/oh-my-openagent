import {
  GIT_BASH_ENV_KEY,
  resolveGitBash as resolveSharedGitBash,
  resolveGitBashForCurrentProcess as resolveSharedGitBashForCurrentProcess,
  type GitBashResolution as SharedGitBashResolution,
  type GitBashResolverInput,
} from "@oh-my-opencode/utils/runtime"
import type { GitBashResolution } from "./types"

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
  readonly resolveGitBash?: () => GitBashResolution
}): Promise<GitBashResolution> {
  const resolve = input.resolveGitBash ?? (() => resolveGitBashForCurrentProcess({ platform: input.platform, env: input.env }))
  const initialResolution = resolve()
  return initialResolution
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
