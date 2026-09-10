Spawn agent task with category-based or direct agent selection.

  ⚠️  CRITICAL: You MUST provide EITHER category OR subagent_type. Omitting BOTH will FAIL.

  **COMMON MISTAKE (DO NOT DO THIS):**
  ```
  task(description="...", prompt="...")  // ❌ FAILS - missing category AND subagent_type
  ```

  **CORRECT - Using category:**
  ```
  task(category="quick", description="Fix type error", prompt="...")
  ```

  **CORRECT - Using subagent_type with parallel exploration:**
  ```
  task(subagent_type="explore", description="Find patterns", prompt="...", run_in_background=true)
  ```

  REQUIRED: Provide ONE of:
  - category: For task delegation (uses Sisyphus-Junior with category-optimized model)
  - subagent_type: For direct agent invocation (explore, librarian, oracle, etc.)

  **DO NOT provide both.** If category is provided, subagent_type is ignored.

  - load_skills: Optional. Defaults to [] when omitted. Pass ["skill-1", "skill-2"] for skill-specific tasks.
  - category: Use predefined category → Spawns Sisyphus-Junior with category config
    Available categories:
    - visual-engineering: Frontend, UI/UX, design, styling, animation
  - artistry: Complex problem-solving with unconventional, creative approaches - beyond standard patterns
  - ultrabrain: Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.
  - deep: Goal-oriented autonomous problem-solving on hairy problems requiring deep research. ONE goal + ONE deliverable per call — multiple goals must fan out as parallel `deep` calls, never bundled into one.
  - quick: Trivial tasks - single file changes, typo fixes, simple modifications
    <Caller_Warning>Small/fast model: before delegating, write an explicit prompt with numbered must-do steps, forbidden deviations, and concrete success criteria.</Caller_Warning>
  - unspecified-low: Tasks that don't fit other categories, low effort required
    <Selection_Gate>Use only when no specialist category fits, effort is moderate, and scope stays within a few files/modules. Prefer any matching specialist category.</Selection_Gate>
    <Caller_Warning>Provide explicit must-do steps, forbidden scope, and concrete success criteria.</Caller_Warning>
  - unspecified-high: Tasks that don't fit other categories, high effort required
    <Selection_Gate>Use only when no specialist category fits and substantial effort spans systems/modules with broad impact. Use unspecified-low for contained moderate work.</Selection_Gate>
  - writing: Documentation, prose, technical writing
  - subagent_type: Use specific agent directly (explore, librarian, oracle, metis, momus)
  - run_in_background: true is the standard spawn: returns a background task ID like `bg_...` at once and the completion notification delivers the result. false blocks this response until the child finishes (a 30-minute inactivity window, reset by OpenCode busy/retry/running status, not a total wall-clock limit); use it only for a short child whose result gates your very next call. Omitted counts as false.
  - task_id: Continuation session id (`ses_...`) from task metadata. Continues the same subagent session with FULL CONTEXT PRESERVED; not the background task id (`bg_...`).
  - command: The command that triggered this task (optional, for slash command tracking).

  **WHEN TO USE task_id:**
  - Task failed/incomplete → `task(task_id="ses_...", prompt="fix: [specific issue]")`
  - Need follow-up on previous result → `task(task_id="ses_...", prompt="Also: [question]")`
  - Multi-turn conversation with same agent → always `task(task_id="ses_...")` instead of new task

  Prompts MUST be in English.