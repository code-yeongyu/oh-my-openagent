import { describe, expect, test } from "bun:test"
import { buildHephaestusTodoDisciplineSection } from "./todo-discipline"

describe("buildHephaestusTodoDisciplineSection", () => {
  test("#given gpt variant in todo mode #when building section #then preserves the legacy todo copy", () => {
    const section = buildHephaestusTodoDisciplineSection("gpt", false)

    expect(section).toContain("## Todo Discipline (NON-NEGOTIABLE)")
    expect(section).toContain("**Track ALL multi-step work with todos. This is your execution backbone.**")
    expect(section).toContain("1. **On task start**: `todowrite` with atomic steps—no announcements, just create")
    expect(section).toContain("**NO TODOS ON MULTI-STEP WORK = INCOMPLETE WORK.**")
  })

  test("#given gpt variant in task mode #when building section #then preserves the legacy task copy", () => {
    const section = buildHephaestusTodoDisciplineSection("gpt", true)

    expect(section).toContain("## Task Discipline (NON-NEGOTIABLE)")
    expect(section).toContain("**Track ALL multi-step work with tasks. This is your execution backbone.**")
    expect(section).toContain("2. **Before each step**: `task_update(status=\"in_progress\")` (ONE at a time)")
    expect(section).toContain("**NO TASKS ON MULTI-STEP WORK = INCOMPLETE WORK.**")
  })

  test("#given gpt-5-4 variant in todo mode #when building section #then keeps the variant-specific enforcement text", () => {
    const section = buildHephaestusTodoDisciplineSection("gpt-5-4", false)

    expect(section).toContain("Track ALL multi-step work with todos. This is your execution backbone.")
    expect(section).toContain("2. Before each step: mark `in_progress` (ONE at a time)")
    expect(section).toContain("Todos prevent drift, enable recovery if interrupted, and make each commitment explicit.")
  })

  test("#given gpt-5-4 variant in task mode #when building section #then keeps the variant-specific task wording", () => {
    const section = buildHephaestusTodoDisciplineSection("gpt-5-4", true)

    expect(section).toContain("Track ALL multi-step work with tasks. This is your execution backbone.")
    expect(section).toContain("1. On task start: `task_create` with atomic steps — no announcements, just create")
    expect(section).toContain("Skipping tasks on multi-step work, batch-completing, or proceeding without `in_progress` are blocking violations.")
  })

  test("#given gpt-5-3-codex variant in todo mode #when building section #then preserves the why-this-matters block", () => {
    const section = buildHephaestusTodoDisciplineSection("gpt-5-3-codex", false)

    expect(section).toContain("### Why This Matters")
    expect(section).toContain("- **Execution anchor**: Todos prevent drift from original request")
    expect(section).toContain("- **Finishing without completing todos** — Task appears incomplete")
  })

  test("#given gpt-5-3-codex variant in task mode #when building section #then preserves the escaped task-update examples", () => {
    const section = buildHephaestusTodoDisciplineSection("gpt-5-3-codex", true)

    expect(section).toContain("2. **Before each step**: `task_update(status=\\\"in_progress\\\")` (ONE at a time)")
    expect(section).toContain("3. **After each step**: `task_update(status=\\\"completed\\\")` IMMEDIATELY (NEVER batch)")
    expect(section).toContain("- **Batch-completing multiple tasks** — Defeats real-time tracking purpose")
  })
})
