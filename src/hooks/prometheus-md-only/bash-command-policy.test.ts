import { describe, expect, test } from "bun:test"

import { analyzeBashCommand } from "./bash-command-policy"

const WORKSPACE = "/tmp/test"

describe("bash-command-policy", () => {
  describe("#given read-only commands", () => {
    describe("#when command is a simple read-only tool", () => {
      test("#then cat should be allowed", () => {
        const result = analyzeBashCommand("cat file.ts", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then grep should be allowed", () => {
        const result = analyzeBashCommand("grep pattern src/", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then ls -la should be allowed", () => {
        const result = analyzeBashCommand("ls -la", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then tree should be allowed", () => {
        const result = analyzeBashCommand("tree src/", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then wc -l should be allowed", () => {
        const result = analyzeBashCommand("wc -l file.ts", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then head should be allowed", () => {
        const result = analyzeBashCommand("head -n 20 file.ts", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then tail should be allowed", () => {
        const result = analyzeBashCommand("tail -f log.txt", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then rg should be allowed", () => {
        const result = analyzeBashCommand("rg 'pattern' src/", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then find without dangerous flags should be allowed", () => {
        const result = analyzeBashCommand("find . -name '*.ts' -type f", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then diff should be allowed", () => {
        const result = analyzeBashCommand("diff file1.ts file2.ts", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then sort should be allowed", () => {
        const result = analyzeBashCommand("sort data.txt", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then jq should be allowed", () => {
        const result = analyzeBashCommand("jq '.name' package.json", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then pwd should be allowed", () => {
        const result = analyzeBashCommand("pwd", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then which should be allowed", () => {
        const result = analyzeBashCommand("which node", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then sed should be blocked (can write files internally)", () => {
        const result = analyzeBashCommand("sed 's/a/b/' file.txt", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("sed")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then awk should be blocked (can write files internally)", () => {
        const result = analyzeBashCommand("awk '{print $1}' data.txt", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("awk")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then yq should be blocked (can write files internally)", () => {
        const result = analyzeBashCommand("yq '.key' file.yaml", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("yq")
        expect(result.reason).toContain("not in the allowed list")
      })
    })
  })

  describe("#given git commands", () => {
    describe("#when git subcommand is read-only", () => {
      test("#then git log should be allowed", () => {
        const result = analyzeBashCommand("git log --oneline", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git diff HEAD should be allowed", () => {
        const result = analyzeBashCommand("git diff HEAD", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git status should be allowed", () => {
        const result = analyzeBashCommand("git status", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git show should be allowed", () => {
        const result = analyzeBashCommand("git show HEAD:file.ts", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git blame should be allowed", () => {
        const result = analyzeBashCommand("git blame src/index.ts", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git remote -v should be allowed", () => {
        const result = analyzeBashCommand("git remote -v", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git rev-parse should be allowed", () => {
        const result = analyzeBashCommand("git rev-parse HEAD", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git ls-files should be allowed", () => {
        const result = analyzeBashCommand("git ls-files", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git config --get should be allowed", () => {
        const result = analyzeBashCommand("git config --get user.name", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then git config --list should be allowed", () => {
        const result = analyzeBashCommand("git config --list", WORKSPACE)
        expect(result.allowed).toBe(true)
      })
    })

    describe("#when git subcommand is mutating", () => {
      test("#then git add should be blocked", () => {
        const result = analyzeBashCommand("git add .", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git add")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git commit should be blocked", () => {
        const result = analyzeBashCommand('git commit -m "x"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git commit")
      })

      test("#then git push should be blocked", () => {
        const result = analyzeBashCommand("git push", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git push")
      })

      test("#then git checkout should be blocked", () => {
        const result = analyzeBashCommand("git checkout main", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git checkout")
      })

      test("#then git merge should be blocked", () => {
        const result = analyzeBashCommand("git merge feature", WORKSPACE)
        expect(result.allowed).toBe(false)
      })

      test("#then git rebase should be blocked", () => {
        const result = analyzeBashCommand("git rebase main", WORKSPACE)
        expect(result.allowed).toBe(false)
      })

      test("#then git reset should be blocked", () => {
        const result = analyzeBashCommand("git reset --hard", WORKSPACE)
        expect(result.allowed).toBe(false)
      })

      test("#then git stash should be blocked", () => {
        const result = analyzeBashCommand("git stash", WORKSPACE)
        expect(result.allowed).toBe(false)
      })
    })

    describe("#when git has dangerous flags", () => {
      test("#then git branch -D should be blocked", () => {
        const result = analyzeBashCommand("git branch -D feature", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git branch")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git branch -d should be blocked", () => {
        const result = analyzeBashCommand("git branch -d feature", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git branch -m should be blocked", () => {
        const result = analyzeBashCommand("git branch -m old new", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git tag -d should be blocked", () => {
        const result = analyzeBashCommand("git tag -d v1.0", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git tag")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git tag -a should be blocked", () => {
        const result = analyzeBashCommand("git tag -a v1.0", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git config without --get or --list should be blocked", () => {
        const result = analyzeBashCommand("git config user.name 'test'", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git config")
      })

      test("#then git diff --output=file should be blocked", () => {
        const result = analyzeBashCommand("git diff --output=diff.txt", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("--output")
      })

      test("#then git diff --output diff.txt (two-token) should be blocked", () => {
        const result = analyzeBashCommand("git diff --output diff.txt HEAD", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("--output")
      })

      test("#then git branch new-branch should be blocked", () => {
        const result = analyzeBashCommand("git branch new-branch", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git branch")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git tag v1.0 (create) should be blocked", () => {
        const result = analyzeBashCommand("git tag v1.0", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git tag")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then git remote add should be blocked", () => {
        const result = analyzeBashCommand("git remote add origin https://github.com/x/y", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git remote")
      })

      test("#then git remote without -v should be blocked", () => {
        const result = analyzeBashCommand("git remote", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("git remote")
    })
    })
  })

  describe("#given blocked commands", () => {
    describe("#when command is a system-modifying tool", () => {
      test("#then npm install should be blocked", () => {
        const result = analyzeBashCommand("npm install", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("npm")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then rm -rf should be blocked", () => {
        const result = analyzeBashCommand("rm -rf build/", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("rm")
      })

      test("#then python3 -c should be blocked", () => {
        const result = analyzeBashCommand('python3 -c "print(1)"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("python3")
      })

      test("#then touch should be blocked", () => {
        const result = analyzeBashCommand("touch file.ts", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("touch")
      })

      test("#then mkdir should be blocked", () => {
        const result = analyzeBashCommand("mkdir dir", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("mkdir")
      })

      test("#then chmod should be blocked", () => {
        const result = analyzeBashCommand("chmod 755 file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("chmod")
      })

      test("#then curl should be blocked", () => {
        const result = analyzeBashCommand("curl https://example.com", WORKSPACE)
        expect(result.allowed).toBe(false)
      })

      test("#then wget should be blocked", () => {
        const result = analyzeBashCommand("wget https://example.com", WORKSPACE)
        expect(result.allowed).toBe(false)
      })

      test("#then cp should be blocked", () => {
        const result = analyzeBashCommand("cp src.ts dst.ts", WORKSPACE)
        expect(result.allowed).toBe(false)
      })

      test("#then mv should be blocked", () => {
        const result = analyzeBashCommand("mv old.ts new.ts", WORKSPACE)
        expect(result.allowed).toBe(false)
      })
    })
  })

  describe("#given compound commands", () => {
    describe("#when command uses operators", () => {
      test("#then semicolon should be blocked", () => {
        const result = analyzeBashCommand("echo x; echo y", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then && should be blocked", () => {
        const result = analyzeBashCommand("cat file && rm file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then || should be blocked", () => {
        const result = analyzeBashCommand("cat file || echo fail", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then pipe should be blocked", () => {
        const result = analyzeBashCommand("cat file | grep pattern", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then subshell $() should be blocked", () => {
        const result = analyzeBashCommand("echo $(rm file)", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then backtick subshell should be blocked", () => {
        const result = analyzeBashCommand("echo `rm file`", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then newline should be blocked", () => {
        const result = analyzeBashCommand("echo hello\nrm file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then single & background operator should be blocked", () => {
        const result = analyzeBashCommand("cat file & rm -rf /", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })
    })

    describe("#when operators are inside quotes", () => {
      test("#then semicolon inside single quotes should be allowed", () => {
        const result = analyzeBashCommand("grep 'a;b' file.txt", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then pipe inside double quotes should be allowed", () => {
        const result = analyzeBashCommand('grep "a|b" file.txt', WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then && inside quotes should be allowed", () => {
        const result = analyzeBashCommand("grep 'a && b' file.txt", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then & inside double quotes should be allowed", () => {
        const result = analyzeBashCommand('echo "a & b"', WORKSPACE)
        expect(result.allowed).toBe(true)
      })
    })
  })

  describe("#given redirect operators", () => {
    describe("#when redirecting to .sisyphus/*.md", () => {
      test("#then echo to .sisyphus/plans/plan.md should be allowed", () => {
        const result = analyzeBashCommand('echo "plan" > .sisyphus/plans/plan.md', WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then echo >> append to .sisyphus/drafts/notes.md should be allowed", () => {
        const result = analyzeBashCommand('echo "note" >> .sisyphus/drafts/notes.md', WORKSPACE)
        expect(result.allowed).toBe(true)
      })
    })

    describe("#when redirecting to non-.sisyphus paths", () => {
      test("#then echo to config.json should be blocked", () => {
        const result = analyzeBashCommand('echo "data" > config.json', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Redirect target")
        expect(result.reason).toContain("config.json")
      })

      test("#then cat to src/code.ts should be blocked", () => {
        const result = analyzeBashCommand("cat file > src/code.ts", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("src/code.ts")
      })

      test("#then redirect to non-.md in .sisyphus should be blocked", () => {
        const result = analyzeBashCommand("cat file > .sisyphus/data.json", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Redirect target")
      })
    })
  })

  describe("#given dangerous flags on safe commands", () => {
    describe("#when find has exec flags", () => {
      test("#then find -exec should be blocked", () => {
        const result = analyzeBashCommand("find . -exec rm {} \\;", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-exec")
      })

      test("#then find -execdir should be blocked", () => {
        const result = analyzeBashCommand("find . -execdir chmod 755 {} \\;", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-execdir")
      })

      test("#then find -delete should be blocked", () => {
        const result = analyzeBashCommand("find . -name '*.bak' -delete", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-delete")
      })

      test("#then find -ok should be blocked", () => {
        const result = analyzeBashCommand("find . -ok rm {} \\;", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-ok")
      })

      test("#then find -fprint should be blocked", () => {
        const result = analyzeBashCommand("find . -fprint output.txt", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-fprint")
      })

      test("#then find -fprintf should be blocked", () => {
        const result = analyzeBashCommand('find . -fprintf /tmp/out "%f"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-fprintf")
      })

      test("#then find -fls should be blocked", () => {
        const result = analyzeBashCommand("find . -fls /tmp/out", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-fls")
      })

      test("#then find -fprint0 should be blocked", () => {
        const result = analyzeBashCommand("find . -fprint0 /tmp/out", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-fprint0")
      })

    })

    describe("#when sed/awk/yq are used (interpreter commands)", () => {
      test("#then sed -i should be blocked", () => {
        const result = analyzeBashCommand("sed -i 's/a/b/' file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("sed")
      })

      test("#then awk with file-writing program should be blocked", () => {
        const result = analyzeBashCommand(`awk 'BEGIN{print 1 > "src/x.ts"}'`, WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("awk")
      })

      test("#then sed w command should be blocked", () => {
        const result = analyzeBashCommand("sed 'w src/x.ts' file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("sed")
      })
    })

    describe("#when sort/tree use -o output flag", () => {
      test("#then sort -o should be blocked", () => {
        const result = analyzeBashCommand("sort data.txt -o src/index.ts", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-o")
      })

      test("#then tree -o should be blocked", () => {
        const result = analyzeBashCommand("tree -o output.txt", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("-o")
      })

      test("#then sort without -o should be allowed", () => {
        const result = analyzeBashCommand("sort data.txt", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then tree without -o should be allowed", () => {
        const result = analyzeBashCommand("tree src/", WORKSPACE)
        expect(result.allowed).toBe(true)
      })
    })
  })

  describe("#given command wrappers", () => {
    describe("#when first token is a wrapper", () => {
      test("#then env should be blocked", () => {
        const result = analyzeBashCommand("env rm file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("env")
      })

      test("#then bash -c should be blocked", () => {
        const result = analyzeBashCommand('bash -c "rm file"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("bash")
      })

      test("#then sudo should be blocked", () => {
        const result = analyzeBashCommand("sudo rm file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("sudo")
      })

      test("#then xargs should be blocked", () => {
        const result = analyzeBashCommand("xargs rm", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("xargs")
      })

      test("#then sh should be blocked", () => {
        const result = analyzeBashCommand("sh -c 'rm file'", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("sh")
      })

      test("#then zsh should be blocked", () => {
        const result = analyzeBashCommand("zsh -c 'rm file'", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("zsh")
      })

      test("#then command should be blocked", () => {
        const result = analyzeBashCommand("command rm file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("command")
      })

      test("#then nohup should be blocked", () => {
        const result = analyzeBashCommand("nohup rm file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("nohup")
      })

      test("#then exec should be blocked", () => {
        const result = analyzeBashCommand("exec rm file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("exec")
      })
    })
  })

  describe("#given echo command", () => {
    describe("#when echo has no redirect", () => {
      test("#then echo hello world should be allowed", () => {
        const result = analyzeBashCommand('echo "hello world"', WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then bare echo should be allowed", () => {
        const result = analyzeBashCommand("echo", WORKSPACE)
        expect(result.allowed).toBe(true)
      })
    })
  })

  describe("#given unknown commands (default-deny)", () => {
    describe("#when command is not in allowlist", () => {
      test("#then perl should be blocked", () => {
        const result = analyzeBashCommand("perl script.pl", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("perl")
        expect(result.reason).toContain("not in the allowed list")
      })

      test("#then ruby should be blocked", () => {
        const result = analyzeBashCommand('ruby -e "puts 1"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("ruby")
      })

      test("#then dd should be blocked", () => {
        const result = analyzeBashCommand("dd if=/dev/zero of=file", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("dd")
      })

      test("#then node should be blocked", () => {
        const result = analyzeBashCommand("node -e 'console.log(1)'", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("node")
      })

      test("#then bun should be blocked", () => {
        const result = analyzeBashCommand("bun run build", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("bun")
      })
    })
  })

  describe("#given edge cases", () => {
    test("#then empty command should be blocked", () => {
      const result = analyzeBashCommand("", WORKSPACE)
      expect(result.allowed).toBe(false)
    })

    test("#then whitespace-only command should be blocked", () => {
      const result = analyzeBashCommand("   ", WORKSPACE)
      expect(result.allowed).toBe(false)
    })

    test("#then command with extra spaces should be parsed correctly", () => {
      const result = analyzeBashCommand("  cat   file.ts  ", WORKSPACE)
      expect(result.allowed).toBe(true)
    })
  })

  describe("#given command substitution bypass attempts", () => {
    describe("#when subshell is inside double quotes", () => {
      test("#then echo with $() in double quotes should be blocked", () => {
        const result = analyzeBashCommand('echo "$(rm file)"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then echo with $() writing via redirect inside subshell should be blocked", () => {
        const result = analyzeBashCommand('echo "$(cat foo > bar)"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then echo with backticks in double quotes should be blocked", () => {
        const result = analyzeBashCommand('echo "`rm file`"', WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })
    })

    describe("#when subshell is inside single quotes (safe)", () => {
      test("#then $() inside single quotes should be allowed", () => {
        const result = analyzeBashCommand("grep '$(pattern)' file.txt", WORKSPACE)
        expect(result.allowed).toBe(true)
      })

      test("#then backticks inside single quotes should be allowed", () => {
        const result = analyzeBashCommand("grep '`pattern`' file.txt", WORKSPACE)
        expect(result.allowed).toBe(true)
      })
    })

    describe("#when process substitution is used", () => {
      test("#then <() process substitution should be blocked", () => {
        const result = analyzeBashCommand("cat <(rm file)", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })

      test("#then >() process substitution should be blocked", () => {
        const result = analyzeBashCommand("tee >(rm file)", WORKSPACE)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Compound commands")
      })
    })
  })

  describe("#given quoted redirect targets", () => {
    test("#then quoted .sisyphus path should be allowed", () => {
      const result = analyzeBashCommand('echo plan > ".sisyphus/plans/x.md"', WORKSPACE)
      expect(result.allowed).toBe(true)
    })

    test("#then single-quoted .sisyphus path should be allowed", () => {
      const result = analyzeBashCommand("echo plan > '.sisyphus/plans/x.md'", WORKSPACE)
      expect(result.allowed).toBe(true)
    })

    test("#then quoted non-.sisyphus path should be blocked", () => {
      const result = analyzeBashCommand('echo x > "src/foo.ts"', WORKSPACE)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("Redirect target")
    })
  })
})
