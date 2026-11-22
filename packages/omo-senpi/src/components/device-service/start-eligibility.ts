import { isAbsolute } from "node:path"
import { OMO_SENPI_TASK_RPC_CHILD } from "@oh-my-opencode/senpi-task/rpc-spawn"

type Env = Readonly<Record<string, string | undefined>>

export const isCi = (env: Env): boolean => {
  const ci = env.CI?.trim().toLowerCase()
  return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false"
}

export const skipsDeviceService = (env: Env): boolean => isCi(env) || env[OMO_SENPI_TASK_RPC_CHILD] === "1"

export const absolutePath = (value: unknown): value is string => typeof value === "string" && isAbsolute(value)
