// Patterns for planning files that require skill("creating-changes") first
export const TASKS_MD_PATTERN = 'changes/*/tasks.md';
export const PLAN_MD_PATTERN = 'changes/*/plan.md';

// Broader patterns to catch renamed planning files
export const PLANNING_FILE_PATTERNS = [
  'changes/*/tasks.md',
  'changes/*/plan.md',
  'changes/*/plans.md',
  'changes/*/task.md',
  'changes/*/todo.md',
  'changes/*/todos.md',
  'changes/*/checklist.md',
  'changes/*/implementation.md',
  'changes/*/impl.md',
  'changes/*/work.md',
  'changes/*/workplan.md',
  'changes/*/work-plan.md',
  'changes/*/roadmap.md',
  'changes/*/breakdown.md',
  'changes/*/steps.md',
] as const;

export const ERROR_MESSAGE = `BLOCKED: Must invoke skill("creating-changes") first.

Renaming the file will NOT bypass this check.`;

export const INTERCEPTED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash'] as const;

// Bash command patterns that create files
export const BASH_FILE_CREATION_PATTERNS = [
  />\\s*["']?([^"'\\s|&;]+tasks\\.md)["']?/i,           // > tasks.md, > "tasks.md"
  />>\\s*["']?([^"'\\s|&;]+tasks\\.md)["']?/i,          // >> tasks.md
  /\\bcat\\s+.*>\\s*["']?([^"'\\s|&;]+tasks\\.md)["']?/i, // cat ... > tasks.md
  /\\btee\\s+["']?([^"'\\s|&;]+tasks\\.md)["']?/i,       // tee tasks.md
  /\\btouch\\s+["']?([^"'\\s|&;]+tasks\\.md)["']?/i,     // touch tasks.md
  /\\bcp\\s+.*\\s+["']?([^"'\\s|&;]+tasks\\.md)["']?/i,   // cp ... tasks.md
  /\\bmv\\s+.*\\s+["']?([^"'\\s|&;]+tasks\\.md)["']?/i,   // mv ... tasks.md
  // Plan file patterns
  />\\s*["']?([^"'\\s|&;]+plan\\.md)["']?/i,
  />>\\s*["']?([^"'\\s|&;]+plan\\.md)["']?/i,
  /\\btouch\\s+["']?([^"'\\s|&;]+plan\\.md)["']?/i,
  /\\bcp\\s+.*\\s+["']?([^"'\\s|&;]+plan\\.md)["']?/i,
  /\\bmv\\s+.*\\s+["']?([^"'\\s|&;]+plan\\.md)["']?/i,
] as const;
