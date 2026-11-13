import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { createNativeBadgeStatus, resolveNativeBadgeText } from "./footer-badge"

export function createNativeBadgeComponent(options: { env?: NodeJS.ProcessEnv } = {}): OmoSenpiComponent {
  return {
    name: "native-badge",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      const badge = createNativeBadgeStatus(resolveNativeBadgeText(options.env ?? process.env))
      const publish = (_payload: unknown, eventCtx: unknown): undefined => {
        badge.publish(eventCtx)
        return undefined
      }
      pi.on("session_start", publish)
      pi.on("agent_settled", publish)
    },
  }
}

export {
  NATIVE_BADGE_DEV_BUILD_TEXT,
  NATIVE_BADGE_STATUS_KEY,
  NATIVE_BADGE_TEXT,
  createNativeBadgeStatus,
  resolveNativeBadgeText,
} from "./footer-badge"
