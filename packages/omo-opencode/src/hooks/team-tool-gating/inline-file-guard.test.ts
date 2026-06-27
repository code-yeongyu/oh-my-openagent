import { describe, expect, test } from "bun:test"

import { detectDestructiveBashCommand, isEditPathAllowed } from "./inline-file-guard"

const CWD = "/repo"

describe("isEditPathAllowed", () => {
  test("matches a glob inside cwd", () => {
    expect(isEditPathAllowed(["src/ui/**"], "src/ui/Button.tsx", CWD)).toBe(true)
    expect(isEditPathAllowed(["src/ui/**", "src/components/**"], "src/components/Modal.tsx", CWD)).toBe(true)
  })

  test("rejects a path outside the glob", () => {
    expect(isEditPathAllowed(["src/ui/**"], "src/api/handler.ts", CWD)).toBe(false)
    expect(isEditPathAllowed(["src/ui/**"], "package.json", CWD)).toBe(false)
  })

  test("rejects cwd-escape via ../ traversal", () => {
    expect(isEditPathAllowed(["src/ui/**"], "../sibling/file.ts", CWD)).toBe(false)
    expect(isEditPathAllowed(["src/ui/**"], "src/ui/../../api/handler.ts", CWD)).toBe(false)
  })

  test("rejects absolute paths outside cwd", () => {
    expect(isEditPathAllowed(["src/ui/**"], "/etc/passwd", CWD)).toBe(false)
    expect(isEditPathAllowed(["src/ui/**"], "/repo/src/ui/Button.tsx", CWD)).toBe(true)
  })

  test("treats filePath === cwd as outside scope", () => {
    expect(isEditPathAllowed(["**"], ".", CWD)).toBe(false)
  })

  test("honors dot:true (hidden files match **)", () => {
    expect(isEditPathAllowed(["**"], ".env", CWD)).toBe(true)
  })
})

describe("detectDestructiveBashCommand", () => {
  describe("destructive git commands (caught)", () => {
    const cases: Array<[string, string]> = [
      ["git restore .", "git restore"],
      ["git restore --staged file.ts", "git restore"],
      ["git checkout -- file.ts", "git checkout (discard)"],
      ["git checkout .", "git checkout (discard)"],
      ["git checkout HEAD file.ts", "git checkout (discard)"],
      ["git checkout -f", "git checkout (discard)"],
      ["git checkout --force", "git checkout (discard)"],
      ["git switch --force main", "git switch --force"],
      ["git switch -f main", "git switch --force"],
      ["git reset --hard", "git reset --hard"],
      ["git reset --hard HEAD", "git reset --hard"],
      ["git clean -fd", "git clean -f"],
      ["git clean -fdx", "git clean -f"],
      ["git stash drop", "git stash drop/clear"],
      ["git stash clear", "git stash drop/clear"],
      ["git rm file.ts", "git rm"],
      ["git rm --cached file.ts", "git rm"],
      ["git branch -D feature", "git branch -D/-d"],
      ["git branch -d feature", "git branch -D/-d"],
      ["git worktree remove --force ../other", "git worktree remove"],
    ]
    for (const [cmd, expectedLabel] of cases) {
      test(`catches: ${cmd}`, () => {
        expect(detectDestructiveBashCommand(cmd)).toBe(expectedLabel)
      })
    }
  })

  describe("destructive filesystem commands (caught)", () => {
    const cases: Array<[string, string]> = [
      ["rm -rf build", "rm -r/-f"],
      ["rm -r build", "rm -r/-f"],
      ["rm -f file.ts", "rm -r/-f"],
      ["rm -fr build", "rm -r/-f"],
      ["find . -delete", "find -delete/-exec rm"],
      ["find . -exec rm {} \\;", "find -delete/-exec rm"],
    ]
    for (const [cmd, expectedLabel] of cases) {
      test(`catches: ${cmd}`, () => {
        expect(detectDestructiveBashCommand(cmd)).toBe(expectedLabel)
      })
    }
  })

  describe("token-split: catches destructive command in pipeline segment", () => {
    const cases = [
      "echo hi && git reset --hard",
      "git status; git clean -fd",
      "git log || git restore .",
      "echo done | git stash drop",
      "echo a\ngit reset --hard",
    ]
    for (const cmd of cases) {
      test(`catches segment in: ${JSON.stringify(cmd)}`, () => {
        expect(detectDestructiveBashCommand(cmd)).not.toBeNull()
      })
    }
  })

  describe("case-insensitive git", () => {
    test("catches Git, GIT, git", () => {
      expect(detectDestructiveBashCommand("Git reset --hard")).not.toBeNull()
      expect(detectDestructiveBashCommand("GIT RESET --HARD")).not.toBeNull()
      expect(detectDestructiveBashCommand("git reset --hard")).not.toBeNull()
    })
  })

  describe("safe commands (allowed)", () => {
    const safeCases = [
      "git status",
      "git diff",
      "git log --oneline",
      "git add src/ui/Button.tsx",
      "git commit -m 'feat: add button'",
      "git stash push",
      "git stash list",
      "git push",
      "git pull",
      "git checkout -b new-branch",
      "git checkout main",
      "git switch main",
      "git branch",
      "git branch new-branch",
      "ls -la",
      "cat README.md",
      "npm test",
      "pytest tests/",
      "ruff check src/",
      "python script.py",
      "echo hello",
      "echo $(date)",
      "dirname $(pwd)",
      "echo $(git rev-parse HEAD)",
      "mkdir -p build/out",
      "touch src/ui/New.tsx",
    ]
    for (const cmd of safeCases) {
      test(`allows: ${cmd}`, () => {
        expect(detectDestructiveBashCommand(cmd)).toBeNull()
      })
    }
  })

  describe("known limitations (documented, NOT caught)", () => {
    // eval/bash -c with LITERAL destructive text IS caught (whole-string scan).
    const literalTextWrapperCases = [
      'eval "git reset --hard"',
      'bash -c "git reset --hard"',
    ]
    for (const cmd of literalTextWrapperCases) {
      test(`catches literal destructive text inside wrapper: ${cmd}`, () => {
        expect(detectDestructiveBashCommand(cmd)).not.toBeNull()
      })
    }

    // Dynamic eval (no literal destructive text) — adversarial, out of scope.
    // File overwrite via redirection/cp/mv/tee — also out of scope (edit-gate bypass via bash).
    const trueGaps = [
      'eval "$malicious"',
      "echo x > important.py",
      "cp a.py b.py",
      "mv a.py b.py",
      "tee important.py",
    ]
    for (const cmd of trueGaps) {
      test(`does NOT catch (documented limitation): ${cmd}`, () => {
        expect(detectDestructiveBashCommand(cmd)).toBeNull()
      })
    }
  })
})
