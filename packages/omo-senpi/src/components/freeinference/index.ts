export { registerFreeInferenceProvider } from "./provider";
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { registerFreeInferenceProvider } from "./provider"

export const FREEINFERENCE_COMPONENT_NAME = "freeinference"

export function createFreeInferenceComponent(): OmoSenpiComponent {
  return {
    name: FREEINFERENCE_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      registerFreeInferenceProvider(pi)
      ctx.logger.debug?.("freeinference.org provider registered", { component: FREEINFERENCE_COMPONENT_NAME })
    },
  }
}
