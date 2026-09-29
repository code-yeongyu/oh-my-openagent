import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { headingSlug, parsePlaybook, PlaybookError, readPlaybook } from "./parse"

const FIXTURE = join(import.meta.dir, "../../../test/fixtures/playbook")

function rulesOf(files: { path: string; content: string }[]) {
  return parsePlaybook(files)
}

describe("playbook parser", () => {
  it("#given the fixture playbook #when read and parsed #then every ### entry and every dated lesson is one entry with its bullets", async () => {
    const parsed = parsePlaybook(await readPlaybook(FIXTURE))

    expect(parsed.entries.map((entry) => entry.key)).toEqual([
      "lessons/2026-01-03-stale-number.md",
      "lessons/2026-01-04-duplicate-reminder.md",
      "rules/slack.md#write-in-english-only-in-the-shared-workspace",
      "rules/slack.md#never-post-a-bare-url-label-every-link-repo-number-title",
      "rules/slack.md#greet-a-new-member-once-in-the-channel-they-joined",
      "rules/telegram.md#keep-each-reply-in-one-message-unless-it-is-longer-than-the-platform-limit",
      "rules/working-style.md#answer-the-question-first-then-give-the-detail",
      "rules/working-style.md#report-a-result-only-with-evidence-from-the-real-surface",
    ])
    expect(parsed.problems).toEqual([])
    expect(parsed.skipped).toEqual([{ file: "lessons/README.md", reason: expect.stringContaining("not a lesson file") }])
    const bareUrl = parsed.entries[3]
    expect(bareUrl).toMatchObject({
      kind: "rule",
      heading: "Never post a bare URL; label every link (repo, number, title).",
      why: "Bare links are hard to read on a small screen.",
      enforced: "Convention.",
      added: "2026-01-01",
      lesson: "An unlabeled link in a status update was skipped by every reader.",
    })
    expect(parsed.entries[5]).toMatchObject({ why: "Splitting a short reply into pieces reads as several unrelated messages." })
    expect(parsed.entries[0]).toMatchObject({
      kind: "lesson",
      title: "A report cited a stale number",
      fix: "Measure every number at the time of the report.",
      date: "2026-01-03",
    })
  })

  it("#given headings with punctuation, quotes, accents and other scripts #when slugged #then the slug is stable and idempotent", () => {
    const cases: [string, string][] = [
      ["Never post a bare URL; label every link (repo, number, title).", "never-post-a-bare-url-label-every-link-repo-number-title"],
      ["Don't ping the whole channel!!", "dont-ping-the-whole-channel"],
      ["Use `run.sh` -- not a raw curl", "use-run-sh-not-a-raw-curl"],
      ["Café résumé naïve", "cafe-resume-naive"],
      ["\u0393\u03B5\u03B9\u03AC \u03C3\u03BF\u03C5", "\u03B3\u03B5\u03B9\u03B1-\u03C3\u03BF\u03C5"],
      ["\uD55C\uAE00 \uC81C\uBAA9!", "\uD55C\uAE00-\uC81C\uBAA9"],
    ]
    for (const [heading, slug] of cases) {
      expect(headingSlug(heading)).toBe(slug)
      expect(headingSlug(slug)).toBe(slug)
    }
  })

  it("#given malformed entries #when parsed #then entries missing Why or Enforced still import with a warning and unknown bullets are reported", () => {
    const parsed = rulesOf([{ path: "rules/misc.md", content: [
      "# Misc",
      "### Keep going without a why",
      "- Enforced: Convention.",
      "### Nothing but a date",
      "- Added: 2026-01-01",
      "- Owner: someone",
      "- just a dash",
    ].join("\n") }])

    expect(parsed.entries.map((entry) => entry.key)).toEqual(["rules/misc.md#keep-going-without-a-why", "rules/misc.md#nothing-but-a-date"])
    expect(parsed.problems.map((problem) => [problem.line, problem.severity, problem.reason])).toEqual([
      [2, "warning", "entry has no '- Why:' bullet"],
      [7, "warning", "bullet has no '<Label>:' prefix; ignored"],
      [6, "warning", "unknown bullet 'owner'; ignored"],
      [4, "warning", "entry has no '- Why:' bullet"],
      [4, "warning", "entry has no '- Enforced:' bullet"],
    ])
  })

  it("#given an entry without a stable identity #when parsed #then empty and duplicate slugs are errors and skipped, and fenced headings are not entries", () => {
    const parsed = rulesOf([{ path: "rules/misc.md", content: [
      "### ?!?",
      "- Why: w",
      "### Same rule",
      "- Why: first",
      "- Enforced: e",
      "### Same rule.",
      "- Why: second",
      "- Enforced: e",
      "```md",
      "### Inside a fence",
      "```",
    ].join("\r\n") }])

    expect(parsed.entries.map((entry) => entry.key)).toEqual(["rules/misc.md#same-rule"])
    expect(parsed.entries[0]).toMatchObject({ why: "first" })
    expect(parsed.problems.filter((problem) => problem.severity === "error").map((problem) => problem.line)).toEqual([1, 6])
  })

  it("#given lesson files #when one has no title and one has no fix #then the untitled one is skipped with an error and the other warns", () => {
    const parsed = rulesOf([
      { path: "lessons/2026-01-05-untitled.md", content: "- What happened: x\n- Fix: y\n" },
      { path: "lessons/2026-01-06-no-fix.md", content: "# No fix yet\n\n- What happened: x\n" },
    ])

    expect(parsed.entries.map((entry) => entry.key)).toEqual(["lessons/2026-01-06-no-fix.md"])
    expect(parsed.problems.map((problem) => [problem.file, problem.severity])).toEqual([
      ["lessons/2026-01-05-untitled.md", "error"],
      ["lessons/2026-01-06-no-fix.md", "warning"],
    ])
  })

  it("#given an include pattern leaving the repo #when read #then it is refused", async () => {
    await expect(readPlaybook(FIXTURE, ["../*.md"])).rejects.toThrow(PlaybookError)
    await expect(readPlaybook(FIXTURE, ["/etc/*"])).rejects.toThrow(PlaybookError)
  })
})
