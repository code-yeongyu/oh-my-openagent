import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"
import { defaultEngineChild } from "./engine-source"
import {
  COMPUTER_ACTIONS_TOOL_NAME,
  COMPUTER_COMMAND_USAGE,
  COMPUTER_SUBCOMMANDS,
  COMPUTER_TOOL_NAME,
  type ComputerHostContext,
  ComputerHandle,
  type ComputerSettings,
  computerActionsPermissionParser,
  computerPermissionParser,
  createComputerActionsTool,
  createComputerTool,
  isSupportedHost,
  materializeComputerSkill,
  runComputerCommand,
} from "@oh-my-opencode/senpi-desktop-tool"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import type { ComputerUseTelemetryObservers } from "../telemetry/omo-native-computer-use"
import { TrackedDesktopService } from "./engine-status"
import { resolveOmoComputerSettings } from "./settings"
import { createComputerUseTelemetry } from "./telemetry"

export const COMPUTER_USE_COMPONENT_NAME = "computer-use"
export const COMPUTER_UNAVAILABLE = "Computer use is unavailable in this session."

type ExecuteTool = (toolName: string, params: unknown, options: { readonly signal: AbortSignal }) => Promise<unknown>

interface ComputerHostApi {
  getActiveTools(): string[]
  setActiveTools(names: string[]): void
  executeTool: ExecuteTool
}

interface CommandContext extends ComputerHostContext {
  readonly ui: { notify(message: string, level: "info" | "warning" | "error"): void }
}

export interface ComputerUseComponentOptions {
  readonly platform?: string
  /** Starts the engine child; `enginePath` is `computer.engine_path` (`undefined`: the located binary). */
  readonly engineChild?: (enginePath: string | undefined) => ChildFactory
  readonly loadSettings?: (cwd: string, platform: string) => ComputerSettings
  readonly telemetryObservers?: ComputerUseTelemetryObservers
}

function hostApi(pi: SenpiExtensionAPI): ComputerHostApi | undefined {
  const candidate = pi as SenpiExtensionAPI & Partial<ComputerHostApi>
  if (
    typeof candidate.getActiveTools !== "function" ||
    typeof candidate.setActiveTools !== "function" ||
    typeof candidate.executeTool !== "function"
  ) {
    return undefined
  }
  const getActiveTools = candidate.getActiveTools
  const setActiveTools = candidate.setActiveTools
  const executeTool = candidate.executeTool
  return {
    getActiveTools: () => getActiveTools.call(candidate),
    setActiveTools: (names) => setActiveTools.call(candidate, names),
    executeTool: (name, params, options) => executeTool.call(candidate, name, params, options),
  }
}

function defaultLoadSettings(cwd: string, platform: string): ComputerSettings {
  return resolveOmoComputerSettings(loadSenpiOmoConfig({ cwd }).config.computer, platform)
}

function isStatus(args: string): boolean {
  return (args.trim().toLowerCase() || "status") === "status"
}

function toolActivatedNames(payload: unknown): readonly string[] {
  if (typeof payload !== "object" || payload === null) return []
  const names = (payload as { toolNames?: unknown }).toolNames
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []
}

function computerToolCall(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false
  const toolName = Reflect.get(payload, "toolName")
  return toolName === COMPUTER_TOOL_NAME || toolName === COMPUTER_ACTIONS_TOOL_NAME
}

/**
 * Desktop computer use: the search-exposed `computer` tool (with its `kernelPrelude` and read/exec
 * `permissionParser`), `computer_actions` behind `computer.cua_adapter`, `/computer`, and the skill.
 * Registration happens at extension load so tool_search indexes the tool at session_start; nothing
 * starts until the tool is activated (a by-name call, `setActiveTools`, or `/computer on`).
 */
export function createComputerUseComponent(options: ComputerUseComponentOptions = {}): OmoSenpiComponent {
  const platform = options.platform ?? process.platform
  const engineChild = options.engineChild ?? defaultEngineChild()
  const loadSettings = options.loadSettings ?? defaultLoadSettings
  const telemetry = createComputerUseTelemetry({
    platform,
    ...(options.telemetryObservers === undefined ? {} : { observers: options.telemetryObservers }),
  })

  return {
    name: COMPUTER_USE_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const api = hostApi(pi)
      const available = (() => {
        if (!isSupportedHost(platform)) return undefined
        if (api === undefined) {
          ctx.logger.warn("computer-use skipped: host lacks getActiveTools/setActiveTools/executeTool", {
            component: COMPUTER_USE_COMPONENT_NAME,
          })
          return undefined
        }
        try {
          const settings = loadSettings(pi.cwd ?? process.cwd(), platform)
          return settings.enabled ? { host: api, settings } : undefined
        } catch (error) {
          ctx.logger.warn("computer-use skipped: invalid computer settings", {
            component: COMPUTER_USE_COMPONENT_NAME,
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        }
      })()

      let session: {
        handle: ComputerHandle
        service: TrackedDesktopService
        host: ComputerHostApi
        runtime: { backend: string; telemetryContext: unknown }
      } | undefined

      pi.registerCommand("computer", {
        description: "Computer use: on, off, status, stop, or resume (stop and resume are user-only)",
        argumentHint: COMPUTER_SUBCOMMANDS.join("|"),
        getArgumentCompletions: (prefix: string) =>
          COMPUTER_SUBCOMMANDS.filter((name) => name.startsWith(prefix.trim())).map((name) => ({
            value: name,
            label: name,
          })),
        handler: async (args: string, commandCtx: CommandContext) => {
          if (session === undefined) {
            commandCtx.ui.notify(COMPUTER_UNAVAILABLE, "warning")
            return
          }
          const { handle, service } = session
          const wasActive = handle.active
          const command = args.trim().toLowerCase() || "status"
          session.runtime.telemetryContext = commandCtx
          try {
            const text = await runComputerCommand(args, handle, commandCtx)
            if (command === "on" && !wasActive && handle.active) {
              const capabilities = await service.capabilities()
              session.runtime.backend = capabilities.backend
              telemetry.activation({
                context: commandCtx,
                active: true,
                source: "command_on",
                backend: capabilities.backend,
              })
              telemetry.osPermissions(commandCtx, capabilities)
            } else if (command === "off" && wasActive && !handle.active) {
              telemetry.activation({
                context: commandCtx,
                active: false,
                source: "command_off",
                backend: session.runtime.backend,
              })
            }
            if (!isStatus(args)) {
              commandCtx.ui.notify(text, text === COMPUTER_COMMAND_USAGE ? "warning" : "info")
              return
            }
            const prelude = session.host.getActiveTools().includes(COMPUTER_TOOL_NAME) ? "active" : "inactive"
            commandCtx.ui.notify(`${text}\nengine: ${service.engineState}\nprelude: ${prelude}`, "info")
          } catch (error) {
            if (!(error instanceof Error)) throw error
            commandCtx.ui.notify(`/computer ${args.trim()}: ${error.message}`, "error")
          }
        },
      })

      if (available === undefined) return
      const { settings } = available
      const runtime: { backend: string; telemetryContext: unknown } = {
        backend: "unavailable",
        telemetryContext: undefined,
      }
      const service = new TrackedDesktopService({
        createChild: engineChild(settings.enginePath),
        onError: (error) => {
          if (runtime.telemetryContext !== undefined) {
            telemetry.engineError(runtime.telemetryContext, error, runtime.backend)
          }
        },
      })
      const handle = new ComputerHandle({ service, settings: () => settings })
      const host = available.host
      session = { handle, service, host, runtime }
      handle.onActivationChange((active) => {
        const current = host.getActiveTools()
        if (active === current.includes(COMPUTER_TOOL_NAME)) return
        host.setActiveTools(
          active ? [...current, COMPUTER_TOOL_NAME] : current.filter((name) => name !== COMPUTER_TOOL_NAME),
        )
      })
      const executeTool = host.executeTool
      pi.registerTool({
        ...createComputerTool({ handle, executeTool }),
        permissionParser: (input: Record<string, unknown>, cwd: string) => {
          telemetry.permissionRequested(COMPUTER_TOOL_NAME, input)
          return computerPermissionParser(COMPUTER_TOOL_NAME, input, cwd)
        },
      })
      if (settings.cuaAdapter) {
        pi.registerTool({
          ...createComputerActionsTool({ handle, executeTool }),
          permissionParser: (input: Record<string, unknown>, cwd: string) => {
            telemetry.permissionRequested(COMPUTER_ACTIONS_TOOL_NAME, input)
            return computerActionsPermissionParser(COMPUTER_ACTIONS_TOOL_NAME, input, cwd)
          },
        })
      }

      pi.on("session_start", (_payload, eventCtx) => {
        runtime.telemetryContext = eventCtx
      })
      pi.on("resources_discover", () => ({ skillPaths: [materializeComputerSkill()] }))
      pi.on("tool_call", (payload, eventCtx) => {
        if (computerToolCall(payload)) runtime.telemetryContext = eventCtx
        telemetry.toolCall(payload)
      })
      pi.on("tool_activated", async (payload, eventCtx) => {
        const activated = toolActivatedNames(payload)
        if (
          handle.active ||
          (!activated.includes(COMPUTER_TOOL_NAME) && !activated.includes(COMPUTER_ACTIONS_TOOL_NAME))
        ) {
          return
        }
        runtime.telemetryContext = eventCtx
        await handle.activate(eventCtx as ComputerHostContext)
        const capabilities = await service.capabilities()
        runtime.backend = capabilities.backend
        telemetry.activation({
          context: eventCtx,
          active: true,
          source: "tool_call",
          backend: capabilities.backend,
        })
        telemetry.osPermissions(eventCtx, capabilities)
      })
      pi.on("tool_execution_end", (payload, eventCtx) => {
        telemetry.permissionTierDenied(payload, runtime.telemetryContext ?? eventCtx, runtime.backend)
      })
      pi.on("message_end", (payload, eventCtx) => {
        telemetry.permissionTierDenied(payload, runtime.telemetryContext ?? eventCtx, runtime.backend)
      })
      pi.on("session_shutdown", () => handle.close())
    },
  }
}
