import type { PluginContext } from "./types"
import { log } from "../shared/logger"
import type { SkillDiagnostic } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader"

export function showSkillSecurityNotice(ctx: Pick<PluginContext, "client">, message: string, category: SkillDiagnostic["category"] = "skill-link-blocked"): void {
  const security = category === "skill-link-blocked"
  log(`[${security ? "skill-security" : "skill-load"}] ` + message)
  // The notice runs inside skill discovery and the skill tool; a client without a TUI, or a toast that throws
  // synchronously, must never replace the loader's containment result (#10693).
  const failed = (error: unknown) => {
    log("[skill-notice] toast delivery failed", { error: error instanceof Error ? error.name : "unknown" })
  }
  try {
    const delivery = ctx.client.tui?.showToast?.({
      body: { title: security ? "Skill security" : "Skill load error", message, variant: "warning", duration: 15000 },
    })
    void delivery?.catch(failed)
  } catch (error) {
    failed(error)
  }
}
