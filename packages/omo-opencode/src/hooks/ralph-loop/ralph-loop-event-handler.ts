import type { PluginInput } from "@opencode-ai/plugin"
import { createRalphLoopEventHandlerImpl } from "./event-handler-impl"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"

export function createRalphLoopEventHandler(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
) {
	return createRalphLoopEventHandlerImpl(ctx, options)
}
