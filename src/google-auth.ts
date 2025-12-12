import type { Plugin } from "@opencode-ai/plugin"
import { createGoogleAntigravityAuthPlugin } from "./auth/antigravity"

const GoogleAntigravityAuthPlugin: Plugin = async (ctx) => {
  return createGoogleAntigravityAuthPlugin(ctx)
}

export default GoogleAntigravityAuthPlugin
