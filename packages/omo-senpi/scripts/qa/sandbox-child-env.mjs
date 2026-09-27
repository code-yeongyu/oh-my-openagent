import { AGENT_DIR_ENV_NAMES } from "./task-host-e2e-sandbox.mjs"

/**
 * Variables that route a task runner to a daemon socket before its agent dir is consulted
 * (`resolveTaskHostSocket` in senpi-task). An inherited one sends a QA child to a real host.
 */
export const HOST_ROUTING_ENV_NAMES = ["OMO_RPC_SOCKET", "SENPI_RPC_SOCKET", "PI_RPC_SOCKET", "OMO_RPC_SOCKET_PATH"]

/** Identity of the session that launched the driver; a sandboxed child must never claim it. */
export const SESSION_IDENTITY_ENV_NAMES = [
  "PI_SESSION_ID",
  "PI_SESSION_FILE",
  "PI_SESSION_CWD",
  "PI_GOAL_STORE_FILE",
  "SENPI_SESSION_FILE",
  "SENPI_PY_KERNEL_PARENT_PID",
]

const HOST_INTERNAL_ENV_PREFIX = "SENPI_RPC_HOST_"

/**
 * The environment of a child a QA driver launches: the caller's environment without anything that
 * points at the caller's own install, host or session, and every agent-dir lane on the sandbox.
 * The omo launcher exports OMO_CODING_AGENT_DIR to every tool child and that lane outranks
 * SENPI_CODING_AGENT_DIR, so overriding one lane alone put QA children on the production host
 * (oh-my-openagent#8967).
 */
export function isolatedChildEnv(baseEnv, agentDir) {
  const env = { ...baseEnv }
  for (const name of Object.keys(env)) {
    if (name.startsWith(HOST_INTERNAL_ENV_PREFIX)) delete env[name]
  }
  for (const name of [...HOST_ROUTING_ENV_NAMES, ...SESSION_IDENTITY_ENV_NAMES]) delete env[name]
  for (const name of AGENT_DIR_ENV_NAMES) env[name] = agentDir
  return env
}
