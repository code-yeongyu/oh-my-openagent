import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { assertDenyListConfigured, neutralizeCrossRepoReferences, normalizeForDeny } from "./changelog-release-notes"

const DENY_ENV = "RELEASE_NOTES_PRIVATE_NAMES"
const REQUIRE_ENV = "CI_RELEASE_NOTES_REQUIRE_DENY"
const ENTRIES = ["acme-org/acme-svc", "hidden-tool"]

let savedDeny: string | undefined
let savedRequire: string | undefined

beforeEach(() => {
  savedDeny = process.env[DENY_ENV]
  savedRequire = process.env[REQUIRE_ENV]
  process.env[DENY_ENV] = "acme-org/acme-svc\nhidden-tool"
  delete process.env[REQUIRE_ENV]
})

afterEach(() => {
  if (savedDeny === undefined) delete process.env[DENY_ENV]
  else process.env[DENY_ENV] = savedDeny
  if (savedRequire === undefined) delete process.env[REQUIRE_ENV]
  else process.env[REQUIRE_ENV] = savedRequire
})

const NAME_CHAR = /[a-z0-9._-]/

/** True when the normalized text still holds a deny entry at non-name boundaries. */
function holdsDenyEntry(text: string, entries: readonly string[]): boolean {
  const normalized = normalizeForDeny(text)
  for (const entry of entries) {
    for (let at = normalized.indexOf(entry); at >= 0; at = normalized.indexOf(entry, at + 1)) {
      const before = normalized.charAt(at - 1)
      const after = normalized.charAt(at + entry.length)
      if ((at === 0 || !NAME_CHAR.test(before)) && (after === "" || !NAME_CHAR.test(after))) return true
    }
  }
  return false
}

// One row per leak shape found across the review rounds.
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["markdown link url", "[notes](https://github.com/acme-org/acme-svc/pull/5)"],
  ["autolink", "<https://github.com/acme-org/acme-svc>"],
  ["bare url", "https://github.com/acme-org/acme-svc/issues/1"],
  ["scheme-less host", "github.com/acme-org/acme-svc"],
  ["www host", "www.github.com/acme-org/acme-svc"],
  ["uppercase host", "HTTPS://GITHUB.COM/ACME-ORG/ACME-SVC"],
  ["api host", "https://api.github.com/repos/acme-org/acme-svc/pulls/2"],
  ["raw host", "https://raw.githubusercontent.com/acme-org/acme-svc/main/a.md"],
  ["codeload host", "https://codeload.github.com/acme-org/acme-svc/zip/main"],
  ["compare fork syntax", "https://github.com/code-yeongyu/senpi/compare/main...acme-org:acme-svc:feat"],
  [
    "nested in public github url",
    "https://github.com/code-yeongyu/senpi/blob/main/https://github.com/acme-org/acme-svc",
  ],
  ["nested in non-github url", "https://example.com/r?u=https://github.com/acme-org/acme-svc"],
  ["percent-encoded nested", "https://example.com/r?u=https%3A%2F%2Fgithub.com%2Facme-org%2Facme-svc"],
  ["trailing-dot host", "https://github.com./acme-org/acme-svc"],
  ["underscore emphasis", "_https://github.com/acme-org/acme-svc_"],
  ["asterisk emphasis", "*github.com/hidden-tool*"],
  ["relative path", "[x](../acme-org/acme-svc)"],
  ["double slash after host", "https://github.com//acme-org/acme-svc"],
  ["percent-encoded token outside url", "see %61cme-org%2Facme-svc here"],
  ["markdown backslash escapes", "acme\\-org/acme\\-svc"],
  ["markdown escapes in url", "https://github.com/acme\\-org/acme\\-svc"],
  ["html numeric entities", "https://github.com/acme&#45;org&#47;acme-svc"],
  ["html named and hex entities", "https://github.com&#x2f;acme-org&sol;acme-svc"],
  ["double encoded entity", "https://github.com&amp;#47;acme-org/acme-svc"],
  ["backslash relative path", "..\\acme-org\\acme-svc"],
  ["backslash relative bare name", "..\\hidden-tool\\README.md"],
  ["owner/repo#N", "acme-org/acme-svc#12"],
  ["repo#N", "hidden-tool#12"],
  ["emphasised repo#N and owner/repo#N", "Fixes _hidden-tool#3_ and **acme-org/acme-svc#4**."],
  ["bare name url", "https://github.com/hidden-tool"],
  ["private name in link text", "[hidden-tool#3](https://github.com/code-yeongyu/senpi)"],
  ["plain owner/repo", "ported from acme-org/acme-svc last week"],
]

describe("name-based deny pass shape table", () => {
  test("covers every review-round shape", () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(30)
  })

  for (const [label, input] of SHAPES) {
    test("#given " + label + " #when neutralized #then no deny entry survives", () => {
      const output = neutralizeCrossRepoReferences(input)
      expect(holdsDenyEntry(output, ENTRIES)).toBe(false)
      expect(output).toContain("tracked internally")
    })
  }

  test("#given a wrapped token #when neutralized #then surrounding emphasis stays outside", () => {
    expect(neutralizeCrossRepoReferences("_https://github.com/acme-org/acme-svc_")).toBe("_tracked internally_")
    expect(neutralizeCrossRepoReferences("**acme-org/acme-svc#4**")).toBe("**tracked internally**")
  })

  test("#given a deny pass over text alone #when the allowlist already passes it #then the deny pass still redacts", () => {
    expect(neutralizeCrossRepoReferences("see acme-org/acme-svc.")).toBe("see tracked internally.")
  })
})

describe("name-based deny pass leaves public text alone", () => {
  const PUBLIC = [
    "Fixed a crash, see [#12](https://github.com/code-yeongyu/oh-my-openagent/pull/12) and senpi#4.",
    "<https://github.com/code-yeongyu/senpi/compare/v1.0.0...v1.0.1>",
    "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/README.md",
    "Plain prose with a tool name and hidden tools mentioned loosely, version 5.1.2.",
    "[docs](https://docs.github.com/en/actions) and https://example.com/guide_to_things",
  ]

  for (const input of PUBLIC) {
    test("#given public-only text #when neutralized #then it is byte-identical: " + input.slice(0, 30), () => {
      expect(neutralizeCrossRepoReferences(input)).toBe(input)
    })
  }

  test("#given an empty deny list #when neutralized #then only the allowlist applies", () => {
    process.env[DENY_ENV] = ""
    expect(neutralizeCrossRepoReferences("see hidden-tool and acme-org/acme-svc")).toBe(
      "see hidden-tool and acme-org/acme-svc",
    )
    expect(neutralizeCrossRepoReferences("see hidden-tool#12")).toBe("see tracked internally")
  })

  test("#given a comma separated mixed-case list #when neutralized #then every entry applies", () => {
    process.env[DENY_ENV] = " Acme-Org/Acme-Svc , ,Hidden-Tool\n"
    expect(neutralizeCrossRepoReferences("ACME-ORG/ACME-SVC")).toBe("tracked internally")
    expect(neutralizeCrossRepoReferences("https://github.com/x/hidden-tool")).toBe("tracked internally")
  })

  test("#given name boundaries #when a longer name contains an entry #then it is kept", () => {
    expect(neutralizeCrossRepoReferences("https://example.com/hidden-tool-extra")).toBe(
      "https://example.com/hidden-tool-extra",
    )
    expect(neutralizeCrossRepoReferences("see my-acme-org/acme-svc2")).toBe("see my-acme-org/acme-svc2")
  })
})

describe("bare names only match in reference contexts", () => {
  test("#given deny docs #when prose uses the word #then it stays, references go", () => {
    process.env[DENY_ENV] = "docs"
    expect(neutralizeCrossRepoReferences("Updated the docs and the API docs.")).toBe(
      "Updated the docs and the API docs.",
    )
    expect(neutralizeCrossRepoReferences("see docs#12")).toBe("see tracked internally")
    expect(neutralizeCrossRepoReferences("https://github.com/x/docs")).toBe("tracked internally")
    expect(neutralizeCrossRepoReferences("[x](https://github.com/x/docs/pull/1)")).toBe("tracked internally")
    expect(neutralizeCrossRepoReferences("see https://docs.github.com/en/actions")).toBe(
      "see https://docs.github.com/en/actions",
    )
  })

  test("#given deny owner/repo #when plain text names it #then it is redacted", () => {
    process.env[DENY_ENV] = "acme-org/acme-svc"
    expect(neutralizeCrossRepoReferences("acme-org/acme-svc")).toBe("tracked internally")
  })
})

describe("assertDenyListConfigured", () => {
  test("#given no require flag #when the list is empty #then it does not throw", () => {
    process.env[DENY_ENV] = ""
    expect(() => assertDenyListConfigured()).not.toThrow()
  })

  test("#given the require flag #when the list is unset or blank #then it throws without echoing names", () => {
    process.env[REQUIRE_ENV] = "1"
    delete process.env[DENY_ENV]
    expect(() => assertDenyListConfigured()).toThrow(DENY_ENV)
    process.env[DENY_ENV] = " \n, ,"
    expect(() => assertDenyListConfigured()).toThrow(DENY_ENV)
  })

  test("#given the require flag #when the list has entries #then it does not throw", () => {
    process.env[REQUIRE_ENV] = "1"
    expect(() => assertDenyListConfigured()).not.toThrow()
  })

  test("#given a flag other than 1 #when the list is empty #then it does not throw", () => {
    process.env[REQUIRE_ENV] = "0"
    process.env[DENY_ENV] = ""
    expect(() => assertDenyListConfigured()).not.toThrow()
  })
})

describe("name-based deny pass performance", () => {
  const SIZE = 100_000
  const inputs: ReadonlyArray<readonly [string, string]> = [
    ["prose", "word ".repeat(SIZE / 5)],
    ["urls", "https://example.com/a ".repeat(SIZE / 22)],
    ["percent runs", "%25".repeat(SIZE / 3)],
    ["entity runs", "&amp;".repeat(SIZE / 5)],
    ["backslashes", "\\".repeat(SIZE)],
    ["near-miss name", "hidden-too ".repeat(SIZE / 11)],
    ["repeated entry prefix", "hidden-tool-".repeat(SIZE / 12)],
  ]
  for (const [label, input] of inputs) {
    test("#given a 100k char " + label + " input #when neutralized #then it finishes under one second", () => {
      const started = performance.now()
      neutralizeCrossRepoReferences(input)
      expect(performance.now() - started).toBeLessThan(1000)
    })
  }
})
