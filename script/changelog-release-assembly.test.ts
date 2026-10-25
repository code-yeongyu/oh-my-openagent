import { describe, expect, test } from "bun:test"
import { assembleRelease } from "./changelog-release-assembly.ts"
import { checkPackageLogs } from "./package-log-gate.ts"

// Release contract (#10477 review rounds 2-3): every entry names the PR that made it unless it already links that
// exact PR of this repository, and code fences are never split, rewritten or linked. One table, one owner.
const PULL = "https://github.com/code-yeongyu/oh-my-openagent/pull"
const link = (pr: number) => `([#${pr}](${PULL}/${pr}))`
const FENCE3 = "```"

const release = (content: string, pr = 50) => assembleRelease("", [{ pr, content }]).body

describe("which links count as the entry's own", () => {
  test.each([
    ["an upstream PR link keeps our credit", "- Work around a crash ([bun#123](https://github.com/oven-sh/bun/pull/123)).", `### Fixed\n\n- Work around a crash ([bun#123](https://github.com/oven-sh/bun/pull/123)). ${link(50)}`],
    ["a senpi PR link keeps our credit", "**Engine.** Adopts [senpi#123](https://github.com/code-yeongyu/senpi/pull/123).", `**Engine.** Adopts [senpi#123](https://github.com/code-yeongyu/senpi/pull/123). ${link(50)}`],
    ["the entry's own link is not repeated", `**Own.** Done ${link(50)}`, `**Own.** Done ${link(50)}`],
    ["a folded car names both the car and the batch", `- Car fix. ${link(21)}`, `### Fixed\n\n- Car fix. ${link(21)} ${link(50)}`],
  ])("%s", (_name, entry, expected) => {
    const content = entry.startsWith("- ") ? `### Fixed\n\n${entry}\n` : `${entry}\n`
    expect(release(content)).toBe(expected)
  })
})

describe("code fences", () => {
  test.each([
    ["a paragraph then a fenced block with a blank line inside", `**Thing.** Use it:\n\n${FENCE3}sh\nfoo\n\nbar\n${FENCE3}`, `**Thing.** Use it: ${link(50)}\n\n${FENCE3}sh\nfoo\n\nbar\n${FENCE3}`],
    ["prose directly followed by a fence gets the link on its prose line", `**Thing.** Use it:\n${FENCE3}sh\nfoo\n${FENCE3}`, `**Thing.** Use it: ${link(50)}\n${FENCE3}sh\nfoo\n${FENCE3}`],
    ["a backtick fence inside a tilde fence does not close it", `~~~md\n${FENCE3}js\nx\n\n**Next.** inside\n~~~\n\n**After.** prose`, `~~~md\n${FENCE3}js\nx\n\n**Next.** inside\n~~~\n\n**After.** prose ${link(50)}`],
    ["a shorter fence does not close a longer one", "````\n```\n\nstill code\n````\n\n**After.** prose", `\`\`\`\`\n\`\`\`\n\nstill code\n\`\`\`\`\n\n**After.** prose ${link(50)}`],
    ["a ### line inside a fence is code, not a section", `**Thing.** Example:\n\n${FENCE3}md\n### Fixed\n- not a bullet\n${FENCE3}`, `**Thing.** Example: ${link(50)}\n\n${FENCE3}md\n### Fixed\n- not a bullet\n${FENCE3}`],
  ])("%s", (_name, content, expected) => {
    expect(release(`${content}\n`)).toBe(expected)
  })

  test("a bullet's indented fence keeps its blank lines and its code unlinked", () => {
    const content = `### Fixed\n\n- Run this:\n  ${FENCE3}sh\n  a\n\n  b\n  ${FENCE3}\n`
    expect(release(content)).toBe(`### Fixed\n\n- Run this: ${link(50)}\n  ${FENCE3}sh\n  a\n\n  b\n  ${FENCE3}`)
  })

  test("an unclosed fence is refused at PR time, before the fragment becomes immutable", () => {
    const input = { addedFiles: [], modifiedFiles: [], deletedFiles: [], isRelease: false, existsAtHead: () => true }
    const verdict = checkPackageLogs({ ...input, fragment: `**Thing.** Use it:\n\n${FENCE3}sh\nfoo\n\n**Later.** prose\n` })
    expect(verdict.pass).toBe(false)
    expect(verdict.reason).toContain("never closed")
  })
})
