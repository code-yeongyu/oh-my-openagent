import type { AvailableCategory, AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { mergeCategories } from "../../shared/merge-categories"
import { CATEGORY_DESCRIPTIONS } from "./constants"
import type { DelegateTaskToolOptions } from "./types"

export interface DelegateTaskPresentation {
  availableCategories: AvailableCategory[]
  availableSkills: AvailableSkill[]
  categoryExamples: string
  description: string
}

export function createDelegateTaskPresentation(options: DelegateTaskToolOptions): DelegateTaskPresentation {
  const { userCategories } = options
  const allCategories = mergeCategories(userCategories)
  const categoryEntries = Object.entries(allCategories).map(([name, categoryConfig]) => ({
    name,
    categoryConfig,
    description: userCategories?.[name]?.description || CATEGORY_DESCRIPTIONS[name],
  }))
  const categoryNames = categoryEntries.map(({ name }) => name)
  const categoryExamples = categoryNames.join(", ")

  const availableCategories: AvailableCategory[] = options.availableCategories
    ?? categoryEntries.map(({ name, categoryConfig, description }) => {
      return {
        name,
        description: description || "General tasks",
        model: categoryConfig.model,
      }
    })

  const availableSkills: AvailableSkill[] = options.availableSkills ?? []

  const categoryList = categoryEntries.map(({ name, description }) => {
    return description ? `  - ${name}: ${description}` : `  - ${name}`
  }).join("\n")

  const description = `Spawn agent task with category-based or direct agent selection.

  ⚠️  CRITICAL: You MUST provide EITHER category OR subagent_type. Omitting BOTH will FAIL.

  **COMMON MISTAKE (DO NOT DO THIS):**
  \`\`\`
  task(description="...", prompt="...")  // ❌ FAILS - missing category AND subagent_type
  \`\`\`

  **CORRECT - Using category:**
  \`\`\`
  task(category="quick", description="Fix type error", prompt="...")
  \`\`\`

  **CORRECT - Using subagent_type with parallel exploration:**
  \`\`\`
  task(subagent_type="explore", description="Find patterns", prompt="...", run_in_background=true)
  \`\`\`

  REQUIRED: Provide ONE of:
  - category: For task delegation (uses Sisyphus-Junior with category-optimized model)
  - subagent_type: For direct agent invocation (explore, librarian, oracle, etc.)

  **DO NOT provide both.** If category is provided, subagent_type is ignored.

  - load_skills: Optional. Defaults to [] when omitted. Pass ["skill-1", "skill-2"] for skill-specific tasks.
  - category: Use predefined category → Spawns Sisyphus-Junior with category config
    Available categories:
  ${categoryList}
  - subagent_type: Use specific agent directly (explore, librarian, oracle, metis, momus)
  - run_in_background: Optional. Defaults to false (sync, waits). Set true=async (returns a background task ID like \`bg_...\` for \`background_output\`) ONLY for parallel exploration with 5+ independent queries.
    Sync waits use a 30-minute inactivity window: OpenCode busy/retry/running status resets the window, so this is not a total wall-clock limit.
  - task_id: Continuation session id (\`ses_...\`) from task metadata. Continues the same subagent session with FULL CONTEXT PRESERVED; not the background task id (\`bg_...\`).
  - command: The command that triggered this task (optional, for slash command tracking).
  
  **WHEN TO USE task_id:**
  - Task failed/incomplete → \`task(task_id="ses_...", prompt="fix: [specific issue]")\`
  - Need follow-up on previous result → \`task(task_id="ses_...", prompt="Also: [question]")\`
  - Multi-turn conversation with same agent → always \`task(task_id="ses_...")\` instead of new task
  
  Prompts MUST be in English.`

  return {
    availableCategories,
    availableSkills,
    categoryExamples,
    description,
  }
}
