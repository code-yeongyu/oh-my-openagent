type HephaestusTodoDisciplineVariant = "gpt" | "gpt-5-4" | "gpt-5-3-codex"

interface TodoDisciplineCopy {
  trackLine: string
  createBullets: [string, string, string]
  workflowLines: [string, string, string, string]
  detailBlock?: string[]
}

function buildSection(
  heading: string,
  nounPlural: "tasks" | "todos",
  createHeading: string,
  copy: TodoDisciplineCopy,
): string {
  const lines = [
    `## ${heading}`,
    "",
    copy.trackLine,
    "",
    `### ${createHeading}`,
    "",
    ...copy.createBullets,
    "",
    "### Workflow (STRICT)",
    "",
    ...copy.workflowLines,
  ]

  if (copy.detailBlock && copy.detailBlock.length > 0) {
    lines.push("", ...copy.detailBlock)
  }

  lines.push("", `**NO ${nounPlural.toUpperCase()} ON MULTI-STEP WORK = INCOMPLETE WORK.**`)

  return lines.join("\n")
}

function getTodoDisciplineCopy(
  variant: HephaestusTodoDisciplineVariant,
  useTaskSystem: boolean,
): {
  heading: string
  nounPlural: "tasks" | "todos"
  createHeading: string
  copy: TodoDisciplineCopy
} {
  if (variant === "gpt-5-4") {
    if (useTaskSystem) {
      return {
        heading: "Task Discipline (NON-NEGOTIABLE)",
        nounPlural: "tasks",
        createHeading: "When to Create Tasks (MANDATORY)",
        copy: {
          trackLine: "Track ALL multi-step work with tasks. This is your execution backbone.",
          createBullets: [
            "- 2+ step task — `task_create` FIRST, atomic breakdown",
            "- Uncertain scope — `task_create` to clarify thinking",
            "- Complex single task — break down into trackable steps",
          ],
          workflowLines: [
            "1. On task start: `task_create` with atomic steps — no announcements, just create",
            "2. Before each step: `task_update(status=\"in_progress\")` (ONE at a time)",
            "3. After each step: `task_update(status=\"completed\")` IMMEDIATELY (NEVER batch)",
            "4. Scope changes: update tasks BEFORE proceeding",
          ],
          detailBlock: [
            "Tasks prevent drift, enable recovery if interrupted, and make each commitment explicit. Skipping tasks on multi-step work, batch-completing, or proceeding without `in_progress` are blocking violations.",
          ],
        },
      }
    }

    return {
      heading: "Todo Discipline (NON-NEGOTIABLE)",
      nounPlural: "todos",
      createHeading: "When to Create Todos (MANDATORY)",
      copy: {
        trackLine: "Track ALL multi-step work with todos. This is your execution backbone.",
        createBullets: [
          "- 2+ step task — `todowrite` FIRST, atomic breakdown",
          "- Uncertain scope — `todowrite` to clarify thinking",
          "- Complex single task — break down into trackable steps",
        ],
        workflowLines: [
          "1. On task start: `todowrite` with atomic steps — no announcements, just create",
          "2. Before each step: mark `in_progress` (ONE at a time)",
          "3. After each step: mark `completed` IMMEDIATELY (NEVER batch)",
          "4. Scope changes: update todos BEFORE proceeding",
        ],
        detailBlock: [
          "Todos prevent drift, enable recovery if interrupted, and make each commitment explicit. Skipping todos on multi-step work, batch-completing, or proceeding without `in_progress` are blocking violations.",
        ],
      },
    }
  }

  if (variant === "gpt-5-3-codex") {
    if (useTaskSystem) {
      return {
        heading: "Task Discipline (NON-NEGOTIABLE)",
        nounPlural: "tasks",
        createHeading: "When to Create Tasks (MANDATORY)",
        copy: {
          trackLine: "**Track ALL multi-step work with tasks. This is your execution backbone.**",
          createBullets: [
            "- **2+ step task** — `task_create` FIRST, atomic breakdown",
            "- **Uncertain scope** — `task_create` to clarify thinking",
            "- **Complex single task** — Break down into trackable steps",
          ],
          workflowLines: [
            "1. **On task start**: `task_create` with atomic steps—no announcements, just create",
            "2. **Before each step**: `task_update(status=\\\"in_progress\\\")` (ONE at a time)",
            "3. **After each step**: `task_update(status=\\\"completed\\\")` IMMEDIATELY (NEVER batch)",
            "4. **Scope changes**: Update tasks BEFORE proceeding",
          ],
          detailBlock: [
            "### Why This Matters",
            "",
            "- **Execution anchor**: Tasks prevent drift from original request",
            "- **Recovery**: If interrupted, tasks enable seamless continuation",
            "- **Accountability**: Each task = explicit commitment to deliver",
            "",
            "### Anti-Patterns (BLOCKING)",
            "",
            "- **Skipping tasks on multi-step work** — Steps get forgotten, user has no visibility",
            "- **Batch-completing multiple tasks** — Defeats real-time tracking purpose",
            "- **Proceeding without `in_progress`** — No indication of current work",
            "- **Finishing without completing tasks** — Task appears incomplete",
          ],
        },
      }
    }

    return {
      heading: "Todo Discipline (NON-NEGOTIABLE)",
      nounPlural: "todos",
      createHeading: "When to Create Todos (MANDATORY)",
      copy: {
        trackLine: "**Track ALL multi-step work with todos. This is your execution backbone.**",
        createBullets: [
          "- **2+ step task** — `todowrite` FIRST, atomic breakdown",
          "- **Uncertain scope** — `todowrite` to clarify thinking",
          "- **Complex single task** — Break down into trackable steps",
        ],
        workflowLines: [
          "1. **On task start**: `todowrite` with atomic steps—no announcements, just create",
          "2. **Before each step**: Mark `in_progress` (ONE at a time)",
          "3. **After each step**: Mark `completed` IMMEDIATELY (NEVER batch)",
          "4. **Scope changes**: Update todos BEFORE proceeding",
        ],
        detailBlock: [
          "### Why This Matters",
          "",
          "- **Execution anchor**: Todos prevent drift from original request",
          "- **Recovery**: If interrupted, todos enable seamless continuation",
          "- **Accountability**: Each todo = explicit commitment to deliver",
          "",
          "### Anti-Patterns (BLOCKING)",
          "",
          "- **Skipping todos on multi-step work** — Steps get forgotten, user has no visibility",
          "- **Batch-completing multiple todos** — Defeats real-time tracking purpose",
          "- **Proceeding without `in_progress`** — No indication of current work",
          "- **Finishing without completing todos** — Task appears incomplete",
        ],
      },
    }
  }

  if (useTaskSystem) {
    return {
      heading: "Task Discipline (NON-NEGOTIABLE)",
      nounPlural: "tasks",
      createHeading: "When to Create Tasks (MANDATORY)",
      copy: {
        trackLine: "**Track ALL multi-step work with tasks. This is your execution backbone.**",
        createBullets: [
          "- **2+ step task** — `task_create` FIRST, atomic breakdown",
          "- **Uncertain scope** — `task_create` to clarify thinking",
          "- **Complex single task** — Break down into trackable steps",
        ],
        workflowLines: [
          "1. **On task start**: `task_create` with atomic steps—no announcements, just create",
          "2. **Before each step**: `task_update(status=\"in_progress\")` (ONE at a time)",
          "3. **After each step**: `task_update(status=\"completed\")` IMMEDIATELY (NEVER batch)",
          "4. **Scope changes**: Update tasks BEFORE proceeding",
        ],
      },
    }
  }

  return {
    heading: "Todo Discipline (NON-NEGOTIABLE)",
    nounPlural: "todos",
    createHeading: "When to Create Todos (MANDATORY)",
    copy: {
      trackLine: "**Track ALL multi-step work with todos. This is your execution backbone.**",
      createBullets: [
        "- **2+ step task** — `todowrite` FIRST, atomic breakdown",
        "- **Uncertain scope** — `todowrite` to clarify thinking",
        "- **Complex single task** — Break down into trackable steps",
      ],
      workflowLines: [
        "1. **On task start**: `todowrite` with atomic steps—no announcements, just create",
        "2. **Before each step**: Mark `in_progress` (ONE at a time)",
        "3. **After each step**: Mark `completed` IMMEDIATELY (NEVER batch)",
        "4. **Scope changes**: Update todos BEFORE proceeding",
      ],
    },
  }
}

export function buildHephaestusTodoDisciplineSection(
  variant: HephaestusTodoDisciplineVariant,
  useTaskSystem: boolean,
): string {
  const { heading, nounPlural, createHeading, copy } = getTodoDisciplineCopy(
    variant,
    useTaskSystem,
  )

  return buildSection(heading, nounPlural, createHeading, copy)
}
