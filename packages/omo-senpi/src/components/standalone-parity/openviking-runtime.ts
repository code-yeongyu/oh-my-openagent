import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type { OpenVikingLifecycle } from "./openviking"

export interface PackagedOpenVikingOptions {
  readonly parityRoot: string
  readonly dataRoot: string
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
}

export async function createPackagedOpenVikingLifecycle(
  options: PackagedOpenVikingOptions,
): Promise<OpenVikingLifecycle> {
  const pluginRoot = join(options.parityRoot, "openviking-plugin")
  const [configModule, sessionModule, injectionModule, recallModule] = await Promise.all([
    loadModule(join(pluginRoot, "lib", "config.mjs")),
    loadModule(join(pluginRoot, "lib", "memory-session.mjs")),
    loadModule(join(pluginRoot, "lib", "session-inject.mjs")),
    loadModule(join(pluginRoot, "lib", "memory-recall.mjs")),
  ])
  const config = withEnvironment(options.environment, () => invokeFactory(configModule, "loadConfig", [pluginRoot, options.cwd]))
  await mkdir(options.dataRoot, { recursive: true })
  const sessionManager = invokeFactory(sessionModule, "createMemorySessionManager", [{ config, pluginRoot: options.dataRoot }])
  const sessionInjection = invokeFactory(injectionModule, "createSessionInject", [{ config, sessionManager }])
  const memoryRecall = invokeFactory(recallModule, "createMemoryRecall", [{ config, sessionManager }])
  await safeInvoke(sessionManager, "init", [])

  return {
    async start(sessionId): Promise<string | undefined> {
      return safeOperation(async () => {
        await invokeMethod(sessionManager, "handleEvent", [{ type: "session.created", sessionId }])
        const output = turnOutput(sessionId, "session-start", "")
        await invokeMethod(sessionInjection, "injectSessionContext", [turnInput(sessionId, "session-start"), output])
        return injectedContext(output, "")
      })
    },

    async recall(sessionId, query): Promise<string | undefined> {
      return safeOperation(async () => {
        const output = turnOutput(sessionId, "recall", query)
        await invokeMethod(memoryRecall, "injectRelevantMemories", [turnInput(sessionId, "recall"), output])
        return injectedContext(output, query)
      })
    },

    async capture(sessionId, role, content, eventId): Promise<void> {
      if (role !== "assistant") return
      await safeOperation(async () => {
        const messageId = eventId ?? `assistant-${Date.now()}`
        await invokeMethod(sessionManager, "handleEvent", [{
          type: "message.updated",
          properties: { info: { id: messageId, sessionID: sessionId, role, finish: "stop" } },
        }])
        await invokeMethod(sessionManager, "handleEvent", [{
          type: "message.part.updated",
          properties: { part: { id: `${messageId}:text`, messageID: messageId, sessionID: sessionId, type: "text", text: content } },
        }])
        await invokeMethod(sessionManager, "flushSession", [sessionId, { commit: false, reason: "message_end" }])
      })
    },

    async compact(sessionId): Promise<void> {
      await safeOperation(() => invokeMethod(sessionManager, "handleEvent", [{ type: "session.compacted", sessionId }]))
    },

    async shutdown(sessionId): Promise<void> {
      await safeOperation(() => invokeMethod(sessionManager, "handleEvent", [{ type: "session.deleted", sessionId }]))
    },

    async flushRetries(): Promise<void> {
      await safeOperation(() => invokeMethod(sessionManager, "flushAll", [{ commit: true }]))
    },
  }
}

async function loadModule(path: string): Promise<unknown> {
  const loaded: unknown = await import(pathToFileURL(path).href)
  return loaded
}

function invokeFactory(module: unknown, name: string, args: readonly unknown[]): unknown {
  if (module === null || typeof module !== "object") throw new Error(`invalid OpenViking module: ${name}`)
  const factory = Reflect.get(module, name)
  if (typeof factory !== "function") throw new Error(`missing OpenViking export: ${name}`)
  return Reflect.apply(factory, undefined, args)
}

async function invokeMethod(target: unknown, name: string, args: readonly unknown[]): Promise<unknown> {
  if (target === null || typeof target !== "object") throw new Error(`invalid OpenViking target: ${name}`)
  const method = Reflect.get(target, name)
  if (typeof method !== "function") throw new Error(`missing OpenViking method: ${name}`)
  return Promise.resolve(Reflect.apply(method, target, args))
}

async function safeInvoke(target: unknown, name: string, args: readonly unknown[]): Promise<void> {
  await safeOperation(() => invokeMethod(target, name, args))
}

async function safeOperation<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation()
  } catch {
    return undefined
  }
}

function turnInput(sessionId: string, messageId: string): Record<string, unknown> {
  return { sessionID: sessionId, messageID: messageId }
}

function turnOutput(sessionId: string, messageId: string, text: string): Record<string, unknown> {
  return {
    message: { sessionID: sessionId, id: messageId },
    parts: text.length === 0 ? [] : [{ id: `${messageId}:input`, sessionID: sessionId, messageID: messageId, type: "text", text }],
  }
}

function injectedContext(output: Record<string, unknown>, originalText: string): string | undefined {
  const parts = Reflect.get(output, "parts")
  if (!Array.isArray(parts)) return undefined
  for (const part of parts) {
    if (part === null || typeof part !== "object") continue
    const text = Reflect.get(part, "text")
    if (typeof text !== "string" || text === originalText) continue
    return text
      .replace(/^<openviking-context[^>]*>\s*/u, "")
      .replace(/\s*<\/openviking-context>$/u, "")
  }
  return undefined
}

function withEnvironment<T>(environment: Readonly<Record<string, string>>, operation: () => T): T {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, process.env[key])
    process.env[key] = value
  }
  try {
    return operation()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
