import { join } from "node:path"

import type { DenyLivePlan } from "./plan"

export const SANDBOX_ENV = "OMO_SANDBOX"

/**
 * The confined child's environment: its agent dir is the private view, and every cache and temp dir
 * a test runner or package manager writes under $HOME is redirected into its own tmp dir. Git's
 * fsmonitor (a socket per command) is off and husky does not install hooks.
 */
export function confinedEnv(plan: DenyLivePlan, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const tmp = plan.tmpDir
  const gitConfigCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10)
  const gitIndex = Number.isInteger(gitConfigCount) && gitConfigCount >= 0 ? gitConfigCount : 0
  return {
    ...env,
    OMO_CODING_AGENT_DIR: plan.viewDir,
    SENPI_CODING_AGENT_DIR: plan.viewDir,
    TMPDIR: tmp,
    XDG_CACHE_HOME: join(tmp, "xdg-cache"),
    XDG_STATE_HOME: join(tmp, "xdg-state"),
    XDG_DATA_HOME: join(tmp, "xdg-data"),
    BUN_INSTALL_CACHE_DIR: join(tmp, "bun-cache"),
    npm_config_cache: join(tmp, "npm-cache"),
    YARN_CACHE_FOLDER: join(tmp, "yarn-cache"),
    PIP_CACHE_DIR: join(tmp, "pip-cache"),
    UV_CACHE_DIR: join(tmp, "uv-cache"),
    GOCACHE: join(tmp, "go-cache"),
    HUSKY: "0",
    GIT_CONFIG_COUNT: String(gitIndex + 1),
    [`GIT_CONFIG_KEY_${gitIndex}`]: "core.fsmonitor",
    [`GIT_CONFIG_VALUE_${gitIndex}`]: "false",
    [SANDBOX_ENV]: "deny-live",
  }
}
