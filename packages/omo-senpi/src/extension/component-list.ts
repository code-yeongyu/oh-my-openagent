import { createAstGrepComponent } from "../components/ast-grep"
import { createBuiltinMcpsComponent } from "../components/builtin-mcps"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createConfigStartupComponent } from "../components/config-startup"
import { createConfigWatchComponent } from "../components/config-watch"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { createGitMasterAttributionComponent } from "../components/git-master"
import { createInitDeepAdvisorComponent } from "../components/init-deep-advisor"
import { createLspComponent } from "../components/lsp"
import { createMemoryComponent } from "../components/memory"
import { createModelProfileComponent } from "../components/model-profile"
import { createNativeBadgeComponent } from "../components/native-badge"
import { createOnboardingComponent } from "../components/onboarding"
import { createSkillPointersComponent } from "../components/skill-pointers"
import { createOmoNativeTelemetryComponent } from "../components/telemetry"
import { createTodoFanoutReminderComponent } from "../components/todo-fanout-reminder"
import { createThreadComponent } from "../components/thread"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwExecuteContinuationComponent } from "../components/ulw-execute-continuation"
import { createUlwLoopComponent } from "../components/ulw-loop"
import { createXSearchComponent } from "../components/x-search"
import type { OmoSenpiComponent } from "./types"

export function createOmoSenpiComponents(taskComponent: OmoSenpiComponent): OmoSenpiComponent[] {
  return [
    createConfigStartupComponent(),
    // After config-startup so configuration diagnostics print before the profile notice.
    createModelProfileComponent(),
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
    createBuiltinMcpsComponent(),
    createLspComponent(),
    createXSearchComponent(),
    createCommentCheckerComponent(),
    taskComponent,
    createThreadComponent(),
    createMemoryComponent(),
    createConfigWatchComponent(),
  ]
}
