#!/usr/bin/env bun
/**
 * Release-state step: assemble `changes/unreleased/*.md` into `## [Unreleased]`, stamp that
 * section into the released section for <version>, and delete the consumed fragments — all in the
 * release commit. Refuses to release an empty fragment set and refuses to silently drop
 * hand-written Unreleased content: Unreleased is machine-assembled from fragments (#9961).
 */
import { readdir, rm } from "node:fs/promises"
import { FRAGMENT_DIR, mergeUnreleased, parseFragment, readFragments, unreleasedBody } from "./changelog-fragments"
import { stampUnreleased } from "./changelog-release-notes"
import { assembleRelease } from "./changelog-release-assembly.ts"
import { compileBlocks, splitFragment } from "./package-log-blocks.ts"

async function main(): Promise<void> {
  const version = process.argv[2]
  const date = process.argv[3] ?? new Date().toISOString().slice(0, 10)
  if (!version) {
    console.error("usage: bun script/stamp-release-changelog.ts <version> [YYYY-MM-DD]")
    process.exit(2)
  }
  const changelogPath = new URL("../CHANGELOG.md", import.meta.url)
  const fragmentDir = new URL(`../${FRAGMENT_DIR}/`, import.meta.url)
  const names = await readdir(fragmentDir)
  // Every entry is validated (README.md allowed, <pr>.md required): a stray non-markdown name is
  // refused here instead of being silently skipped at release time.
  const contents = new Map<string, string>()
  for (const name of names) contents.set(name, await Bun.file(new URL(name, fragmentDir)).text())
  const fragments = readFragments(names, (name) => {
    const content = contents.get(name)
    if (content === undefined) throw new Error(`missing fragment file: ${name}`)
    return content
  })
  if (fragments.length === 0) throw new Error(`no changelog fragments under ${FRAGMENT_DIR}/ to release`)
  // Change-log blocks land in their logs (changes.md, packages/<name>/changes.md) in this commit; only each
  // fragment's preamble goes into CHANGELOG.md. Nothing compiles fragments before the release cut.
  const repoRoot = new URL("../", import.meta.url)
  const logReads = new Map<string, string | null>()
  for (const fragment of fragments) {
    for (const block of splitFragment(fragment.content).blocks) {
      const file = Bun.file(new URL(block.log, repoRoot))
      logReads.set(block.log, (await file.exists()) ? await file.text() : null)
    }
  }
  const compiled = compileBlocks(fragments, (path) => logReads.get(path) ?? null)
  const preambles = fragments
    .map((fragment) => ({ pr: fragment.pr, content: splitFragment(fragment.content).preamble }))
    .filter((fragment) => fragment.content !== "")
  if (preambles.length === 0) throw new Error(`no CHANGELOG paragraph in any fragment under ${FRAGMENT_DIR}/ to release`)
  const changelog = await Bun.file(changelogPath).text()
  // Unreleased text written before the fragments gate (#10841) is released first, exactly as written.
  const assembly = assembleRelease(unreleasedBody(changelog), preambles)
  if (assembly.duplicates.length > 0) {
    console.error(`consumed without a second entry (an Unreleased paragraph already links them): ${assembly.duplicates.map((pr) => `#${pr}`).join(", ")}`)
  }
  const stamped = stampUnreleased(mergeUnreleased(changelog, assembly.body), version, date)
  await Bun.write(changelogPath, stamped)
  for (const [path, content] of compiled.logs) await Bun.write(new URL(path, repoRoot), content)
  // Delete by the file name read from disk, not the reconstructed `<pr>.md`: a leading-zero alias
  // parses as the same PR but deletes nothing if reconstructed.
  for (const name of names) {
    if (parseFragment(name, contents.get(name) ?? "") !== null) await rm(new URL(name, fragmentDir))
  }
  console.error(`stamped ## [${version}] - ${date} from ${fragments.length} fragment(s): ${fragments.map((f) => `#${f.pr}`).join(", ")}`)
}

if (import.meta.main) await main()
