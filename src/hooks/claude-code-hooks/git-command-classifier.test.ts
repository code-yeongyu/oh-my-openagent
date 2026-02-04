import { describe, test, expect } from "bun:test"
import { classifyGitCommand } from "./git-command-classifier"

describe("git-command-classifier", () => {
  describe("isGit detection", () => {
    test("should detect 'git' command", () => {
      // #given
      const command = "git status"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
    })

    test("should detect 'git' with full path", () => {
      // #given
      const command = "/usr/bin/git status"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
    })

    test("should detect 'git' with absolute path on Windows", () => {
      // #given
      const command = "C:\\Program Files\\Git\\bin\\git.exe status"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
    })

    test("should not detect non-git commands", () => {
      // #given
      const command = "npm install"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(false)
    })

    test("should not detect 'git' in quoted strings", () => {
      // #given
      const command = 'echo "git status"'

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(false)
    })

    test("should not detect 'git' in comments", () => {
      // #given
      const command = "# git status"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(false)
    })

    test("should handle empty command", () => {
      // #given
      const command = ""

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(false)
    })

    test("should handle whitespace-only command", () => {
      // #given
      const command = "   "

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(false)
    })
  })

  describe("write operations detection", () => {
    describe("commit operations", () => {
      test("should detect 'git commit'", () => {
        // #given
        const command = "git commit -m 'message'"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
        expect(result.matchedPattern).toBeDefined()
      })

      test("should detect 'git commit' with various flags", () => {
        // #given
        const commands = [
          "git commit",
          "git commit -m 'msg'",
          "git commit --message='msg'",
          "git commit -am 'msg'",
          "git commit --amend",
        ]

        // #when & #then
        commands.forEach((cmd) => {
          const result = classifyGitCommand(cmd)
          expect(result.isWrite).toBe(true)
        })
      })
    })

    describe("push operations", () => {
      test("should detect 'git push'", () => {
        // #given
        const command = "git push"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git push' with various flags", () => {
        // #given
        const commands = [
          "git push",
          "git push origin main",
          "git push --force-with-lease",
          "git push -u origin feature",
        ]

        // #when & #then
        commands.forEach((cmd) => {
          const result = classifyGitCommand(cmd)
          expect(result.isWrite).toBe(true)
        })
      })
    })

    describe("merge operations", () => {
      test("should detect 'git merge'", () => {
        // #given
        const command = "git merge feature-branch"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git merge' with various flags", () => {
        // #given
        const commands = [
          "git merge feature",
          "git merge --no-ff feature",
          "git merge --squash feature",
        ]

        // #when & #then
        commands.forEach((cmd) => {
          const result = classifyGitCommand(cmd)
          expect(result.isWrite).toBe(true)
        })
      })
    })

    describe("rebase operations", () => {
      test("should detect 'git rebase'", () => {
        // #given
        const command = "git rebase main"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git rebase' with various flags", () => {
        // #given
        const commands = [
          "git rebase main",
          "git rebase -i HEAD~3",
          "git rebase --continue",
          "git rebase --abort",
        ]

        // #when & #then
        commands.forEach((cmd) => {
          const result = classifyGitCommand(cmd)
          expect(result.isWrite).toBe(true)
        })
      })
    })

    describe("reset operations", () => {
      test("should detect 'git reset'", () => {
        // #given
        const command = "git reset HEAD~1"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git reset' with various flags", () => {
        // #given
        const commands = [
          "git reset",
          "git reset --soft HEAD~1",
          "git reset --hard HEAD",
          "git reset --mixed",
        ]

        // #when & #then
        commands.forEach((cmd) => {
          const result = classifyGitCommand(cmd)
          expect(result.isWrite).toBe(true)
        })
      })
    })

    describe("checkout operations", () => {
      test("should detect 'git checkout -b' (create branch)", () => {
        // #given
        const command = "git checkout -b feature-branch"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git checkout' switching branches (read)", () => {
        // #given
        const command = "git checkout main"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'git checkout' with file (read)", () => {
        // #given
        const command = "git checkout -- file.txt"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })

    describe("branch operations", () => {
      test("should detect 'git branch -d' (delete)", () => {
        // #given
        const command = "git branch -d feature"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git branch -D' (force delete)", () => {
        // #given
        const command = "git branch -D feature"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git branch -m' (rename)", () => {
        // #given
        const command = "git branch -m old-name new-name"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git branch' listing (read)", () => {
        // #given
        const command = "git branch"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'git branch -a' (read)", () => {
        // #given
        const command = "git branch -a"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })

    describe("tag operations", () => {
      test("should detect 'git tag' creation", () => {
        // #given
        const command = "git tag v1.0.0"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git tag -d' (delete)", () => {
        // #given
        const command = "git tag -d v1.0.0"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })
    })

    describe("stash operations", () => {
      test("should detect 'git stash pop' (write)", () => {
        // #given
        const command = "git stash pop"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git stash apply' (write)", () => {
        // #given
        const command = "git stash apply"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git stash drop' (write)", () => {
        // #given
        const command = "git stash drop"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git stash clear' (write)", () => {
        // #given
        const command = "git stash clear"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git stash' alone (read)", () => {
        // #given
        const command = "git stash"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'git stash list' (read)", () => {
        // #given
        const command = "git stash list"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })

    describe("cherry-pick operations", () => {
      test("should detect 'git cherry-pick'", () => {
        // #given
        const command = "git cherry-pick abc123"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'git cherry-pick --continue'", () => {
        // #given
        const command = "git cherry-pick --continue"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })
    })

    describe("revert operations", () => {
      test("should detect 'git revert'", () => {
        // #given
        const command = "git revert abc123"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })
    })

    describe("am operations", () => {
      test("should detect 'git am'", () => {
        // #given
        const command = "git am patch.diff"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })
    })

    describe("apply operations", () => {
      test("should detect 'git apply'", () => {
        // #given
        const command = "git apply patch.diff"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })
    })

    describe("gh pr operations", () => {
      test("should detect 'gh pr create'", () => {
        // #given
        const command = "gh pr create --title 'test'"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'gh pr merge'", () => {
        // #given
        const command = "gh pr merge 123"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'gh pr close'", () => {
        // #given
        const command = "gh pr close 123"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(true)
      })

      test("should detect 'gh pr list' (read)", () => {
        // #given
        const command = "gh pr list"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'gh pr view' (read)", () => {
        // #given
        const command = "gh pr view 123"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'gh pr status' (read)", () => {
        // #given
        const command = "gh pr status"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'gh pr checks' (read)", () => {
        // #given
        const command = "gh pr checks 123"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })
  })

  describe("read operations detection", () => {
    describe("status operations", () => {
      test("should detect 'git status'", () => {
        // #given
        const command = "git status"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
        expect(result.isGit).toBe(true)
      })
    })

    describe("log operations", () => {
      test("should detect 'git log'", () => {
        // #given
        const command = "git log"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'git log' with flags", () => {
        // #given
        const commands = [
          "git log --oneline",
          "git log -30",
          "git log --pretty=format:'%s'",
        ]

        // #when & #then
        commands.forEach((cmd) => {
          const result = classifyGitCommand(cmd)
          expect(result.isWrite).toBe(false)
        })
      })
    })

    describe("diff operations", () => {
      test("should detect 'git diff'", () => {
        // #given
        const command = "git diff"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'git diff' with flags", () => {
        // #given
        const commands = [
          "git diff --staged",
          "git diff --stat",
          "git diff HEAD~1",
        ]

        // #when & #then
        commands.forEach((cmd) => {
          const result = classifyGitCommand(cmd)
          expect(result.isWrite).toBe(false)
        })
      })
    })

    describe("show operations", () => {
      test("should detect 'git show'", () => {
        // #given
        const command = "git show abc123"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })

    describe("blame operations", () => {
      test("should detect 'git blame'", () => {
        // #given
        const command = "git blame file.ts"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })

    describe("shortlog operations", () => {
      test("should detect 'git shortlog'", () => {
        // #given
        const command = "git shortlog -sn"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })

    describe("remote operations", () => {
      test("should detect 'git remote'", () => {
        // #given
        const command = "git remote"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })

      test("should detect 'git remote -v'", () => {
        // #given
        const command = "git remote -v"

        // #when
        const result = classifyGitCommand(command)

        // #then
        expect(result.isWrite).toBe(false)
      })
    })
  })

  describe("edge cases", () => {
    test("should handle chained commands with &&", () => {
      // #given
      const command = "git add . && git commit -m 'msg'"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(true)
    })

    test("should handle chained commands with ;", () => {
      // #given
      const command = "git status; git log"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(false)
    })

    test("should handle piped commands", () => {
      // #given
      const command = "git log | grep 'feature'"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(false)
    })

    test("should handle commands with quoted arguments", () => {
      // #given
      const command = 'git commit -m "fix: resolve issue"'

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle commands with single-quoted arguments", () => {
      // #given
      const command = "git commit -m 'fix: resolve issue'"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle commands with escaped quotes", () => {
      // #given
      const command = 'git commit -m "fix: \\"quoted\\" issue"'

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle commands with environment variables", () => {
      // #given
      const command = "GIT_AUTHOR_NAME='John' git commit -m 'msg'"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(true)
    })

    test("should handle commands with redirects", () => {
      // #given
      const command = "git log > output.txt"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(false)
    })

    test("should handle commands with background execution", () => {
      // #given
      const command = "git status &"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(false)
    })

    test("should handle case-insensitive git command", () => {
      // #given
      const command = "GIT status"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
    })

    test("should handle git with .exe extension", () => {
      // #given
      const command = "git.exe commit -m 'msg'"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(true)
    })

    test("should handle commands with tabs and multiple spaces", () => {
      // #given
      const command = "git\t\tstatus"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(true)
      expect(result.isWrite).toBe(false)
    })

    test("should not detect git in middle of word", () => {
      // #given
      const command = "bigit status"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isGit).toBe(false)
    })

    test("should handle 'git add' (write)", () => {
      // #given
      const command = "git add ."

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle 'git rm' (write)", () => {
      // #given
      const command = "git rm file.txt"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle 'git mv' (write)", () => {
      // #given
      const command = "git mv old.txt new.txt"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle 'git clean' (write)", () => {
      // #given
      const command = "git clean -fd"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle 'git fetch' (read)", () => {
      // #given
      const command = "git fetch"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(false)
    })

    test("should handle 'git pull' (write - modifies working tree)", () => {
      // #given
      const command = "git pull"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })

    test("should handle 'git config' (read by default)", () => {
      // #given
      const command = "git config user.name"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(false)
    })

    test("should handle 'git config --global' (write)", () => {
      // #given
      const command = "git config --global user.name 'John'"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.isWrite).toBe(true)
    })
  })

  describe("return type validation", () => {
    test("should return object with isGit and isWrite properties", () => {
      // #given
      const command = "git status"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(typeof result.isGit).toBe("boolean")
      expect(typeof result.isWrite).toBe("boolean")
    })

    test("should include matchedPattern when pattern matches", () => {
      // #given
      const command = "git commit -m 'msg'"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.matchedPattern).toBeDefined()
      expect(typeof result.matchedPattern).toBe("string")
    })

    test("should not include matchedPattern for non-git commands", () => {
      // #given
      const command = "npm install"

      // #when
      const result = classifyGitCommand(command)

      // #then
      expect(result.matchedPattern).toBeUndefined()
    })
  })
})
