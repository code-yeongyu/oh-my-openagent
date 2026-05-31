import { describe, expect, test } from "bun:test"
import { STAR_REPOSITORIES, formatGitHubStarCommand, starGitHubRepositories } from "./star-request"

describe("star-request", () => {
  test("formats the legacy GitHub CLI command for manual fallback output", () => {
    // given
    const repository = "code-yeongyu/oh-my-openagent"

    // when
    const command = formatGitHubStarCommand(repository)

    // then
    expect(command).toBe("gh api --silent --method PUT /user/starred/code-yeongyu/oh-my-openagent >/dev/null 2>&1 || true")
  })

  test("runs GitHub star requests for every repository", async () => {
    // given
    const starred: string[] = []

    // when
    const results = await starGitHubRepositories(STAR_REPOSITORIES, async (repository) => {
      starred.push(repository)
    })

    // then
    expect(starred).toEqual([...STAR_REPOSITORIES])
    expect(results).toEqual(STAR_REPOSITORIES.map((repository) => ({ repository, ok: true })))
  })

  test("keeps going when one repository cannot be starred", async () => {
    // given
    const repositories = ["code-yeongyu/oh-my-openagent", "code-yeongyu/lazycodex"] as const

    // when
    const results = await starGitHubRepositories(repositories, async (repository) => {
      if (repository === "code-yeongyu/lazycodex") throw new Error("gh auth missing")
    })

    // then
    expect(results).toEqual([
      { repository: "code-yeongyu/oh-my-openagent", ok: true },
      { repository: "code-yeongyu/lazycodex", ok: false, error: "gh auth missing" },
    ])
  })
})
