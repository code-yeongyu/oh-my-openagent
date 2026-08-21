import { createAstGrepComponent } from "../components/ast-grep"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createConfigStartupComponent } from "../components/config-startup"
import { createConfigWatchComponent } from "../components/config-watch"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { createGitMasterAttributionComponent } from "../components/git-master"
import { createInitDeepAdvisorComponent } from "../components/init-deep-advisor"
import { createLspComponent } from "../components/lsp"
import { createMassUlwComponent } from "../components/mass-ulw"
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
    createMassUlwComponent(),
    createStartWorkContinuationComponent(),
    createUlwLoopComponent(),
    createTodoFanoutReminderComponent(),
    createGitMasterAttributionComponent(),
    createFallbackArchitectComponent(),
    createCommentCheckerComponent(),
    createAstGrepComponent(),
    createLspComponent(),
    taskComponent,
    createMemoryComponent(),
    createConfigWatchComponent(),
  ]
}
