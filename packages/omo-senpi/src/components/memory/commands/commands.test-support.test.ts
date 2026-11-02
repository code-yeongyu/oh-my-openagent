import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createNodeGitExec, GitCommandError, type GitExec } from "@oh-my-opencode/memory-core"
import { seededRepo, tempIdentity } from "./commands.test-support"

test("#given trusted fixture seeds #when the fixture is prepared #then seed creation avoids hooks but later writes enforce them", async () => {
  const { identity } = await tempIdentity()
  const inner = createNodeGitExec()
  const hookAtCommit: boolean[] = []
  const exec: GitExec = {
    run(argv, options) {
      if (argv.includes("commit")) {
        hookAtCommit.push(existsSync(join(options.cwd, ".git", "hooks", "pre-commit")))
      }
      return inner.run(argv, options)
    },
  }
  const path = "system/persona.md"
  const repo = await seededRepo(identity, [
    { relativePath: path, content: "---\ndescription: Fixture\n---\noriginal\n" },
  ], exec)
  expect(hookAtCommit).toEqual([false])
  for (const name of ["pre-commit", "commit-msg", "post-commit"]) {
    expect(existsSync(join(repo.dir, ".git", "hooks", name))).toBe(true)
  }
  const head = await repo.head()
  await writeFile(join(repo.dir, path), "invalid memory without frontmatter\n")
  await expect(repo.commitWrite([path], "test: invalid fixture edit", {
    agentId: identity.identity,
    authorName: "Fixture test",
  })).rejects.toBeInstanceOf(GitCommandError)
  expect(hookAtCommit).toEqual([false, true])
  expect(await repo.head()).toBe(head)
})
