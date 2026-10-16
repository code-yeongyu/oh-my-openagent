#!/usr/bin/env bun
import { execFileSync } from "node:child_process"
import { isUserFacingPath, shippingPolicy } from "./changelog-shipping-policy.mjs"

export { isUserFacingPath }

const noChangelogLabel = "no-changelog"

export function hasAddedUnreleasedLine(before, after, diff) {
  // Keep original line numbers while ignoring Markdown comments, including multiline ones.
  const visible = after.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ""))
  const eligible = new Set()
  let inUnreleased = false
  for (const [index, line] of visible.split("\n").entries()) {
    if (/^##\s/.test(line)) {
      inUnreleased = /^## \[Unreleased\](?:\s.*)?$/.test(line)
      continue
    }
    if (inUnreleased && line.trim() && !/^#{1,6}\s/.test(line.trim())) eligible.add(index + 1)
  }
  const previousLines = new Set(before.split("\n").map((line) => line.trim()))
  let headLine = 0
  let inHunk = false
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      headLine = Number(hunk[1])
      inHunk = true
    } else if (inHunk && line.startsWith("+")) {
      if (eligible.has(headLine) && !previousLines.has(line.slice(1).trim())) return true
      headLine += 1
    } else if (inHunk && line.startsWith(" ")) {
      headLine += 1
    }
  }
  return false
}

// Paragraphs this PR adds to ## [Unreleased]: a block with an added line whose bold title (or whole text) is new.
export function addedUnreleasedParagraphs(before, after, diff) {
  const added = new Set(diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1).trim()).filter(Boolean))
  const section = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(after.replace(/<!--[\s\S]*?-->/g, ""))
  if (!section) return []
  // Drop heading lines rather than whole blocks: an entry directly under "### Fixed" is still checked.
  return section[1].split(/\n\s*\n/).map((block) => block.split("\n").filter((line) => !/^#{1,6}\s/.test(line.trim())).join("\n").trim()).filter((block) => {
    if (!block) return false
    if (!block.split("\n").some((line) => added.has(line.trim()))) return false
    const title = /^\*\*(.+?)\*\*/.exec(block)?.[1]
    return title ? !before.includes(`**${title}**`) : !before.includes(block)
  })
}

function missingOwnPrLink(paragraphs, prNumber) {
  const own = new RegExp(`/pull/${prNumber}\\)`)
  return paragraphs.filter((paragraph) => !own.test(paragraph))
}

function hasReleaseTransition(before, after) {
  const sections = (text) => text.split(/(?=^##\s)/m).map((part) => {
    const [heading, ...body] = part.split("\n")
    return { heading, body: body.join("\n").trim() }
  })
  const previous = sections(before)
  const current = sections(after)
  const unreleased = (section) => /^## \[Unreleased\](?:\s.*)?$/.test(section.heading)
  const old = previous.find(unreleased)
  const index = current.findIndex(unreleased)
  if (!old || index < 0 || current[index].body) return false
  const released = current[index + 1]
  const version = /^## \[(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)\](?:[ \t].*)?$/.exec(released?.heading ?? "")
  if (!version || previous.some((section) => section.heading.startsWith(`## [${version[1]}]`))) return false
  // A heading alone is not a release: move the complete existing notes, unchanged.
  const visible = old.body.replace(/<!--[\s\S]*?-->/g, "")
  return visible.split("\n").some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()))
    && released.body === old.body
}

export function checkPrChangelog({ changedFiles, policy, previousPolicy = policy, before, after, diff, labels = [], prNumber }) {
  const userFacingFiles = changedFiles.filter((path) => isUserFacingPath(path, policy) || isUserFacingPath(path, previousPolicy))
  if (labels.includes(noChangelogLabel)) return { pass: true, reason: "no-changelog label present", userFacingFiles }
  if (userFacingFiles.length === 0) return { pass: true, reason: "no user-facing changes", userFacingFiles }
  if (hasAddedUnreleasedLine(before, after, diff)) {
    const unlinked = prNumber ? missingOwnPrLink(addedUnreleasedParagraphs(before, after, diff), prNumber) : []
    if (unlinked.length > 0) return { pass: false, reason: `added Unreleased paragraph(s) without a link to this PR (#${prNumber}): ${unlinked.map((p) => p.split("\n")[0].slice(0, 80)).join(" | ")}`, userFacingFiles }
    return { pass: true, reason: "added an Unreleased content line", userFacingFiles }
  }
  if (hasReleaseTransition(before, after)) return { pass: true, reason: "moved Unreleased content into a new release section", userFacingFiles }
  return { pass: false, reason: "user-facing changes without an added Unreleased content line", userFacingFiles }
}

export function main(argv) {
  const args = { "--repo": process.cwd(), "--head": "HEAD", "--labels": process.env.CHANGELOG_GATE_LABELS ?? "[]", "--pr": process.env.CHANGELOG_GATE_PR ?? "" }
  for (let index = 0; index < argv.length; index += 2) {
    if (!["--repo", "--base", "--head", "--labels", "--pr"].includes(argv[index]) || !argv[index + 1]) {
      throw new Error("usage: bun script/check-pr-changelog.mjs --base <revision> [--head <revision>] [--repo <path>] [--labels <JSON array>] [--pr <number>]")
    }
    args[argv[index]] = argv[index + 1]
  }
  const base = args["--base"] ?? process.env.CHANGELOG_GATE_BASE
  if (!base) throw new Error("missing --base")
  const labels = JSON.parse(args["--labels"])
  if (args["--pr"] && !/^\d+$/.test(args["--pr"])) throw new Error("--pr must be a PR number")
  const prNumber = args["--pr"] ? Number(args["--pr"]) : undefined
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")) throw new Error("labels must be a JSON string array")
  const git = (...gitArgs) => execFileSync("git", ["-C", args["--repo"], ...gitArgs], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  // Resolve untrusted CLI revisions before using them in Git commands or tree selectors.
  const resolve = (revision) => git("rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`).trim()
  const head = resolve(args["--head"])
  const mergeBase = git("merge-base", resolve(base), head).trim()
  // Disable rename detection: deleting a shipped source by moving it to docs must still count.
  const changedFiles = git("diff", "--no-renames", "--name-only", "-z", mergeBase, head).split("\0").filter(Boolean)
  const policyAt = (revision) => shippingPolicy(
    git("ls-tree", "-r", "--name-only", "-z", revision).split("\0").filter(Boolean),
    (path) => git("show", `${revision}:${path}`),
  )
  const readChangelog = (revision) => {
    const exists = git("ls-tree", "--name-only", revision, "--", "CHANGELOG.md").trim()
    return exists ? git("show", `${revision}:CHANGELOG.md`) : ""
  }
  const result = checkPrChangelog({
    changedFiles,
    policy: policyAt(head),
    previousPolicy: policyAt(mergeBase),
    before: readChangelog(mergeBase),
    after: readChangelog(head),
    diff: git("diff", "--no-ext-diff", "--no-textconv", "--unified=0", mergeBase, head, "--", "CHANGELOG.md"),
    labels,
    prNumber,
  })
  console.log(`changelog-gate: ${result.pass ? "PASS" : "FAIL"} - ${result.reason}`)
  for (const path of result.userFacingFiles) console.log(`  user-facing: ${path}`)
  if (!result.pass) console.log(prNumber ? `Add a content line under ## [Unreleased] in CHANGELOG.md that links this PR (https://github.com/code-yeongyu/oh-my-openagent/pull/${prNumber}), or ask a maintainer to apply no-changelog.` : "Add a content line under ## [Unreleased] in CHANGELOG.md, or ask a maintainer to apply no-changelog.")
  return result.pass ? 0 : 1
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`changelog-gate: ERROR - ${error.message}`)
    process.exitCode = 1
  }
}
