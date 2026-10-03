import type { ChildFactory } from "@oh-my-opencode/senpi-desktop-service"
import {
  ComputerHandle,
  type ComputerSettings,
  type ComputerToolDeps,
  createComputerActionsTool,
  createComputerTool,
} from "@oh-my-opencode/senpi-desktop-tool"

import type { ComputerUseEngineErrorCode } from "../telemetry/omo-native-computer-use"
import { defaultEngineChild, describeEngineSource } from "./engine-source"
import { engineErrorCode, TrackedDesktopService, type TrackedDesktopServiceOptions } from "./engine-status"
import { describeEnginePermissions } from "./permission-status"

export interface ComputerUseRuntimeOptions {
  readonly settings: ComputerSettings
  readonly executeTool: ComputerToolDeps["executeTool"]
  /** Starts the engine child; `enginePath` is `computer.engine_path` (`undefined`: the located binary). */
  readonly engineChild?: (enginePath: string | undefined) => ChildFactory
  readonly onEngineError: (code: ComputerUseEngineErrorCode) => void
  readonly onPermissionRequired?: TrackedDesktopServiceOptions["onPermissionRequired"]
}

/**
 * The computer-use implementation behind the registration shell in `./index` (#9113): the desktop
 * service and its engine child, the session handle, and the tools' `execute`. The built plugin ships
 * it as `extensions/omo-computer-use.js` (`#omo-computer-use-runtime`), imported on first use only.
 * Creating it starts nothing; the engine starts on the first activation.
 */
export function createComputerUseRuntime(options: ComputerUseRuntimeOptions) {
  const engineChild = options.engineChild ?? defaultEngineChild()
  const service = new TrackedDesktopService({
    createChild: engineChild(options.settings.enginePath),
    onError: (error) => options.onEngineError(engineErrorCode(error)),
    onPermissionRequired: options.onPermissionRequired,
  })
  const handle = new ComputerHandle({ service, settings: () => options.settings })
  const deps: ComputerToolDeps = { handle, executeTool: options.executeTool }
  return {
    handle,
    service,
    computerTool: createComputerTool(deps),
    computerActionsTool: createComputerActionsTool(deps),
    /** `/computer status` engine location, read here so the locator stays in this lazy entry. */
    describeEngineSource,
    describeEnginePermissions,
  }
}

export type ComputerUseRuntime = ReturnType<typeof createComputerUseRuntime>
