import type { PiExtensionApi } from "./extension-api"
import {
  registerAlwaysOnUtilityTools,
  registerGatedRuntimeTools,
  registerHashlineEditTool,
  registerMcpBackedTools,
  registerTargetTaskTools,
  registerTargetTeamTools,
  TargetBackgroundManager,
  type TargetToolRegistry,
} from "../../host-tools"
import { registerPiDiagnostics } from "./register-diagnostics"
import { registerTargetCommands, registerTargetResourceDiscovery } from "../../host-resources"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { registerTargetMcpInventoryTool, registerTargetSkillMcpTool } from "../../host-mcp"
import {
  registerTargetHookEvents,
  registerTargetContinuation,
  registerTargetMessageTransforms,
  registerTargetOpenClaw,
  registerTargetProviderFallback,
  registerTargetToolGuards,
  TargetHookDispatcher,
  targetOpenClawConfigFromEnv,
} from "../../host-hooks"

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

export default function ohMyOpenAgentPiExtension(pi: PiExtensionApi): void {
  const backgroundManager = new TargetBackgroundManager()
  registerPiDiagnostics(pi)
  registerTargetCommands(pi, { cwd: process.cwd() })
  registerTargetResourceDiscovery(pi, PACKAGE_ROOT)
  registerTargetHookEvents("pi", pi, new TargetHookDispatcher())
  const promptGate = registerTargetContinuation("pi", pi)
  registerTargetMessageTransforms("pi", pi)
  registerTargetProviderFallback(pi)
  registerTargetOpenClaw(pi, targetOpenClawConfigFromEnv(), process.cwd())
  registerTargetToolGuards(pi, { cwd: process.cwd() })
  const registry: TargetToolRegistry = {
    registerTool: (tool) => {
      pi.registerTool(tool)
    },
  }
  registerAlwaysOnUtilityTools({
    host: "pi",
    registry,
    cwd: process.cwd(),
    backgroundManager,
  })
  registerMcpBackedTools({
    host: "pi",
    registry,
    cwd: process.cwd(),
  })
  registerTargetMcpInventoryTool({ host: "pi", registry, cwd: process.cwd() })
  registerTargetSkillMcpTool({ host: "pi", registry, cwd: process.cwd() })
  registerHashlineEditTool({
    host: "pi",
    registry,
    cwd: process.cwd(),
  })
  registerGatedRuntimeTools({
    host: "pi",
    registry,
    cwd: process.cwd(),
  })
  registerTargetTaskTools({
    host: "pi",
    registry,
    cwd: process.cwd(),
    backgroundManager,
    onBackgroundComplete: async (taskID) => {
      await promptGate.dispatch(
        "target-session",
        `background:${taskID}`,
        `Background task ${taskID} completed. Review its result and continue.`,
      )
    },
  })
  registerTargetTeamTools({ host: "pi", registry, cwd: process.cwd(), enabled: process.env.OMO_TEAM_MODE === "1" })
}
