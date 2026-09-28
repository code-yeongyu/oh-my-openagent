import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"
import {
  COMPUTER_ACTIONS_TOOL_NAME,
  COMPUTER_COMMAND_USAGE,
  COMPUTER_SUBCOMMANDS,
  COMPUTER_TOOL_NAME,
  type ComputerHostContext,
  type ComputerSettings,
  computerActionsPermissionParser,
  computerActionsToolDefinition,
  computerPermissionParser,
  computerToolDefinition,
  isSupportedHost,
  materializeComputerSkill,
  runComputerCommand,
} from "@oh-my-opencode/senpi-desktop-tool/registration"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import type { ComputerUseTelemetryObservers } from "../telemetry/omo-native-computer-use"
import {
  type ComputerHostApi,
  type ComputerUseRuntime,
  type ComputerUseRuntimeModule,
  createComputerRuntimeLoader,
} from "./runtime-loader"
import { resolveOmoComputerSettings } from "./settings"
import { createComputerUseTelemetry } from "./telemetry"

type ComputerExecute = ComputerUseRuntime["computerTool"]["execute"]
type ComputerActionsExecute = ComputerUseRuntime["computerActionsTool"]["execute"]

export const COMPUTER_USE_COMPONENT_NAME = "computer-use"
export const COMPUTER_UNAVAILABLE = "Computer use is unavailable in this session."

interface CommandContext extends ComputerHostContext {
  readonly ui: { notify(message: string, level: "info" | "warning" | "error"): void }
}

export interface ComputerUseComponentOptions {
  readonly platform?: string
  /** Starts the engine child; `enginePath` is `computer.engine_path` (`undefined`: the located binary). */
  readonly engineChild?: (enginePath: string | undefined) => ChildFactory
  readonly loadSettings?: (cwd: string, platform: string) => ComputerSettings
  readonly telemetryObservers?: ComputerUseTelemetryObservers
  /** Imports the implementation entry; the default is `#omo-computer-use-runtime`, on first use only. */
  readonly loadRuntime?: () => Promise<ComputerUseRuntimeModule>
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

/**
 * Desktop computer use: the search-exposed `computer` tool (with its `kernelPrelude` and read/exec
 * `permissionParser`), `computer_actions` behind `computer.cua_adapter`, `/computer`, and the skill.
 * Registration happens at extension load so tool_search indexes the tool at session_start; nothing
 * starts until the tool is activated (a by-name call, `setActiveTools`, or `/computer on`).
 * The implementation (desktop service, engine child, handle, `execute`) is a separate entry imported
 * on the first `/computer`, tool activation, or tool call, so a session that never uses the desktop
 * does not load or evaluate it (#9113).
 */
export function createComputerUseComponent(options: ComputerUseComponentOptions = {}): OmoSenpiComponent {
  const platform = options.platform ?? process.platform
  const loadSettings = options.loadSettings ?? defaultLoadSettings
  const loadRuntime = options.loadRuntime ?? (() => import("#omo-computer-use-runtime"))
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

      const state: { backend: string; telemetryContext: unknown; activationReported: boolean } = {
        backend: "unavailable",
        telemetryContext: undefined,
        activationReported: false,
      }
      const runtime =
        available === undefined
          ? undefined
          : createComputerRuntimeLoader({
              loadRuntime,
              host: available.host,
              settings: available.settings,
              engineChild: options.engineChild,
              onEngineError: (code) => {
                if (state.telemetryContext !== undefined) telemetry.engineError(state.telemetryContext, code, state.backend)
              },
            })

      pi.registerCommand("computer", {
        description: "Computer use: on, off, status, stop, or resume (stop and resume are user-only)",
        argumentHint: COMPUTER_SUBCOMMANDS.join("|"),
        getArgumentCompletions: (prefix: string) =>
          COMPUTER_SUBCOMMANDS.filter((name) => name.startsWith(prefix.trim())).map((name) => ({
            value: name,
            label: name,
          })),
        handler: async (args: string, commandCtx: CommandContext) => {
          if (available === undefined || runtime === undefined) {
            commandCtx.ui.notify(COMPUTER_UNAVAILABLE, "warning")
            return
          }
          const command = args.trim().toLowerCase() || "status"
          state.telemetryContext = commandCtx
          try {
            const { handle, service } = await runtime.load()
            const wasActive = handle.active
            const text = await runComputerCommand(args, handle, commandCtx)
            if (command === "on" && !wasActive && handle.active && !state.activationReported) {
              state.activationReported = true
              const capabilities = await service.capabilities()
              state.backend = capabilities.backend
              telemetry.activation({
                context: commandCtx,
                active: true,
                source: "command_on",
                backend: capabilities.backend,
              })
              telemetry.osPermissions(commandCtx, capabilities)
            } else if (command === "off" && wasActive && !handle.active) {
              state.activationReported = false
              telemetry.activation({
                context: commandCtx,
                active: false,
                source: "command_off",
                backend: state.backend,
              })
            }
            if (!isStatus(args)) {
              commandCtx.ui.notify(text, text === COMPUTER_COMMAND_USAGE ? "warning" : "info")
              return
            }
            const prelude = available.host.getActiveTools().includes(COMPUTER_TOOL_NAME) ? "active" : "inactive"
            commandCtx.ui.notify(`${text}\nengine: ${service.engineState}\nprelude: ${prelude}`, "info")
          } catch (error) {
            if (!(error instanceof Error)) throw error
            commandCtx.ui.notify(`/computer ${args.trim()}: ${error.message}`, "error")
          }
        },
      })

      if (available === undefined || runtime === undefined) return
      pi.registerTool({
        ...computerToolDefinition,
        async execute(...args: Parameters<ComputerExecute>): ReturnType<ComputerExecute> {
          return (await runtime.load()).computerTool.execute(...args)
        },
        permissionParser: (input: Record<string, unknown>, cwd: string) =>
          computerPermissionParser(COMPUTER_TOOL_NAME, input, cwd),
      })
      if (available.settings.cuaAdapter) {
        pi.registerTool({
          ...computerActionsToolDefinition,
          async execute(...args: Parameters<ComputerActionsExecute>): ReturnType<ComputerActionsExecute> {
            return (await runtime.load()).computerActionsTool.execute(...args)
          },
          permissionParser: (input: Record<string, unknown>, cwd: string) =>
            computerActionsPermissionParser(COMPUTER_ACTIONS_TOOL_NAME, input, cwd),
        })
      }

      pi.on("session_start", (_payload, eventCtx) => {
        state.telemetryContext = eventCtx
      })
      pi.on("resources_discover", () => ({ skillPaths: [materializeComputerSkill()] }))
      pi.on("tool_execution_start", (payload, eventCtx) => {
        if (telemetry.toolExecutionStarted(payload)) state.telemetryContext = eventCtx
      })
      pi.on("tool_activated", async (payload, eventCtx) => {
        const activated = toolActivatedNames(payload)
        if (!activated.includes(COMPUTER_TOOL_NAME) && !activated.includes(COMPUTER_ACTIONS_TOOL_NAME)) return
        const { handle, service } = await runtime.load()
        if (handle.active) return
        state.telemetryContext = eventCtx
        await handle.activate(eventCtx as ComputerHostContext)
        if (state.activationReported) return
        state.activationReported = true
        const capabilities = await service.capabilities().catch((error: unknown) => {
          state.activationReported = false
          throw error
        })
        state.backend = capabilities.backend
        telemetry.activation({
          context: eventCtx,
          active: true,
          source: "tool_call",
          backend: capabilities.backend,
        })
        telemetry.osPermissions(eventCtx, capabilities)
      })
      pi.on("tool_execution_end", (payload, eventCtx) => {
        telemetry.permissionTierDenied(payload, state.telemetryContext ?? eventCtx, state.backend)
      })
      pi.on("message_end", (payload, eventCtx) => {
        telemetry.permissionTierDenied(payload, state.telemetryContext ?? eventCtx, state.backend)
      })
      pi.on("session_shutdown", async () => {
        // A runtime that never loaded has no engine session to end.
        const started = runtime.started()
        if (started !== undefined) await (await started).handle.close()
      })
    },
  }
}
