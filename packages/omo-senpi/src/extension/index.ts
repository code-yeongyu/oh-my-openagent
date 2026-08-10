import { composeOmoSenpiExtension } from "./compose"
import type { OmoSenpiComponent } from "./types"
import { createConfigStartupComponent } from "../components/config-startup"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createConfigWatchComponent } from "../components/config-watch"
import { createAstGrepComponent } from "../components/ast-grep"
import { createLspComponent } from "../components/lsp"
import { createOmoNativeTelemetryComponent } from "../components/telemetry"
import { createTaskComponent } from "../components/task"
import { createMemoryComponent } from "../components/memory"
import { createStartWorkContinuationComponent } from "../components/start-work-continuation"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwLoopComponent } from "../components/ulw-loop"
import { createTodoFanoutReminderComponent } from "../components/todo-fanout-reminder"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { createNativeBadgeComponent } from "../components/native-badge"

export const omoSenpiComponents: OmoSenpiComponent[] = [
  createConfigStartupComponent(),
  createNativeBadgeComponent(),
  createOmoNativeTelemetryComponent(),
  createUltraworkComponent(),
  createStartWorkContinuationComponent(),
  createUlwLoopComponent(),
  createTodoFanoutReminderComponent(),
  createFallbackArchitectComponent(),
  createCommentCheckerComponent(),
  createAstGrepComponent(),
  createLspComponent(),
  createTaskComponent(),
  createMemoryComponent(),
  createConfigWatchComponent(),
]

export default composeOmoSenpiExtension(omoSenpiComponents)
export { composeOmoSenpiExtension }
export type { ComponentContext, ComponentLogger, OmoSenpiComponent, SenpiExtensionAPI } from "./types"
