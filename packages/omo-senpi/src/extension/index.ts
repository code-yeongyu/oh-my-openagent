import { composeOmoSenpiExtension } from "./compose"
import type { OmoSenpiComponent } from "./types"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createLspComponent } from "../components/lsp"
import { createSenpiTelemetryComponent } from "../components/telemetry"
import { createTaskComponent } from "../components/task"
import { createStartWorkContinuationComponent } from "../components/start-work-continuation"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwLoopComponent } from "../components/ulw-loop"

const components: OmoSenpiComponent[] = [
  createUltraworkComponent(),
  createStartWorkContinuationComponent(),
  createUlwLoopComponent(),
  createCommentCheckerComponent(),
  createSenpiTelemetryComponent(),
  createLspComponent(),
  createTaskComponent(),
]

export default composeOmoSenpiExtension(components)
export { composeOmoSenpiExtension }
export type { ComponentContext, ComponentLogger, OmoSenpiComponent, SenpiExtensionAPI } from "./types"
