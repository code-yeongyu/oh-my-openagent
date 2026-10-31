import { describe, expect, test } from "bun:test"
import { assembleRelease } from "./changelog-release-assembly.ts"
import { scanFences } from "./changelog-notes-markdown.ts"
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

  test("a line indented four or more spaces is an indented code line, not a fence", () => {
    expect(() => scanFences(`    ${FENCE3}\ncode`)).not.toThrow()
    expect(scanFences(`    ${FENCE3}\ncode`).map((line) => line.fenced)).toEqual([false, false])
  })

  test("a nested bullet's fence is measured from its own item, so it stays a fence", () => {
    const content = `### Fixed\n\n- Outer:\n  - Inner:\n    ${FENCE3}sh\n    a\n\n    b\n    ${FENCE3}\n`
    expect(release(content)).toBe(`### Fixed\n\n- Outer:\n  - Inner: ${link(50)}\n    ${FENCE3}sh\n    a\n\n    b\n    ${FENCE3}`)
  })

  test("the entry's own link inside a code block does not count as its link", () => {
    const content = `**X.** see:\n${FENCE3}\n(${PULL}/50)\n${FENCE3}\n`
    expect(release(content)).toBe(`**X.** see: ${link(50)}\n${FENCE3}\n(${PULL}/50)\n${FENCE3}`)
  })

  test("a fence at column 0 under a bullet is refused with a message that says to indent it", () => {
    const input = { addedFiles: [], modifiedFiles: [], deletedFiles: [], isRelease: false, existsAtHead: () => true }
    const verdict = checkPackageLogs({ ...input, fragment: `### Fixed\n\n- Run this:\n${FENCE3}sh\na\n${FENCE3}\n` })
    expect(verdict.pass).toBe(false)
    expect(verdict.reason).toContain("indent the fence")
  })
})

// #11253 review round 2: a fence's allowed indent is measured from the text column of the list item it sits in,
// for every CommonMark list marker; leaving a nested item returns to the parent's column, not to column 0.
describe("fences inside every kind of list item", () => {
  const F = FENCE3
  test.each([
    ["a - item", `- x\n    ${F}\n    a\n    ${F}`, [false, true, true, true]],
    ["a * item", `* x\n    ${F}\n    a\n    ${F}`, [false, true, true, true]],
    ["a + item", `+ x\n    ${F}\n    a\n    ${F}`, [false, true, true, true]],
    ["a 1. item", `1. x\n    ${F}\n    a\n    ${F}`, [false, true, true, true]],
    ["a 1) item", `1) x\n    ${F}\n    a\n    ${F}`, [false, true, true, true]],
    ["a 10. item (text at column 4)", `10. x\n       ${F}\n       a\n       ${F}`, [false, true, true, true]],
    ["too deep for a 1. item is indented code", `1. x\n        ${F}\n        a`, [false, false, false]],
    ["a nested * item with a blank line in its fence", `* x\n  * y\n    ${F}\n    a\n\n    ${F}`, [false, false, true, true, true, true]],
    ["a paragraph back in the outer item uses that item's column", `- a\n  - b\n    - c\n  para in a\n     ${F}\n     z\n     ${F}`, [false, false, false, false, true, true, true]],
    ["a tab-indented item nested in a - item", `- a\n\t- c\n\t  ${F}\n\t  z\n\t  ${F}`, [false, false, true, true, true]],
    ["a tab at column 0 is indented code, not a list item", `\t- c\n\t  ${F}`, [false, false]],
    ["a tab after the marker", `1.\tx\n    ${F}\n    a\n    ${F}`, [false, true, true, true]],
    ["outside any list, four spaces is indented code", `    ${F}\ncode`, [false, false]],
  ])("%s", (_name, text, fenced) => {
    expect(scanFences(text).map((line) => line.fenced)).toEqual(fenced)
  })

  test("an ordered list in the paragraphs keeps its fenced code byte-identical and unlinked", () => {
    const code = `    ${F}sh\n    a\n\n    b\n    ${F}`
    const body = release(`Steps:\n\n1. Run:\n${code}\n`)
    expect(body).toContain(code)
    expect(body).not.toContain(`${F} ${link(50)}`)
    expect(body).not.toContain(`a ${link(50)}`)
  })

  // #11253 review round 3 HIGH 1: the PR check runs the release's own assembly, so whatever it accepts the stamp
  // places, and code inside list items keeps every byte even with a blank line before the fence.
  test.each([
    ["a 10. item with a blank line before its fence", `10. Run:\n\n    ${F}sh\n    a\n    ${F}\n`, `    ${F}sh\n    a\n    ${F}`],
    ["a nested * item with a blank line before its fence", `* x\n  * y\n\n    ${F}\n    a\n    ${F}\n`, `    ${F}\n    a\n    ${F}`],
    ["an intro paragraph, then a numbered list with fenced steps", `**Steps.** Do this:\n\n1. Install:\n\n   ${F}sh\n   bun add x\n   ${F}\n\n2. Run it.\n`, `   ${F}sh\n   bun add x\n   ${F}`],
  ])("the PR check accepts %s and the release places it with its code untouched", (_name, preamble, code) => {
    const input = { addedFiles: [], modifiedFiles: [], deletedFiles: [], isRelease: false, existsAtHead: () => true }
    expect(checkPackageLogs({ ...input, fragment: preamble }).pass).toBe(true)
    const body = release(preamble)
    expect(body).toContain(code)
    expect(body.split("\n").filter((line) => line.includes(`(${PULL}/50)`)).every((line) => !line.trimStart().startsWith(F))).toBe(true)
  })

  test("a list that continues an intro paragraph is one entry, linked once at its end", () => {
    const preamble = `**Steps.** Do this:\n\n1. Install:\n\n   ${F}sh\n   bun add x\n   ${F}\n\n2. Run it.\n`
    expect(release(preamble)).toBe(`**Steps.** Do this:\n\n1. Install:\n\n   ${F}sh\n   bun add x\n   ${F}\n\n2. Run it. ${link(50)}`)
  })

  test("paragraphs that each start at column 0 stay separate entries, each linked", () => {
    expect(release("**A.** one\n\n**B.** two\n")).toBe(`**A.** one ${link(50)}\n\n**B.** two ${link(50)}`)
  })
})

// #11253 review round 4 LOW 1: an indented code block (4+ columns past its container, after a blank line) is code; the
// PR link never lands inside it.
describe("indented code blocks are never linked", () => {
  test.each([
    ["a paragraph, then indented code, then a paragraph", "**A.** one\n\n    code\n\n**B.** two\n", `**A.** one ${link(50)}\n\n    code\n\n**B.** two ${link(50)}`],
    ["a paragraph followed by indented code", "**A.** one\n\n    code\n", `**A.** one ${link(50)}\n\n    code`],
    ["indented code inside a list item", "**A.** steps:\n\n- a\n\n      code\n", `**A.** steps:\n\n- a ${link(50)}\n\n      code`],
    ["an entry that is all indented code stays as written", "    code\n", "    code"],
    ["indented code right after a closing fence", `**A.** one\n\n${FENCE3}\nx\n${FENCE3}\n    code\n`, `**A.** one ${link(50)}\n\n${FENCE3}\nx\n${FENCE3}\n    code`],
    ["indented code after a blank line after a closing fence", `**A.** one\n\n${FENCE3}\nx\n${FENCE3}\n\n    code\n`, `**A.** one ${link(50)}\n\n${FENCE3}\nx\n${FENCE3}\n\n    code`],
    ["a lazy continuation line is paragraph text, not code", "**A.** one\n    more\n", `**A.** one\n    more ${link(50)}`],
  ])("%s", (_name, content, expected) => {
    expect(release(content)).toBe(expected)
  })
})

describe("legacy duplicates", () => {
  test("another repository's PR link in the legacy text does not consume our fragment", () => {
    const legacy = "- Bump ([senpi#123](https://github.com/code-yeongyu/senpi/pull/123))."
    const result = assembleRelease(legacy, [{ pr: 123, content: "**X.** y\n" }])
    expect(result.duplicates).toEqual([])
    expect(result.body).toContain(`**X.** y ${link(123)}`)
  })

  test("our own PR link in the legacy text still consumes the fragment", () => {
    const result = assembleRelease(`**X.** y ${link(123)}`, [{ pr: 123, content: "**X.** y\n" }])
    expect(result.duplicates).toEqual([123])
    expect(result.body).toBe(`**X.** y ${link(123)}`)
  })
})
