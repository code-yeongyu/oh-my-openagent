import { createAstGrepComponent } from "../components/ast-grep"
import { createAskQuestionComponent } from "../components/ask-question"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createConfigStartupComponent } from "../components/config-startup"
import { createConfigWatchComponent } from "../components/config-watch"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { createInitDeepAdvisorComponent } from "../components/init-deep-advisor"
import { createLspComponent } from "../components/lsp"
import { createMemoryComponent } from "../components/memory"
import { createNativeBadgeComponent } from "../components/native-badge"
import { createOnboardingComponent } from "../components/onboarding"
import { createStartWorkContinuationComponent } from "../components/start-work-continuation"
import { createOmoNativeTelemetryComponent } from "../components/telemetry"
import { createTodoFanoutReminderComponent } from "../components/todo-fanout-reminder"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwLoopComponent } from "../components/ulw-loop"
import type { OmoSenpiComponent } from "./types"

export function createOmoSenpiComponents(taskComponent: OmoSenpiComponent): OmoSenpiComponent[] {
  return [
    createConfigStartupComponent(),
    createNativeBadgeComponent(),
    createOnboardingComponent(),
    createInitDeepAdvisorComponent(),
    createOmoNativeTelemetryComponent(),
    createUltraworkComponent(),
    createStartWorkContinuationComponent(),
    createUlwLoopComponent(),
    createTodoFanoutReminderComponent(),
    createFallbackArchitectComponent(),
    createCommentCheckerComponent(),
    createAskQuestionComponent(),
    createAstGrepComponent(),
    createLspComponent(),
    taskComponent,
    createMemoryComponent(),
    createConfigWatchComponent(),
  ]
}
