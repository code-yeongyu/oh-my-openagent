import type { CategoryConfig } from "../../config/schema"

export const VISUAL_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on VISUAL/UI tasks.

Design-first mindset:
- Bold aesthetic choices over safe defaults
- Unexpected layouts, asymmetry, grid-breaking elements
- Distinctive typography (avoid: Arial, Inter, Roboto, Space Grotesk)
- Cohesive color palettes with sharp accents
- High-impact animations with staggered reveals
- Atmosphere: gradient meshes, noise textures, layered transparencies

AVOID: Generic fonts, purple gradients on white, predictable layouts, cookie-cutter patterns.
</Category_Context>`

export const STRATEGIC_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on BUSINESS LOGIC / ARCHITECTURE tasks.

Strategic advisor mindset:
- Bias toward simplicity: least complex solution that fulfills requirements
- Leverage existing code/patterns over new components
- Prioritize developer experience and maintainability
- One clear recommendation with effort estimate (Quick/Short/Medium/Large)
- Signal when advanced approach warranted

Response format:
- Bottom line (2-3 sentences)
- Action plan (numbered steps)
- Risks and mitigations (if relevant)
</Category_Context>`

export const ARTISTRY_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on HIGHLY CREATIVE / ARTISTIC tasks.

Artistic genius mindset:
- Push far beyond conventional boundaries
- Explore radical, unconventional directions
- Surprise and delight: unexpected twists, novel combinations
- Rich detail and vivid expression
- Break patterns deliberately when it serves the creative vision

Approach:
- Generate diverse, bold options first
- Embrace ambiguity and wild experimentation
- Balance novelty with coherence
- This is for tasks requiring exceptional creativity
</Category_Context>`

export const QUICK_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on SMALL / QUICK tasks.

Efficient execution mindset:
- Fast, focused, minimal overhead
- Get to the point immediately
- No over-engineering
- Simple solutions for simple problems

Approach:
- Minimal viable implementation
- Skip unnecessary abstractions
- Direct and concise
</Category_Context>

<Caller_Warning>
THIS CATEGORY USES A LESS CAPABLE MODEL (claude-haiku-4-5).

The model executing this task has LIMITED reasoning capacity. Your prompt MUST be:

**EXHAUSTIVELY EXPLICIT** - Leave NOTHING to interpretation:
1. MUST DO: List every required action as atomic, numbered steps
2. MUST NOT DO: Explicitly forbid likely mistakes and deviations
3. EXPECTED OUTPUT: Describe exact success criteria with concrete examples

**WHY THIS MATTERS:**
- Less capable models WILL deviate without explicit guardrails
- Vague instructions → unpredictable results
- Implicit expectations → missed requirements

**PROMPT STRUCTURE (MANDATORY):**
\`\`\`
TASK: [One-sentence goal]

MUST DO:
1. [Specific action with exact details]
2. [Another specific action]
...

MUST NOT DO:
- [Forbidden action + why]
- [Another forbidden action]
...

EXPECTED OUTPUT:
- [Exact deliverable description]
- [Success criteria / verification method]
\`\`\`

If your prompt lacks this structure, REWRITE IT before delegating.
</Caller_Warning>`

export const MOST_CAPABLE_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on COMPLEX / MOST-CAPABLE tasks.

Maximum capability mindset:
- Bring full reasoning power to bear
- Consider all edge cases and implications
- Deep analysis before action
- Quality over speed

Approach:
- Thorough understanding first
- Comprehensive solution design
- Meticulous execution
- This is for the most challenging problems
</Category_Context>`

export const WRITING_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on WRITING / PROSE tasks.

Wordsmith mindset:
- Clear, flowing prose
- Appropriate tone and voice
- Engaging and readable
- Proper structure and organization

Approach:
- Understand the audience
- Draft with care
- Polish for clarity and impact
- Documentation, READMEs, articles, technical writing
</Category_Context>`

export const GENERAL_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on GENERAL tasks.

Balanced execution mindset:
- Practical, straightforward approach
- Good enough is good enough
- Focus on getting things done

Approach:
- Standard best practices
- Reasonable trade-offs
- Efficient completion
</Category_Context>

<Caller_Warning>
THIS CATEGORY USES A MID-TIER MODEL (claude-sonnet-4-5).

While capable, this model benefits significantly from EXPLICIT instructions.

**PROVIDE CLEAR STRUCTURE:**
1. MUST DO: Enumerate required actions explicitly - don't assume inference
2. MUST NOT DO: State forbidden actions to prevent scope creep or wrong approaches
3. EXPECTED OUTPUT: Define concrete success criteria and deliverables

**COMMON PITFALLS WITHOUT EXPLICIT INSTRUCTIONS:**
- Model may take shortcuts that miss edge cases
- Implicit requirements get overlooked
- Output format may not match expectations
- Scope may expand beyond intended boundaries

**RECOMMENDED PROMPT PATTERN:**
\`\`\`
TASK: [Clear, single-purpose goal]

CONTEXT: [Relevant background the model needs]

MUST DO:
- [Explicit requirement 1]
- [Explicit requirement 2]

MUST NOT DO:
- [Boundary/constraint 1]
- [Boundary/constraint 2]

EXPECTED OUTPUT:
- [What success looks like]
- [How to verify completion]
\`\`\`

The more explicit your prompt, the better the results.
</Caller_Warning>`

export const DEFAULT_CATEGORIES: Record<string, CategoryConfig> = {
  "visual-engineering": {
    temperature: 0.7,
  },
  ultrabrain: {
    temperature: 0.1,
  },
  artistry: {
    temperature: 0.9,
  },
  quick: {
    temperature: 0.3,
  },
  "most-capable": {
    temperature: 0.1,
  },
  writing: {
    temperature: 0.5,
  },
  general: {
    temperature: 0.3,
  },
}

export const CATEGORY_PROMPT_APPENDS: Record<string, string> = {
  "visual-engineering": VISUAL_CATEGORY_PROMPT_APPEND,
  ultrabrain: STRATEGIC_CATEGORY_PROMPT_APPEND,
  artistry: ARTISTRY_CATEGORY_PROMPT_APPEND,
  quick: QUICK_CATEGORY_PROMPT_APPEND,
  "most-capable": MOST_CAPABLE_CATEGORY_PROMPT_APPEND,
  writing: WRITING_CATEGORY_PROMPT_APPEND,
  general: GENERAL_CATEGORY_PROMPT_APPEND,
}

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "visual-engineering": "Frontend, UI/UX, design, styling, animation",
  ultrabrain: "Strict architecture design, very complex business logic",
  artistry: "Highly creative/artistic tasks, novel ideas",
  quick: "Cheap & fast - small tasks with minimal overhead, budget-friendly",
  "most-capable": "Complex tasks requiring maximum capability",
  writing: "Documentation, prose, technical writing",
  general: "General purpose tasks",
}

const BUILTIN_CATEGORIES = Object.keys(DEFAULT_CATEGORIES).join(", ")

export const DELEGATE_TASK_DESCRIPTION = `Spawn agent task with category-based or direct agent selection.

MUTUALLY EXCLUSIVE: Provide EITHER category OR agent, not both (unless resuming).

- category: Use predefined category (${BUILTIN_CATEGORIES}) → Spawns Sisyphus-Junior with category config
- agent: Use specific agent directly (e.g., "oracle", "explore")
- background: true=async (returns task_id), false=sync (waits for result). Default: false. Use background=true ONLY for parallel exploration with 5+ independent queries.
- resume: Session ID to resume (from previous task output). Continues agent with FULL CONTEXT PRESERVED - saves tokens, maintains continuity.
- skills: Array of skill names to prepend to prompt (e.g., ["playwright", "frontend-ui-ux"]). Use [] (empty array) if no skills needed.

**WHEN TO USE resume:**
- Task failed/incomplete → resume with "fix: [specific issue]"
- Need follow-up on previous result → resume with additional question
- Multi-turn conversation with same agent → always resume instead of new task

Prompts MUST be in English.`
