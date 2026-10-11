import { describe, expect, test } from "bun:test"
import { announce, composeMessage } from "./release-announce"

const tag = "v5.1.29"
const headline = "**Sessions resume correctly.** Reopened sessions keep their state."
const body = `${headline}\n\n### Fixed\n\n**Tools stay available.** Shared tools no longer disappear.\n\n- abc123 internal commit`
const options = {
  tag, event: "workflow_dispatch", webhook: "https://discord.com/api/webhooks/123/dummy",
  dryRun: false, probe: false,
} as const

function transport(responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  return {
    calls,
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return response
    },
  }
}

function release(overrides = {}) {
  return Response.json({ tag_name: tag, body, draft: false, prerelease: false, ...overrides })
}

describe("release announcement composition", () => {
  test("#given release notes #when composed #then the shipped Discord format and installers are present", () => {
    const content = composeMessage(tag, body)
    expect(content.startsWith("## OmO 5.1.29\n\nSessions resume correctly.\n\n")).toBe(true)
    expect(content).toContain("```sh\ncurl -fsSL https://get.omo.dev/install.sh | bash\n```")
    expect(content).toContain("```powershell\nirm https://get.omo.dev/install.ps1 | iex\n```")
    expect(content).toContain(headline)
    expect(content).toContain("**Tools stay available.**")
    expect(content).not.toContain("abc123")
    expect(content.endsWith(`The full notes are at <https://github.com/code-yeongyu/oh-my-openagent/releases/tag/${tag}>`)).toBe(true)
  })

  test("#given oversized notes #when composed #then complete paragraphs fit below 2000 characters", () => {
    const large = `**Large change.** ${"whole words ".repeat(200)}`
    const content = composeMessage(tag, `${headline}\n\n${large}\n\n**Later.** Omitted after the cut.`)
    expect(content.length).toBeLessThan(2000)
    expect(content).toContain(headline)
    expect(content).not.toContain("Large change")
    expect(content).not.toContain("whole words")
    expect(content).not.toContain("Later.")
  })

  test("#given many short headlines #when composed #then only the first four are included", () => {
    const content = composeMessage(tag, Array.from({ length: 8 }, (_, i) => `**Change ${i}.** Description.`).join("\n\n"))
    expect(content).toContain("**Change 3.**")
    expect(content).not.toContain("**Change 4.**")
  })

  test("#given an oversized opening #when composed #then the hook does not overflow", () => {
    expect(composeMessage(tag, `**${"word ".repeat(500)}**`).length).toBeLessThan(2000)
  })

  test.each([null, "", " \n\t "])("#given empty body %p #when composed #then it fails", (notes) => {
    expect(() => composeMessage(tag, notes)).toThrow("Release body is empty")
  })
})

describe("release announcement delivery", () => {
  test("#given mention text #when posted #then mentions are suppressed in the actual payload", async () => {
    const fake = transport([release({ body: "**Fixed.** @here and @everyone <@123> <@&456>" }), Response.json({ id: "42" })])
    expect(await announce(options, fake.fetch)).toBe("posted")
    const post = fake.calls[1]
    expect(post?.url).toBe(`${options.webhook}?wait=true`)
    expect(post?.init?.method).toBe("POST")
    const payload = JSON.parse(String(post?.init?.body))
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    expect(payload.content).not.toMatch(/@(here|everyone)/)
  })

  test("#given dry run and probe enabled #when run #then only GitHub is read and the message length is printed", async () => {
    const fake = transport([release()])
    const output: string[] = []
    expect(await announce({ ...options, dryRun: true, probe: true }, fake.fetch, (line) => output.push(line))).toBe("dry-run")
    expect(fake.calls).toHaveLength(1)
    expect(output).toContain(composeMessage(tag, body))
    expect(output).toContain(`Length: ${composeMessage(tag, body).length} characters`)
    expect(output[0]).toMatch(/^::stop-commands::/)
  })

  test.each([false, true])("#given missing secret and dryRun=%p #when run #then it fails before network access", async (dryRun) => {
    const fake = transport([])
    await expect(announce({ ...options, webhook: undefined, dryRun }, fake.fetch)).rejects.toThrow("is missing")
    expect(fake.calls).toHaveLength(0)
  })

  test.each(["v5.1.29-beta.1", "v5.1.29-lazycodex.1", "5.1.29", "_assets"])(
    "#given nonstable published tag %s #when triggered #then no requests are made", async (value) => {
      const fake = transport([])
      expect(await announce({ ...options, tag: value, event: "release" }, fake.fetch)).toBe("skipped")
      expect(fake.calls).toHaveLength(0)
    },
  )

  test.each([{ draft: true }, { prerelease: true }])("#given excluded release %p #when fetched #then no Discord post occurs", async (flags) => {
    const fake = transport([release(flags)])
    expect(await announce(options, fake.fetch)).toBe("skipped")
    expect(fake.calls).toHaveLength(1)
  })

  test("#given an empty fetched body #when run #then no Discord post occurs", async () => {
    const fake = transport([release({ body: "" })])
    await expect(announce(options, fake.fetch)).rejects.toThrow("Release body is empty")
    expect(fake.calls).toHaveLength(1)
  })

  test.each([400, 401, 429, 500])("#given Discord HTTP %s #when posting #then the run fails", async (status) => {
    const fake = transport([release(), new Response("secret-bearing response", { status })])
    await expect(announce(options, fake.fetch)).rejects.toThrow(`Discord POST returned HTTP ${status}`)
  })

  test("#given a GitHub lookup failure #when run #then it fails before posting", async () => {
    const fake = transport([new Response(null, { status: 404 })])
    await expect(announce(options, fake.fetch)).rejects.toThrow("GitHub release lookup returned HTTP 404")
    expect(fake.calls).toHaveLength(1)
  })

  test("#given a transport error containing credentials #when run #then only sanitized error text escapes", async () => {
    await expect(announce(options, async () => { throw new Error(options.webhook) })).rejects.toThrow("GET request failed")
  })

  test("#given a successful POST without a message ID #when run #then it fails", async () => {
    const fake = transport([release(), Response.json({})])
    await expect(announce(options, fake.fetch)).rejects.toThrow("did not return a created message")
  })

  test("#given a different returned tag #when run #then no post occurs", async () => {
    const fake = transport([release({ tag_name: "v5.1.28" })])
    await expect(announce(options, fake.fetch)).rejects.toThrow("different release tag")
    expect(fake.calls).toHaveLength(1)
  })
})
