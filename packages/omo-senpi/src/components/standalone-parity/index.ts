import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import type { OpenVikingLifecycle } from "./openviking"
import { createPackagedOpenVikingLifecycle } from "./openviking-runtime"
import { parseRuntimeCommands, parseRuntimeMcps, type RuntimeCommand, type RuntimeMcp, StandaloneParityRuntimeVerificationError, verifyRuntimePayload } from "./verification"

export interface StandaloneParityComponentOptions {
  readonly betaRoot: string
  readonly parityRoot?: string
  readonly homeDir?: string
  readonly openVikingLifecycle?: OpenVikingLifecycle
}

export function createStandaloneParityComponent(options: StandaloneParityComponentOptions): OmoSenpiComponent {
  const parityRoot = options.parityRoot ?? join(options.betaRoot, "standalone-parity", "current")
  const expectedHome = join(options.betaRoot, "home")
  const homeDir = options.homeDir ?? homedir()
  const initialOpenVikingContext = new Map<string, string>()
  return {
    name: "standalone-parity",
    async register(pi: SenpiExtensionAPI, ctx: ComponentContext): Promise<void> {
      if (resolve(homeDir) !== resolve(expectedHome) || !existsSync(join(parityRoot, "manifest.json"))) return
      let manifest
      try {
        manifest = await verifyRuntimePayload(parityRoot)
      } catch (error: unknown) {
        if (error instanceof StandaloneParityRuntimeVerificationError) {
          ctx.logger.warn("standalone parity payload rejected", { reason: error.message })
          return
        }
        throw error
      }
      const commands = await loadCommands(join(parityRoot, "commands.json"))
      const mcps = await loadMcps(join(parityRoot, "mcps.json"))
      let openVikingLifecycle = options.openVikingLifecycle
      if (openVikingLifecycle === undefined && existsSync(join(parityRoot, "openviking-plugin", "package.json"))) {
        try {
          openVikingLifecycle = await createPackagedOpenVikingLifecycle({
            parityRoot,
            dataRoot: join(options.betaRoot, "standalone-parity", "runtime", "openviking"),
            cwd: pi.cwd ?? process.cwd(),
            environment: openVikingEnvironment(mcps),
          })
        } catch {
          ctx.logger.warn("standalone parity OpenViking lifecycle unavailable")
        }
      }
      pi.on("resources_discover", () => ({ skillPaths: manifest.skills.map((skill) => join(parityRoot, "skills", skill)) }))
      pi.on("before_agent_start", (payload: unknown, eventContext?: unknown) => injectTurnContext(
        payload,
        eventContext,
        join(parityRoot, manifest.instructionsPath),
        openVikingLifecycle,
        initialOpenVikingContext,
      ))
      for (const command of commands) pi.registerCommand(command.name, createCommandRegistration(command, pi))
      if (typeof pi.registerMcpServer === "function") {
        for (const mcp of mcps) pi.registerMcpServer(mcp.name, resolveMcpDeclaration(mcp.declaration, parityRoot))
      }
      if (openVikingLifecycle !== undefined) registerOpenVikingEvents(pi, openVikingLifecycle, initialOpenVikingContext)
    },
  }
}

function openVikingEnvironment(mcps: readonly RuntimeMcp[]): Record<string, string> {
  const declaration = mcps.find((mcp) => mcp.name === "openviking")?.declaration
  const environment = declaration === undefined ? undefined : recordField(declaration, "env")
  if (environment === undefined) return {}
  return Object.fromEntries(Object.entries(environment).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []))
}

function resolveMcpDeclaration(declaration: Record<string, unknown>, parityRoot: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(declaration).map(([key, value]) => [key, resolveMcpValue(value, parityRoot)]))
}

function resolveMcpValue(value: unknown, parityRoot: string): unknown {
  if (typeof value === "string") return value.replaceAll("${OMO_STANDALONE_PARITY_ROOT}", parityRoot)
  if (Array.isArray(value)) return value.map((item) => resolveMcpValue(item, parityRoot))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveMcpValue(item, parityRoot)]))
  }
  return value
}

function registerOpenVikingEvents(
  pi: SenpiExtensionAPI,
  lifecycle: OpenVikingLifecycle,
  initialContext: Map<string, string>,
): void {
  pi.on("session_start", async (payload: unknown, eventContext?: unknown) => {
    const sessionId = resolveSessionId(payload, eventContext)
    if (sessionId === undefined) return
    const context = await lifecycle.start(sessionId)
    if (context !== undefined) initialContext.set(sessionId, context)
  })
  pi.on("message_end", async (payload: unknown, eventContext?: unknown) => {
    const sessionId = resolveSessionId(payload, eventContext)
    const message = recordField(payload, "message")
    if (sessionId === undefined || message === undefined || stringField(message, "role") !== "assistant") return
    const content = messageText(message)
    if (content.length === 0) return
    await lifecycle.capture(sessionId, "assistant", content, stringField(message, "id"))
  })
  pi.on("session_compact", async (payload: unknown, eventContext?: unknown) => {
    if (valueField(payload, "accepted") === false) return
    const sessionId = resolveSessionId(payload, eventContext)
    if (sessionId !== undefined) await lifecycle.compact(sessionId)
  })
  pi.on("session_shutdown", async (payload: unknown, eventContext?: unknown) => {
    const sessionId = resolveSessionId(payload, eventContext)
    if (sessionId !== undefined) {
      await lifecycle.shutdown(sessionId)
      initialContext.delete(sessionId)
    }
    await lifecycle.flushRetries()
  })
}

async function loadCommands(path: string): Promise<readonly RuntimeCommand[]> {
  return parseRuntimeCommands(JSON.parse(await readFile(path, "utf8")))
}

async function loadMcps(path: string): Promise<readonly RuntimeMcp[]> {
  return parseRuntimeMcps(JSON.parse(await readFile(path, "utf8")))
}

function createCommandRegistration(command: RuntimeCommand, pi: SenpiExtensionAPI): Record<string, unknown> {
  return {
    description: command.description,
    handler: (args: unknown) => {
      const renderedArgs = typeof args === "string" ? args : ""
      const positional = parseCommandArguments(renderedArgs)
      const rendered = command.template
        .replaceAll("$ARGUMENTS", renderedArgs)
        .replace(/\$(\d+)/gu, (_match, index: string) => positional[Number(index) - 1] ?? "")
      pi.sendUserMessage(rendered)
    },
  }
}

function parseCommandArguments(source: string): readonly string[] {
  const values: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  let escaped = false
  for (const character of source.trim()) {
    if (escaped) {
      current += character
      escaped = false
    } else if (character === "\\") escaped = true
    else if (quote !== undefined && character === quote) quote = undefined
    else if (quote === undefined && (character === "'" || character === '"')) quote = character
    else if (quote === undefined && /\s/u.test(character)) {
      if (current.length > 0) {
        values.push(current)
        current = ""
      }
    } else current += character
  }
  if (escaped) current += "\\"
  if (current.length > 0) values.push(current)
  return values
}

async function injectInstructions(payload: unknown, instructionsPath: string): Promise<{ readonly systemPrompt: string } | undefined> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const prompt = Reflect.get(payload, "systemPrompt")
  if (typeof prompt !== "string") return undefined
  if (!existsSync(instructionsPath)) return undefined
  if (prompt.includes("<!-- omo-standalone-parity:instructions -->")) return { systemPrompt: prompt }
  const instructions = await readFile(instructionsPath, "utf8")
  return { systemPrompt: `${prompt}\n\n<!-- omo-standalone-parity:instructions -->\n${instructions}\n<!-- /omo-standalone-parity:instructions -->` }
}

async function injectTurnContext(
  payload: unknown,
  eventContext: unknown,
  instructionsPath: string,
  lifecycle: OpenVikingLifecycle | undefined,
  initialContext: Map<string, string>,
): Promise<{ readonly systemPrompt: string } | undefined> {
  const instructions = await injectInstructions(payload, instructionsPath)
  if (instructions === undefined || lifecycle === undefined) return instructions
  const sessionId = resolveSessionId(payload, eventContext)
  if (sessionId === undefined) return instructions
  const query = stringField(payload, "prompt") ?? ""
  const recalled = query.length === 0 ? undefined : await lifecycle.recall(sessionId, query)
  const initial = initialContext.get(sessionId)
  initialContext.delete(sessionId)
  const contexts = [initial, recalled].filter((value): value is string => value !== undefined && value.length > 0)
  if (contexts.length === 0 || instructions.systemPrompt.includes('<openviking-context source="session-start">')) return instructions
  return {
    systemPrompt: `${instructions.systemPrompt}\n\n<openviking-context source="session-start">\n${contexts.join("\n\n")}\n</openviking-context>`,
  }
}

function resolveSessionId(payload: unknown, eventContext: unknown): string | undefined {
  const sessionManager = recordField(eventContext, "sessionManager")
  const getSessionId = sessionManager === undefined ? undefined : valueField(sessionManager, "getSessionId")
  const managedId = typeof getSessionId === "function" ? Reflect.apply(getSessionId, sessionManager, []) : undefined
  return (typeof managedId === "string" && managedId.length > 0 ? managedId : undefined)
    ?? stringField(eventContext, "sessionId")
    ?? stringField(recordField(eventContext, "session"), "id")
    ?? stringField(payload, "sessionId")
    ?? stringField(payload, "sessionID")
}

function messageText(message: Record<string, unknown>): string {
  const direct = stringField(message, "content") ?? stringField(message, "text")
  if (direct !== undefined) return direct
  for (const parts of [Reflect.get(message, "content"), Reflect.get(message, "parts")]) {
    if (!Array.isArray(parts)) continue
    return parts.flatMap((part) => {
      const text = stringField(part, "text")
      return text === undefined ? [] : [text]
    }).join("\n")
  }
  return ""
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const field = Reflect.get(value, key)
  return field !== null && typeof field === "object" && !Array.isArray(field) ? field : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const field = valueField(value, key)
  return typeof field === "string" ? field : undefined
}

function valueField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return Reflect.get(value, key)
}
