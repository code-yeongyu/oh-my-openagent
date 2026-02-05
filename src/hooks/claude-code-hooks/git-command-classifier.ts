export interface GitCommandClassification {
  isGit: boolean
  isWrite: boolean
  matchedPattern?: string
}

export function classifyGitCommand(command: string): GitCommandClassification {
  const trimmed = command.trim()

  if (!trimmed) {
    return { isGit: false, isWrite: false }
  }

  // Check if command starts with git or gh (after stripping comments and quotes)
  const gitMatch = extractGitCommand(trimmed)
  if (!gitMatch) {
    return { isGit: false, isWrite: false }
  }

  const subcommand = gitMatch.subcommand
  const fullCommand = gitMatch.fullCommand
  const isGhCommand = gitMatch.isGhCommand

  // Determine if it's a write operation
  const writePattern = detectWriteOperation(subcommand, fullCommand)

  return {
    isGit: true,
    isWrite: writePattern !== null,
    matchedPattern: writePattern ?? undefined,
  }
}

interface GitMatch {
  subcommand: string
  fullCommand: string
  isGhCommand?: boolean
}

function extractGitCommand(command: string): GitMatch | null {
  // Skip comments
  if (command.startsWith("#")) {
    return null
  }

  // Skip quoted strings
  if (command.startsWith('"') || command.startsWith("'")) {
    return null
  }

  // Handle environment variables (e.g., GIT_AUTHOR_NAME='John' git commit)
  let workingCommand = command
  const envVarMatch = command.match(/^([A-Z_]+=[^\s]+\s+)+(.+)$/)
  if (envVarMatch) {
    workingCommand = envVarMatch[2]
  }

  const parts = workingCommand.split(/\s*(?:&&|\|\||[;|])\s*/)

  for (const part of parts) {
    const trimmed = part.trim()

    const gitPattern = /^(?:.*[/\\])?git(?:\.exe)?\s+(.*)$/i
    const gitMatch = trimmed.match(gitPattern)

    if (gitMatch) {
      const rawArgs = gitMatch[1].trim()
      const args = rawArgs.split(/[><&]/)[0].trim()
      const subcommandMatch = args.match(/^(\S+)/)
      const subcommand = subcommandMatch ? subcommandMatch[1] : ""

      return {
        subcommand: subcommand.toLowerCase(),
        fullCommand: args,
        isGhCommand: false,
      }
    }

    const ghPattern = /^(?:.*[/\\])?gh\s+(.*)$/i
    const ghMatch = trimmed.match(ghPattern)

    if (ghMatch) {
      const rawArgs = ghMatch[1].trim()
      const args = rawArgs.split(/[><&]/)[0].trim()
      const subcommandMatch = args.match(/^(\S+)/)
      const subcommand = subcommandMatch ? subcommandMatch[1] : ""

      return {
        subcommand: subcommand.toLowerCase(),
        fullCommand: args,
        isGhCommand: true,
      }
    }
  }

  return null
}

function detectWriteOperation(subcommand: string, fullCommand: string): string | null {
  // Write operations: commit, push, merge, rebase, reset, checkout -b, branch -d/-D/-m, tag, stash pop/apply/drop/clear, cherry-pick, revert, am, apply, add, rm, mv, clean, pull, config (with value), gh pr create/merge/close

  const writePatterns: Array<[RegExp, string]> = [
    // Commit operations
    [/^commit\b/, "git commit"],
    [/^add\b/, "git add"],
    [/^rm\b/, "git rm"],
    [/^mv\b/, "git mv"],

    // Push operations
    [/^push\b/, "git push"],

    // Merge operations
    [/^merge\b/, "git merge"],

    // Rebase operations
    [/^rebase\b/, "git rebase"],

    // Reset operations
    [/^reset\b/, "git reset"],

    // Checkout with -b (create branch)
    [/^checkout\s+(?:-b|--branch)\b/, "git checkout -b"],

    // Branch operations: delete, rename
    [/^branch\s+(?:-d|-D|-m)\b/, "git branch -d/-D/-m"],

    // Tag operations
    [/^tag\b/, "git tag"],

    // Stash operations: pop, apply, drop, clear
    [/^stash\s+(?:pop|apply|drop|clear)\b/, "git stash (write)"],

    // Cherry-pick operations
    [/^cherry-pick\b/, "git cherry-pick"],

    // Revert operations
    [/^revert\b/, "git revert"],

    // Am operations (apply mailbox)
    [/^am\b/, "git am"],

    // Apply operations
    [/^apply\b/, "git apply"],

    // Clean operations
    [/^clean\b/, "git clean"],

    // Pull operations (modifies working tree)
    [/^pull\b/, "git pull"],

    // Config with value (write)
    [/^config\s+(?:--global|--local|--system)?\s+\S+\s+/, "git config (write)"],

    // gh pr operations: create, merge, close
    [/^pr\s+(?:create|merge|close)\b/, "gh pr (write)"],
  ]

  for (const [pattern, name] of writePatterns) {
    if (pattern.test(fullCommand)) {
      return name
    }
  }

  return null
}
