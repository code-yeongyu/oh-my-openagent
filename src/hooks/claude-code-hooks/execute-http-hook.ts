import type { HookHttp } from "./types"
import type { CommandResult } from "../../shared/command-executor/execute-hook-command"

const DEFAULT_HTTP_HOOK_TIMEOUT_S = 30

export function interpolateEnvVars(
  value: string,
  allowedEnvVars: string[]
): string {
  const allowedSet = new Set(allowedEnvVars)

  let result = value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    if (allowedSet.has(varName)) {
      return process.env[varName] ?? ""
    }
    return ""
  })

  result = result.replace(/\$(\w+)/g, (_match, varName: string) => {
    if (allowedSet.has(varName)) {
      return process.env[varName] ?? ""
    }
    return ""
  })

  return result
}

function resolveHeaders(
  hook: HookHttp
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (!hook.headers) return headers

  const allowedEnvVars = hook.allowedEnvVars ?? []
  for (const [key, value] of Object.entries(hook.headers)) {
    headers[key] = interpolateEnvVars(value, allowedEnvVars)
  }

  return headers
}

export async function executeHttpHook(
  hook: HookHttp,
  stdin: string
): Promise<CommandResult> {
  const timeoutS = hook.timeout ?? DEFAULT_HTTP_HOOK_TIMEOUT_S
  const headers = resolveHeaders(hook)

  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers,
      body: stdin,
      signal: AbortSignal.timeout(timeoutS * 1000),
    })

    if (!response.ok) {
      return {
        exitCode: 1,
        stderr: `HTTP hook returned status ${response.status}: ${response.statusText}`,
        stdout: await response.text().catch(() => ""),
      }
    }

    const body = await response.text()
    if (!body) {
      return { exitCode: 0, stdout: "", stderr: "" }
    }

    try {
      const parsed = JSON.parse(body) as { exitCode?: number }
      if (typeof parsed.exitCode === "number") {
        return { exitCode: parsed.exitCode, stdout: body, stderr: "" }
      }
    } catch {
    }

    return { exitCode: 0, stdout: body, stderr: "" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 1, stderr: `HTTP hook error: ${message}` }
  }
}
