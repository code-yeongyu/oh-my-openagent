/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OmoGitMasterSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { buildGitMasterAttributionDirective } from "./directive"

const TRAILER = "Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>"

const repos: string[] = []

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true })
})

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

function exampleCommitCommand(directive: string): string {
  const block = /```bash\n([\s\S]*?)```/.exec(directive)?.[1] ?? ""
  const line = block.split("\n").find((candidate) => candidate.includes(" commit "))
  if (line === undefined) throw new Error("directive carries no commit example")
  return line
}

function git(repo: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true })
}

function scratchRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "omo-git-master-directive-"))
  repos.push(repo)
  git(repo, ["init", "-q"])
  git(repo, ["config", "user.name", "Directive Test"])
  git(repo, ["config", "user.email", "directive-test@example.invalid"])
  git(repo, ["config", "commit.gpgsign", "false"])
  writeFileSync(join(repo, "file.txt"), "content\n")
  git(repo, ["add", "file.txt"])
  return repo
}

function runInRepo(repo: string, command: string): void {
  execFileSync("bash", ["-c", command], { cwd: repo, windowsHide: true })
}

describe("omo-senpi git-master attribution directive", () => {
  test("#given default settings #when the example commit command runs in a real repository #then the commit is the message plus exactly one sisyphus-dev-ai trailer under the git env prefix", () => {
    // given
    const directive = buildGitMasterAttributionDirective(OmoGitMasterSettingsSchema.parse({}), "GIT_MASTER=1") ?? ""
    const repo = scratchRepo()
    const command = exampleCommitCommand(directive)

    // when
    runInRepo(repo, command.replace("{Commit Message}", "feat: first"))

    // then
    expect(command.startsWith("GIT_MASTER=1 git ")).toBe(true)
    expect(git(repo, ["log", "-1", "--format=%B"]).trim()).toBe(`feat: first\n\n${TRAILER}`)
  })

  test("#given a message that already carries the trailer #when the example command runs and the commit is amended with it #then the trailer is not duplicated", () => {
    // given
    const directive = buildGitMasterAttributionDirective(OmoGitMasterSettingsSchema.parse({})) ?? ""
    const repo = scratchRepo()
    const command = exampleCommitCommand(directive).replace(
      '"{Commit Message}"',
      `"feat: second" -m "body" -m "${TRAILER}"`,
    )

    // when
    runInRepo(repo, command)
    runInRepo(repo, command.replace(" commit ", " commit --amend "))

    // then
    expect(occurrences(git(repo, ["log", "-1", "--format=%B"]), TRAILER)).toBe(1)
  })

  test("#given two trailered commits joined by an interactive squash #when the message is rewritten with the instructed amend #then the squashed commit keeps one trailer", () => {
    // given
    const directive = buildGitMasterAttributionDirective(OmoGitMasterSettingsSchema.parse({})) ?? ""
    const command = exampleCommitCommand(directive)
    const repo = scratchRepo()
    runInRepo(repo, command.replace("{Commit Message}", "feat: part one"))
    writeFileSync(join(repo, "file.txt"), "content\nmore\n")
    git(repo, ["add", "file.txt"])
    runInRepo(repo, command.replace("{Commit Message}", "feat: part two"))
    runInRepo(repo, `GIT_SEQUENCE_EDITOR="sed -i.bak '2s/^pick/squash/'" GIT_EDITOR=true git rebase -q -i --root`)
    const squashedTrailers = occurrences(git(repo, ["log", "-1", "--format=%B"]), TRAILER)

    // when
    runInRepo(repo, command.replace(" commit ", " commit --amend ").replace("{Commit Message}", "feat: both parts"))

    // then
    expect(squashedTrailers).toBe(2)
    expect(git(repo, ["log", "-1", "--format=%B"]).trim()).toBe(`feat: both parts\n\n${TRAILER}`)
  })

  test("#given include_co_authored_by false and no footer #when the directive is built #then no directive is emitted", () => {
    // given
    const settings = OmoGitMasterSettingsSchema.parse({ include_co_authored_by: false })

    // when
    const directive = buildGitMasterAttributionDirective(settings)

    // then
    expect(directive).toBeUndefined()
  })

  test("#given the footer on and the co-author off #when the example command runs #then the commit has the footer and no co-author", () => {
    // given
    const directive = buildGitMasterAttributionDirective(
      OmoGitMasterSettingsSchema.parse({ commit_footer: "Shipped with omo", include_co_authored_by: false }),
    ) ?? ""
    const repo = scratchRepo()

    // when
    runInRepo(repo, exampleCommitCommand(directive).replace("{Commit Message}", "feat: footer only"))

    // then
    expect(git(repo, ["log", "-1", "--format=%B"]).trim()).toBe("feat: footer only\n\nShipped with omo")
    expect(directive).not.toContain("sisyphus-dev-ai")
  })

  test("#given the footer and the co-author on #when the example command runs #then the commit has the footer and one trailer", () => {
    // given
    const directive = buildGitMasterAttributionDirective(
      OmoGitMasterSettingsSchema.parse({ commit_footer: "Shipped with omo" }),
    ) ?? ""
    const repo = scratchRepo()

    // when
    runInRepo(repo, exampleCommitCommand(directive).replace("{Commit Message}", "feat: third"))

    // then
    const message = git(repo, ["log", "-1", "--format=%B"])
    expect(message).toContain("Shipped with omo")
    expect(occurrences(message, TRAILER)).toBe(1)
  })
})
