import { resolveOmoSidePanelSettings, type OmoSidePanelSettings } from "@oh-my-opencode/omo-config-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import type { PanelCommandContext } from "./commands"
import { SIDE_PANEL_DIFF_COMMAND, SIDE_PANEL_FLAG, SIDE_PANEL_RUNTIME_FILE } from "./constants"
import type { SidePanelController, SidePanelRuntimeOptions } from "./runtime"

declare const OMO_SENPI_BUNDLED: boolean

type SidePanelControllerFactory = (
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  options: SidePanelRuntimeOptions,
) => SidePanelController

export interface SidePanelComponentOptions extends SidePanelRuntimeOptions {
  /** Injectable so tests decide the gate without depending on the developer's own omo.json. */
  readonly loadSettings?: (cwd: string) => OmoSidePanelSettings
  /** Imports the implementation; the default is the bundle beside this one, on the first session with the panel on. */
  readonly loadRuntime?: () => Promise<SidePanelControllerFactory>
}

/**
 * The side panel's registration shell.
 *
 * This is all the entry bundle carries: the flag, the command and a forwarder per event. The
 * panel itself lives in `runtime.ts`, built as its own bundle and imported the first time a
 * session starts with the panel on, so a run without the panel loads none of it.
 */
export function createSidePanelComponent(options: SidePanelComponentOptions = {}): OmoSenpiComponent {
  const loadSettings = options.loadSettings ?? defaultLoadSettings
  const loadRuntime = options.loadRuntime ?? loadBundledRuntime
  return {
    name: "side-panel",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      // No default on purpose: a registered default is what `getFlag` reports when the flag
      // was never passed, which would make `side_panel.enabled` unreachable. Note the host
      // sets a boolean extension flag to `true` whatever value follows it, and refuses a
      // `--no-` form outright, so the CLI can only force the panel ON; switching it off is
      // an omo.json edit. A `false` can still arrive through the SDK's `flagValues`, and it
      // is honored below.
      pi.registerFlag(SIDE_PANEL_FLAG, {
        type: "boolean",
        description: "Force the omo side panel on for this run; side_panel.enabled in omo.json is the persistent switch.",
      })

      const cwd = pi.cwd ?? process.cwd()
      let controller: SidePanelController | undefined
      let loading: Promise<SidePanelController> | undefined
      // Bumped on teardown, so an import still in flight cannot mount into a session that has ended.
      let epoch = 0

      const loadController = (): Promise<SidePanelController> => {
        loading ??= loadRuntime().then((create) => {
          controller = create(pi, ctx, options)
          return controller
        })
        return loading
      }

      // The command exists only when the panel can be on for this run, read at load from the same
      // switches the mount reads; a session where the panel still stays dark is told so.
      if (isPanelEnabled(loadSettings(cwd), ctx)) {
        pi.registerCommand(SIDE_PANEL_DIFF_COMMAND, {
          description: "Open the diff of a file the side panel lists as changed.",
          handler: async (_args: string, commandCtx: PanelCommandContext): Promise<void> => {
            if (controller !== undefined) return controller.runDiffCommand(commandCtx)
            commandCtx.ui?.notify("The side panel is off in this session.", "info")
          },
        })
      }

      pi.on("session_start", async (_payload: unknown, eventCtx: unknown): Promise<undefined> => {
        const settings = loadSettings(cwd)
        if (!isPanelEnabled(settings, ctx)) return undefined
        const started = epoch
        let loaded: SidePanelController
        try {
          loaded = await loadController()
        } catch (error) {
          // A missing or broken implementation bundle leaves the session as it would be without
          // the panel; the next session tries again.
          loading = undefined
          ctx.logger.warn("omo-senpi side panel: implementation did not load", { error: String(error) })
          return undefined
        }
        if (started !== epoch) return undefined
        return await loaded.sessionStart(settings, eventCtx)
      })

      // The host awaits these handlers and every tool call queues behind them, so each one starts the
      // panel's reads and returns at once; a read that lands after its session ended is discarded.
      pi.on("turn_end", (_payload: unknown, eventCtx: unknown) => controller?.refresh(eventCtx))
      pi.on("agent_settled", (_payload: unknown, eventCtx: unknown) => controller?.refresh(eventCtx))
      pi.on("message_end", (_payload: unknown, eventCtx: unknown) => controller?.refresh(eventCtx))
      pi.on("tool_execution_start", (payload: unknown, eventCtx: unknown) => controller?.toolStart(payload, eventCtx))
      pi.on("tool_execution_end", () => controller?.toolEnd())
      pi.on("input", () => controller?.input())

      const teardown = (): undefined => {
        epoch += 1
        return controller?.teardown()
      }
      // Only the committed end of a session: senpi fires session_shutdown on new, resume, fork and
      // quit. session_before_switch can still be cancelled, or be followed by a step that throws, and
      // the session would then carry on without its panel.
      pi.on("session_shutdown", teardown)
    },
  }
}

/** The CLI flag is an explicit override in both directions; absent, the config decides. */
function isPanelEnabled(settings: OmoSidePanelSettings, ctx: ComponentContext): boolean {
  const flag = ctx.config.getFlag(SIDE_PANEL_FLAG)
  if (flag === true) return true
  if (flag === false) return false
  return settings.enabled
}

function defaultLoadSettings(cwd: string): OmoSidePanelSettings {
  return resolveOmoSidePanelSettings(loadSenpiOmoConfig({ cwd }).config)
}

/** The built bundle sits beside `omo.js`; from source, the module beside this one. */
async function loadBundledRuntime(): Promise<SidePanelControllerFactory> {
  const bundled = typeof OMO_SENPI_BUNDLED !== "undefined" && OMO_SENPI_BUNDLED
  const loaded: unknown = await import(new URL(bundled ? SIDE_PANEL_RUNTIME_FILE : "runtime.ts", import.meta.url).href)
  const create = typeof loaded === "object" && loaded !== null ? Reflect.get(loaded, "createSidePanelController") : undefined
  if (!isControllerFactory(create)) throw new Error("side panel runtime did not export createSidePanelController")
  return create
}

function isControllerFactory(value: unknown): value is SidePanelControllerFactory {
  return typeof value === "function"
}

export { SIDE_PANEL_FLAG } from "./constants"
