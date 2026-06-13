import type { OhMyPiExtensionApi } from "./extension-api"
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
import { OH_MY_PI_EXTENSION_LABEL } from "./manifest"
import { registerOhMyPiDiagnostics } from "./register-diagnostics"
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

export default function ohMyOpenAgentOhMyPiExtension(pi: OhMyPiExtensionApi): void {
  const backgroundManager = new TargetBackgroundManager()
  pi.on("session_shutdown", () => {
    backgroundManager.cancelAll()
  })
  pi.setLabel(OH_MY_PI_EXTENSION_LABEL)
  registerOhMyPiDiagnostics(pi)
  registerTargetCommands(pi, { cwd: process.cwd() })
  registerTargetResourceDiscovery(pi, PACKAGE_ROOT)
  registerTargetHookEvents("oh-my-pi", pi, new TargetHookDispatcher())
  const promptGate = registerTargetContinuation("oh-my-pi", pi)
  registerTargetMessageTransforms("oh-my-pi", pi)
  registerTargetProviderFallback(pi)
  registerTargetOpenClaw(pi, targetOpenClawConfigFromEnv(), process.cwd())
  registerTargetToolGuards(pi, { cwd: process.cwd() })
  const registry: TargetToolRegistry = {
    registerTool: (tool) => {
      pi.registerTool(tool)
    },
  }
  registerAlwaysOnUtilityTools({
    host: "oh-my-pi",
    registry,
    cwd: process.cwd(),
    packageRoot: PACKAGE_ROOT,
    backgroundManager,
  })
  registerMcpBackedTools({
    host: "oh-my-pi",
    registry,
    cwd: process.cwd(),
  })
  registerTargetMcpInventoryTool({ host: "oh-my-pi", registry, cwd: process.cwd() })
  registerTargetSkillMcpTool({ host: "oh-my-pi", registry, cwd: process.cwd() })
  registerHashlineEditTool({
    host: "oh-my-pi",
    registry,
    cwd: process.cwd(),
  })
  registerGatedRuntimeTools({
    host: "oh-my-pi",
    registry,
    cwd: process.cwd(),
  })
  registerTargetTaskTools({
    host: "oh-my-pi",
    registry,
    cwd: process.cwd(),
    backgroundManager,
    onBackgroundComplete: async (taskID) => {
      await promptGate.dispatch(
        "target-session",
        `background:${taskID}`,
        `Background task ${taskID} completed. Review its result and continue.`,
        "followUp",
      )
    },
  })
  registerTargetTeamTools({ host: "oh-my-pi", registry, cwd: process.cwd(), enabled: process.env.OMO_TEAM_MODE === "1" })
}
