import { createAstGrepComponent } from "../components/ast-grep"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createConfigStartupComponent } from "../components/config-startup"
import { createConfigWatchComponent } from "../components/config-watch"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { createGitMasterAttributionComponent } from "../components/git-master"
import { createInitDeepAdvisorComponent } from "../components/init-deep-advisor"
import { createLspComponent } from "../components/lsp"
import { createMemoryComponent } from "../components/memory"
import { createNativeBadgeComponent } from "../components/native-badge"
import { createOnboardingComponent } from "../components/onboarding"
import { createSkillPointersComponent } from "../components/skill-pointers"
import { createOmoNativeTelemetryComponent } from "../components/telemetry"
import { createTodoFanoutReminderComponent } from "../components/todo-fanout-reminder"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwExecuteContinuationComponent } from "../components/ulw-execute-continuation"
import { createUlwLoopComponent } from "../components/ulw-loop"
import { createXSearchComponent } from "../components/x-search"
import type { OmoSenpiComponent } from "./types"

export function createOmoSenpiComponents(taskComponent: OmoSenpiComponent): OmoSenpiComponent[] {
  return [
    createConfigStartupComponent(),
    createNativeBadgeComponent(),
    createOnboardingComponent(),
    createInitDeepAdvisorComponent(),
    createOmoNativeTelemetryComponent(),
    createUltraworkComponent(),
    createSkillPointersComponent(),
    createUlwExecuteContinuationComponent(),
    createUlwLoopComponent(),
    createTodoFanoutReminderComponent(),
    createGitMasterAttributionComponent(),
    createFallbackArchitectComponent(),
    createAstGrepComponent(),
    createLspComponent(),
    createXSearchComponent(),
    createCommentCheckerComponent(),
    taskComponent,
    createMemoryComponent(),
    createConfigWatchComponent(),
  ]
}
