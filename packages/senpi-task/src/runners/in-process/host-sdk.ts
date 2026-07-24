import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import type { ChildSession } from "./child-handle"

export function resolveHostSenpiSdkEntry(cliEntry: string | undefined): string | undefined {
  if (cliEntry === undefined || !existsSync(cliEntry)) return undefined
  const distDir = dirname(realpathSync(cliEntry))
  if (basename(distDir) !== "dist") return undefined
  const sdkEntry = join(distDir, "index.js")
  return existsSync(sdkEntry) ? sdkEntry : undefined
}

export async function createChildSessionFromHostSdk(
  sdkEntry: string,
  options: CreateAgentSessionOptions,
): Promise<ChildSession> {
  const sdk: unknown = await import(pathToFileURL(sdkEntry).href)
  if (!isRecord(sdk)) throw new Error("Host Senpi SDK did not export a module object")
  const createAgentSession = Reflect.get(sdk, "createAgentSession")
  if (typeof createAgentSession !== "function") throw new Error("Host Senpi SDK did not export createAgentSession")
  const created: unknown = await Reflect.apply(createAgentSession, undefined, [options])
  const session = isRecord(created) ? Reflect.get(created, "session") : undefined
  if (!isChildSession(session)) throw new Error("Host Senpi SDK returned an invalid child session")
  return session
}

function isChildSession(value: unknown): value is ChildSession {
  if (!isRecord(value) || typeof value.sessionId !== "string") return false
  return typeof value.prompt === "function"
    && typeof value.steer === "function"
    && typeof value.followUp === "function"
    && typeof value.abort === "function"
    && typeof value.subscribe === "function"
    && typeof value.getLastAssistantText === "function"
    && typeof value.dispose === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
