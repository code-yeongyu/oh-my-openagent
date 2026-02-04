export const TASKS_MD_PATTERN = 'changes/*/tasks.md';
export const ERROR_MESSAGE =
  'Direct creation of tasks.md is blocked. Please use skill("creating-changes") first to ensure proper format.';
export const INTERCEPTED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'Bash'] as const;

// Bash command patterns that create files
export const BASH_FILE_CREATION_PATTERNS = [
  />\s*["']?([^"'\s|&;]+tasks\.md)["']?/i,           // > tasks.md, > "tasks.md"
  />>\s*["']?([^"'\s|&;]+tasks\.md)["']?/i,          // >> tasks.md
  /\bcat\s+.*>\s*["']?([^"'\s|&;]+tasks\.md)["']?/i, // cat ... > tasks.md
  /\btee\s+["']?([^"'\s|&;]+tasks\.md)["']?/i,       // tee tasks.md
  /\btouch\s+["']?([^"'\s|&;]+tasks\.md)["']?/i,     // touch tasks.md
  /\bcp\s+.*\s+["']?([^"'\s|&;]+tasks\.md)["']?/i,   // cp ... tasks.md
  /\bmv\s+.*\s+["']?([^"'\s|&;]+tasks\.md)["']?/i,   // mv ... tasks.md
] as const;
