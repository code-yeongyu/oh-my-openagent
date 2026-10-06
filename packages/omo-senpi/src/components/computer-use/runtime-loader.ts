import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"
import {
  COMPUTER_ACTIONS_TOOL_NAME,
  COMPUTER_TOOL_NAME,
  type ComputerSettings,
} from "@oh-my-opencode/senpi-desktop-tool/registration"

import type { ComputerUseEngineErrorCode } from "../telemetry/omo-native-computer-use"
import type { TrackedDesktopServiceOptions } from "./engine-status"

export type ComputerUseRuntimeModule = typeof import("#omo-computer-use-runtime")
export type ComputerUseRuntime = import("#omo-computer-use-runtime").ComputerUseRuntime

type ExecuteTool = (toolName: string, params: unknown, options: { readonly signal: AbortSignal }) => Promise<unknown>

export interface ComputerHostApi {
  getActiveTools(): string[]
  setActiveTools(names: string[]): void
  executeTool: ExecuteTool
}

export interface ComputerRuntimeLoader {
  load(): Promise<ComputerUseRuntime>
  /** The load in flight or done, `undefined` while nothing has asked for the runtime. */
  started(): Promise<ComputerUseRuntime> | undefined
}

/**
 * Loads the computer-use implementation on first use (#9113) and wires its activation changes into the
 * host's active-tool set. A failed import is not cached, so the next use retries it.
 */
export function createComputerRuntimeLoader(options: {
  readonly loadRuntime: () => Promise<ComputerUseRuntimeModule>
  readonly host: ComputerHostApi
  readonly settings: ComputerSettings
  readonly engineChild: ((enginePath: string | undefined) => ChildFactory) | undefined
  readonly onEngineError: (code: ComputerUseEngineErrorCode) => void
  readonly onPermissionRequired?: TrackedDesktopServiceOptions["onPermissionRequired"]
}): ComputerRuntimeLoader {
  const { host, settings } = options
  // Providers without native deferred-tool search reach a tool only once it is active, so the
  // adapter's `computer_actions` moves with `computer` (#9048).
  const computerTools = settings.cuaAdapter ? [COMPUTER_TOOL_NAME, COMPUTER_ACTIONS_TOOL_NAME] : [COMPUTER_TOOL_NAME]
  let loading: Promise<ComputerUseRuntime> | undefined

  const build = (module: ComputerUseRuntimeModule): ComputerUseRuntime => {
    const runtime = module.createComputerUseRuntime({
      settings,
      executeTool: host.executeTool,
      ...(options.engineChild === undefined ? {} : { engineChild: options.engineChild }),
      onEngineError: options.onEngineError,
      onPermissionRequired: options.onPermissionRequired,
    })
    runtime.handle.onActivationChange((active) => {
      const current = host.getActiveTools()
      const next = active
        ? [...current, ...computerTools.filter((name) => !current.includes(name))]
        : current.filter((name) => !computerTools.includes(name))
      if (next.length === current.length && next.every((name, index) => name === current[index])) return
      host.setActiveTools(next)
    })
    return runtime
  }

  return {
    load() {
      loading ??= options.loadRuntime().then(build, (error: unknown) => {
        loading = undefined
        throw error
      })
      return loading
    },
    started: () => loading,
  }
}
