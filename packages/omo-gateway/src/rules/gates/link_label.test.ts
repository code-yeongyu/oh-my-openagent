import { describe, expect, it } from "bun:test"
import { createGithubTitleCache } from "./github-titles"
import { gate } from "./link_label"
import { repairedText, reply } from "./testing"

function github(titles: Record<string, string>) {
  const calls: string[] = []
  const resolver = createGithubTitleCache({
    fetchTitle: async (owner, repo, number) => {
      calls.push(`${owner}/${repo}#${number}`)
      const title = titles[`${owner}/${repo}#${number}`]
      if (title === undefined) throw new Error("offline")
      return title
    },
  })
  return { resolver, calls }
}

describe("link_label gate", () => {
  it("#given only labeled links and mentions #when run #then it passes without a lookup", async () => {
    const { resolver, calls } = github({})
    const result = await gate.run(reply("See <https://x.test/a|the doc> and <@U000ALICE>."), {}, { github: resolver })
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([])
  })

  it("#given a bare GitHub PR URL with trailing punctuation #when run #then it is repaired to repo, number and title", async () => {
    const { resolver } = github({ "acme/widget#42": "Fix <Foo> rendering" })
    const result = await gate.run(reply("Merged https://github.com/acme/widget/pull/42."), {}, { github: resolver })
    expect(repairedText(result)).toBe("Merged <https://github.com/acme/widget/pull/42|widget #42 Fix \u2039Foo\u203A rendering>.")
  })

  it("#given a GitHub link labeled without its number #when run #then the label is repaired", async () => {
    const { resolver } = github({ "acme/widget#7": "Crash on start" })
    const result = await gate.run(reply("<https://github.com/acme/widget/issues/7|this bug>"), {}, { github: resolver })
    expect(repairedText(result)).toBe("<https://github.com/acme/widget/issues/7|widget #7 Crash on start>")
  })

  it("#given a bare non-GitHub URL #when run #then it is refused", async () => {
    const { resolver } = github({})
    expect(await gate.run(reply("Logs: https://x.test/run?id=1"), {}, { github: resolver })).toEqual({
      refuse: "links need a label: write <https://x.test/run?id=1|label> instead of the bare URL",
    })
  })

  it("#given odd URL shapes (uppercase scheme, empty label, url as label) #when run #then each is refused", async () => {
    const { resolver } = github({})
    for (const text of ["<HTTPS://x.test|x>", "<https://x.test|>", "<https://x.test|https://x.test>", "<https://x.test>"]) {
      expect(await gate.run(reply(text), {}, { github: resolver })).toHaveProperty("refuse")
    }
  })

  it("#given the title lookup is offline #when a GitHub URL is bare #then it is refused with the reason", async () => {
    const { resolver } = github({})
    const result = await gate.run(reply("https://github.com/acme/widget/pull/9"), {}, { github: resolver })
    expect(result).toEqual({ refuse: expect.stringContaining("GitHub title lookup failed (offline)") })
  })
})
