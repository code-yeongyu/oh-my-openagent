import { createAstGrepComponent } from "../components/ast-grep"
import { createBrowserBridgeComponent } from "../components/browser-bridge"
import { createBuiltinMcpsComponent } from "../components/builtin-mcps"
import { createBundledSkillsComponent } from "../components/bundled-skills"
import { createClaudeCodeComponent } from "../components/claude-code"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createComputerUseComponent } from "../components/computer-use"
import { createConfigStartupComponent } from "../components/config-startup"
import { createConfigWatchComponent } from "../components/config-watch"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { createGatewayComponent } from "../components/gateway"
import { createGitMasterAttributionComponent } from "../components/git-master"
import { createInitDeepAdvisorComponent } from "../components/init-deep-advisor"
import { createLspComponent } from "../components/lsp"
import { createMemoryComponent } from "../components/memory"
import { createModelProfileComponent } from "../components/model-profile"
import { createNativeBadgeComponent } from "../components/native-badge"
import { createOnboardingComponent } from "../components/onboarding"
import { createSkillCommandsComponent } from "../components/skill-commands"
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
    // Skill availability is resolved before the startup UI components run, and it stays
    // outside the native-badge -> onboarding -> advisor adjacency that session-start
    // ordering pins (session-start-ordering.test.ts).
    createBundledSkillsComponent(),
    // Its input handler must run before every other omo input handler: it rewrites a bare
    // `/<bundled-skill>` into the `/skill:` form the later handlers and senpi's expansion read.
    createSkillCommandsComponent(),
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
    createComputerUseComponent(),
    createBrowserBridgeComponent(),
    createClaudeCodeComponent(),
    createCommentCheckerComponent(),
    taskComponent,
    createThreadComponent(),
    createMemoryComponent(),
    // After memory so the gateway block composes after the memory block in the system prompt.
    createGatewayComponent(),
    createConfigWatchComponent(),
  ]
}
