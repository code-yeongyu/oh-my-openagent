import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { createGatewayConnection, type GatewayConnectionOptions } from "./connection"
import { registerGatewayLearning } from "./learning-tool"
import { createGatewayRulesPromptHandler } from "./prompt"
import { createGatewayScopeAccess, type GatewayScopeAccess } from "./scope-access"
import { createScopeMemoryPromptHandler } from "./scope-prompt"

export { GATEWAY_RULES_EXTENSION_BUNDLE_NAME } from "./connection"
export { createGatewayRulesPromptHandler, type GatewayRulesPromptOptions, type GatewayRulesStore } from "./prompt"
export { composeGatewayRulesBlock, GATEWAY_RULES_SENTINEL_BEGIN, GATEWAY_RULES_SENTINEL_END, markGatewayRulesBlock, renderOperatingRulesBlock } from "./rules-block"
export { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"

export interface GatewayComponentOptions extends GatewayConnectionOptions {
  readonly scopeAccess?: GatewayScopeAccess
  readonly env?: Record<string, string | undefined>
}

export function createGatewayComponent(options: GatewayComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "gateway",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const ensureStore = createGatewayConnection(options, ctx.logger)
      const rules = createGatewayRulesPromptHandler({ ensureStore, onLookupError: (message) => ctx.logger.warn(message) })
      const access = options.scopeAccess ?? createGatewayScopeAccess(ensureStore, options.env)
      const scope = createScopeMemoryPromptHandler(access)
      pi.on("before_agent_start", async (payload, eventCtx) => {
        const ruleResult = await rules(payload, eventCtx)
        const scopePayload = ruleResult === undefined || payload === null || typeof payload !== "object"
          ? payload : { ...payload, systemPrompt: ruleResult.systemPrompt }
        return await scope(scopePayload, eventCtx) ?? ruleResult
      }, { previewSafe: true })
      registerGatewayLearning(pi, access)
    },
  }
}
