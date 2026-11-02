#!/usr/bin/env bun
/**
 * bun script/changelog-fragments-cli.ts from-diff --base <ref> --pr <n>
 *   Converts a branch written before fragments (#10841): the paragraphs it added under CHANGELOG.md's
 *   `## [Unreleased]` and the entries it prepended to changes.md or packages/<name>/changes.md move into
 *   changes/unreleased/<n>.md, and those files go back to the merge base's bytes. Commit the result.
 * bun script/changelog-fragments-cli.ts fold-batch --base <ref> --pr <n>
 *   For a batch PR that merged other PRs' branches: every fragment the branch adds moves into the batch's own
 *   changes/unreleased/<n>.md (newest PR first, one block per log), since a PR adds exactly one fragment.
 * Both commands check everything before writing anything.
 */
import { execFileSync } from "node:child_process"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { fragmentPath, FRAGMENT_DIR, mergeUnreleased, unreleasedBody } from "./changelog-fragments"
import { linkNotes } from "./changelog-release-assembly.ts"
import { blockFromPrepend, combineFragments, markerLine, splitFragment } from "./package-log-blocks.ts"

const root = new URL("../", import.meta.url)
const at = (path: string) => new URL(path, root)
// A file URL's pathname is not a path: "/D:/a/..." on Windows, "%20" for a space. git needs the real directory.
const rootPath = fileURLToPath(root)
const git = (...args: string[]) => execFileSync("git", args, { cwd: rootPath, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const paragraphs = (body: string) => body.split(/\n\s*\n/).map((part) => part.trim()).filter((part) => part !== "")

/** The paragraphs a branch added under Unreleased; throws on any other CHANGELOG.md edit. */
function addedUnreleased(base: string, head: string): string[] {
  if (mergeUnreleased(base, "") !== mergeUnreleased(head, "")) {
    throw new Error("CHANGELOG.md was edited outside ## [Unreleased]; undo that edit by hand first")
  }
  const before = paragraphs(unreleasedBody(base))
  const after = paragraphs(unreleasedBody(head))
  const removed = before.filter((paragraph) => !after.includes(paragraph))
  if (removed.length > 0) {
    throw new Error(`the branch changed an existing Unreleased entry (or added a bullet inside an existing ### group); move that text into your fragment by hand: ${removed[0]?.slice(0, 80)}`)
  }
  return after.filter((paragraph) => !before.includes(paragraph))
}

async function existingFragment(pr: number): Promise<string> {
  const file = Bun.file(at(fragmentPath(pr)))
  return (await file.exists()) ? await file.text() : ""
}

async function fromDiff(base: string, pr: number): Promise<void> {
  // The merge base, not the base tip: dev moves after the branch forked, and the gate diffs against the merge base too.
  const mergeBase = git("merge-base", base, "HEAD").trim()
  const changed = (...paths: string[]) => git("diff", "--name-only", `${mergeBase}...HEAD`, "--", ...paths).split("\n").filter(Boolean)
  const dirty = git("status", "--porcelain", "--", "CHANGELOG.md", "changes.md", "packages/*/changes.md", FRAGMENT_DIR).split("\n").filter(Boolean)
  if (dirty.length > 0) throw new Error(`commit or discard the uncommitted changelog edits first: ${dirty.map((line) => line.slice(3)).join(", ")}`)
  const added: string[] = []
  if (changed("CHANGELOG.md").length > 0) {
    added.push(...addedUnreleased(git("show", `${mergeBase}:CHANGELOG.md`), git("show", "HEAD:CHANGELOG.md")))
  }
  const logs = changed("changes.md", "packages/*/changes.md")
  for (const log of logs) {
    const block = blockFromPrepend(log, git("show", `${mergeBase}:${log}`), git("show", `HEAD:${log}`))
    if (block === null) throw new Error(`${log} was edited below its top; move that text by hand`)
    added.push(`${markerLine(block.log)}\n${block.body}`)
  }
  if (added.length === 0) throw new Error("this branch adds no CHANGELOG.md paragraph and no change-log entry")
  const fragment = combineFragments([await existingFragment(pr), ...added])
  for (const path of [...changed("CHANGELOG.md"), ...logs]) git("checkout", mergeBase, "--", path)
  await Bun.write(at(fragmentPath(pr)), fragment)
  console.log(`moved ${added.length} entr${added.length === 1 ? "y" : "ies"} into ${fragmentPath(pr)}; review and commit`)
}

async function foldBatch(base: string, pr: number): Promise<void> {
  const mergeBase = git("merge-base", base, "HEAD").trim()
  const own = fragmentPath(pr)
  const cars = git("diff", "--name-only", "--diff-filter=A", `${mergeBase}...HEAD`, "--", `${FRAGMENT_DIR}/`)
    .split("\n")
    .map((path) => /^changes\/unreleased\/(\d+)\.md$/.exec(path)?.[1])
    .filter((number): number is string => number !== undefined && Number(number) !== pr)
    .map(Number)
    .sort((left, right) => right - left)
  if (cars.length === 0) {
    console.log(`no other fragment to fold into ${own}`)
    return
  }
  // Each car's text is linked to the car before folding, so the batch's release notes still credit every car.
  const contents = await Promise.all(cars.map(async (car) => {
    const split = splitFragment(await Bun.file(at(fragmentPath(car))).text())
    const blocks = split.blocks.map((block) => `${markerLine(block.log)}\n${block.body}`)
    return [linkNotes(split.preamble, car), ...blocks].filter((part) => part !== "").join("\n\n")
  }))
  const fragment = combineFragments([await existingFragment(pr), ...contents])
  await Bun.write(at(own), fragment)
  for (const car of cars) await rm(at(fragmentPath(car)))
  console.log(`folded ${cars.map((car) => `#${car}`).join(", ")} into ${own}; review and commit`)
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  const flag = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
  const base = flag("--base")
  const pr = flag("--pr")
  if (!base || !pr || !/^\d+$/.test(pr) || (command !== "from-diff" && command !== "fold-batch")) {
    console.error("usage: from-diff|fold-batch --base <ref> --pr <n>")
    process.exit(2)
  }
  try {
    await (command === "from-diff" ? fromDiff(base, Number(pr)) : foldBatch(base, Number(pr)))
  } catch (error) {
    console.error(`changelog-fragments: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
