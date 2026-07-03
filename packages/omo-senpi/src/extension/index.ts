import { composeOmoSenpiExtension } from "./compose"
import type { OmoSenpiComponent } from "./types"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createLspComponent } from "../components/lsp"
import { createSenpiTelemetryComponent } from "../components/telemetry"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwLoopComponent } from "../components/ulw-loop"

const components: OmoSenpiComponent[] = [
  createUltraworkComponent(),
  createUlwLoopComponent(),
  createCommentCheckerComponent(),
  createSenpiTelemetryComponent(),
  createLspComponent(),
]

export default composeOmoSenpiExtension(components)
export { composeOmoSenpiExtension }
export type { ComponentContext, ComponentLogger, OmoSenpiComponent, SenpiExtensionAPI } from "./types"
