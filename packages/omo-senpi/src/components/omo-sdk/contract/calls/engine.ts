import { instantCall, streamCall, valueCall } from "../call-spec"
import * as input from "../inputs/engine"
import type * as result from "../results/engine"

// The engine namespace (first-party design 6.8) without the credential and launch rows, which P1a-s owns.
export const ENGINE_CALLS = {
  "engine.config.agentDir": instantCall<result.AgentDir>()(input.EngineConfigAgentDir),
  "engine.config.resources": valueCall<result.Resources>()(input.EngineConfigResources),
  "engine.config.setResource": valueCall<result.ResourceEntry>()(input.EngineConfigSetResource),
  "engine.models.discover": valueCall<result.ModelsDiscovered>()(input.EngineModelsDiscover),
  "engine.models.list": valueCall<readonly result.ModelRow[]>()(input.EngineModelsList),
  "engine.models.update": valueCall<result.ModelsRefreshed>()(input.EngineModelsUpdate),
  "engine.packages.install": valueCall<result.PackageChanged>()(input.EnginePackagesInstall),
  "engine.packages.remove": valueCall<result.PackageChanged>()(input.EnginePackagesRemove),
  "engine.packages.list": valueCall<result.Packages>()(input.EnginePackagesList),
  "engine.packages.update": valueCall<result.PackagesUpdated>()(input.EnginePackagesUpdate),
  "engine.promptSizes": valueCall<result.PromptSizes>()(input.EnginePromptSizes),
  "engine.tips": instantCall<readonly result.Tip[]>()(input.EngineTips),
  "engine.schedule.list": valueCall<result.ScheduleList>()(input.EngineScheduleList),
  "engine.schedule.cancel": valueCall<result.ScheduleCancelled>()(input.EngineScheduleCancel),
  "engine.schedule.run": streamCall<result.ScheduleDelivery, result.ScheduleRunEnded>()(input.EngineScheduleRun),
  "engine.sessionOfPid": valueCall<result.SessionOfPid>()(input.EngineSessionOfPid),
  "engine.sessions.exportHtml": valueCall<result.HtmlExported>()(input.EngineSessionsExportHtml),
} as const
