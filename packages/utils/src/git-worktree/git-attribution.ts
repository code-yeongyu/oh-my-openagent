import * as childProcess from "node:child_process"

const gitConfigCache = new Map<string, string | null>()

export function clearGitAttributionCache(): void {
  gitConfigCache.clear()
}

export function parseGitBoolean(val: string | undefined): boolean | undefined {
  if (!val) return undefined
  const normalized = val.trim().toLowerCase()
  if (["false", "0", "no", "off"].includes(normalized)) return false
  if (["true", "1", "yes", "on"].includes(normalized)) return true
  return undefined
}

export interface GitAttributionCheckOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  readonly gitConfigReader?: (key: string, cwd?: string) => string | undefined
}

export interface GitAttributionConfigLike {
  readonly commit_footer?: boolean | string
  readonly include_co_authored_by?: boolean
}

export interface ResolvedGitAttribution {
  readonly commitFooter: boolean | string
  readonly includeCoAuthoredBy: boolean
  readonly suppressed: boolean
  readonly reason?: "env_disabled" | "git_config_disabled" | "env_enabled" | "git_config_enabled" | "explicit_config" | "default"
}

function defaultGitConfigReader(key: string, cwd?: string): string | undefined {
  const targetCwd = cwd ?? process.cwd()
  const cacheKey = `${targetCwd}:${key}`
  if (gitConfigCache.has(cacheKey)) {
    const cached = gitConfigCache.get(cacheKey)
    return cached === null ? undefined : cached
  }

  try {
    const val = childProcess.execFileSync("git", ["config", "--get", key], {
      cwd: targetCwd,
      encoding: "utf-8",
      timeout: 1000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    gitConfigCache.set(cacheKey, val)
    return val
  } catch {
    gitConfigCache.set(cacheKey, null)
    return undefined
  }
}

function customFooterOrFalse(config?: GitAttributionConfigLike): boolean | string {
  return typeof config?.commit_footer === "string" && config.commit_footer !== "auto"
    ? config.commit_footer
    : false
}

function customFooterOrTrue(config?: GitAttributionConfigLike): boolean | string {
  return typeof config?.commit_footer === "string" && config.commit_footer !== "auto"
    ? config.commit_footer
    : true
}

/**
 * Checks whether AI attribution should be suppressed in Git commits based on
 * environment variables or native Git config.
 */
export function shouldSuppressGitAttribution(options: GitAttributionCheckOptions = {}): {
  readonly suppressed: boolean
  readonly reason?: "env_disabled" | "git_config_disabled" | "default"
} {
  const env = options.env ?? process.env

  // 1. Environment variable checks
  const noAiAttribution = env.NO_AI_ATTRIBUTION
  if (noAiAttribution !== undefined && noAiAttribution !== "" && noAiAttribution !== "0" && noAiAttribution.toLowerCase() !== "false") {
    return { suppressed: true, reason: "env_disabled" }
  }

  const omoNoCommitAttribution = env.OMO_NO_COMMIT_ATTRIBUTION
  if (omoNoCommitAttribution !== undefined && omoNoCommitAttribution !== "" && omoNoCommitAttribution !== "0" && omoNoCommitAttribution.toLowerCase() !== "false") {
    return { suppressed: true, reason: "env_disabled" }
  }

  const omoGitAttribution = parseGitBoolean(env.OMO_GIT_ATTRIBUTION)
  if (omoGitAttribution === false) {
    return { suppressed: true, reason: "env_disabled" }
  }
  if (omoGitAttribution === true) {
    return { suppressed: false, reason: "default" }
  }

  // 2. Git config checks
  const readConfig = options.gitConfigReader ?? defaultGitConfigReader
  const cwd = options.cwd ?? process.cwd()

  const omoAttribution = parseGitBoolean(readConfig("omo.attribution", cwd))
  if (omoAttribution === false) {
    return { suppressed: true, reason: "git_config_disabled" }
  }
  if (omoAttribution === true) {
    return { suppressed: false, reason: "default" }
  }

  const sisyphusAttribution = parseGitBoolean(readConfig("sisyphus.attribution", cwd))
  if (sisyphusAttribution === false) {
    return { suppressed: true, reason: "git_config_disabled" }
  }
  if (sisyphusAttribution === true) {
    return { suppressed: false, reason: "default" }
  }

  return { suppressed: false, reason: "default" }
}

/**
 * Resolves the effective Git attribution parameters.
 * Default install is off (no footer, never a Co-authored-by trailer). Env and Git-config
 * overrides can suppress an opt-in footer or re-enable the builtin footer.
 */
export function resolveGitAttribution<T extends GitAttributionConfigLike>(
  config?: T,
  options: GitAttributionCheckOptions = {},
): ResolvedGitAttribution {
  const env = options.env ?? process.env

  // 1. Hard environment variable suppressions
  const noAiAttribution = env.NO_AI_ATTRIBUTION
  if (noAiAttribution !== undefined && noAiAttribution !== "" && noAiAttribution !== "0" && noAiAttribution.toLowerCase() !== "false") {
    return {
      commitFooter: customFooterOrFalse(config),
      includeCoAuthoredBy: false,
      suppressed: true,
      reason: "env_disabled",
    }
  }

  const omoNoCommitAttribution = env.OMO_NO_COMMIT_ATTRIBUTION
  if (omoNoCommitAttribution !== undefined && omoNoCommitAttribution !== "" && omoNoCommitAttribution !== "0" && omoNoCommitAttribution.toLowerCase() !== "false") {
    return {
      commitFooter: customFooterOrFalse(config),
      includeCoAuthoredBy: false,
      suppressed: true,
      reason: "env_disabled",
    }
  }

  const omoGitAttribution = parseGitBoolean(env.OMO_GIT_ATTRIBUTION)
  if (omoGitAttribution === false) {
    return {
      commitFooter: customFooterOrFalse(config),
      includeCoAuthoredBy: false,
      suppressed: true,
      reason: "env_disabled",
    }
  }
  if (omoGitAttribution === true) {
    return {
      commitFooter: customFooterOrTrue(config),
      includeCoAuthoredBy: false,
      suppressed: false,
      reason: "env_enabled",
    }
  }

  // 2. Git config overrides
  const readConfig = options.gitConfigReader ?? defaultGitConfigReader
  const cwd = options.cwd ?? process.cwd()

  const omoAttribution = parseGitBoolean(readConfig("omo.attribution", cwd))
  if (omoAttribution === false) {
    return {
      commitFooter: customFooterOrFalse(config),
      includeCoAuthoredBy: false,
      suppressed: true,
      reason: "git_config_disabled",
    }
  }
  if (omoAttribution === true) {
    return {
      commitFooter: customFooterOrTrue(config),
      includeCoAuthoredBy: false,
      suppressed: false,
      reason: "git_config_enabled",
    }
  }

  const sisyphusAttribution = parseGitBoolean(readConfig("sisyphus.attribution", cwd))
  if (sisyphusAttribution === false) {
    return {
      commitFooter: customFooterOrFalse(config),
      includeCoAuthoredBy: false,
      suppressed: true,
      reason: "git_config_disabled",
    }
  }
  if (sisyphusAttribution === true) {
    return {
      commitFooter: customFooterOrTrue(config),
      includeCoAuthoredBy: false,
      suppressed: false,
      reason: "git_config_enabled",
    }
  }

  // 3. User explicit options (default off; co-authored-by is a deprecated no-op)
  const isCustomFooter = typeof config?.commit_footer === "string" && config.commit_footer !== "auto"

  let commitFooter: boolean | string
  if (isCustomFooter) {
    commitFooter = config!.commit_footer!
  } else if (config?.commit_footer === true) {
    commitFooter = true
  } else {
    // false, undefined, or "auto" => off
    commitFooter = false
  }

  return {
    commitFooter,
    includeCoAuthoredBy: false,
    suppressed: false,
    reason: config !== undefined ? "explicit_config" : "default",
  }
}
