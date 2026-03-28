#!/usr/bin/env bun

import { $ } from "bun"

const TEAM = ["actions-user", "github-actions[bot]", "code-yeongyu"]

async function getLatestReleasedTag(): Promise<string | null> {
  try {
    const tag = await $`gh release list --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName // empty'`.text()
    return tag.trim() || null
  } catch {
    return null
  }
}

async function generateChangelog(previousTag: string): Promise<string[]> {
  const notes: string[] = []

  try {
    const log = await $`git log ${previousTag}..HEAD --oneline --format="%h %s"`.text()
    const commits = log
      .split("\n")
      .filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:|ci:|release:)/i))

    if (commits.length > 0) {
      for (const commit of commits) {
        notes.push(`- ${commit}`)
      }
    }
  } catch {
    // No previous tags found
  }

  return notes
}

async function getChangedFiles(previousTag: string): Promise<string[]> {
  try {
    const diff = await $`git diff --name-only ${previousTag}..HEAD`.text()
    return diff
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function touchesAnyPath(files: string[], candidates: string[]): boolean {
  return files.some((file) => candidates.some((candidate) => file === candidate || file.startsWith(`${candidate}/`)))
}

function buildReleaseFraming(files: string[]): string[] {
  const bullets: string[] = []

  if (
    touchesAnyPath(files, [
      "src/index.ts",
      "src/plugin-config.ts",
      "bin/platform.js",
      "postinstall.mjs",
      "docs",
    ])
  ) {
    bullets.push("Rename transition updates across package detection, plugin/config compatibility, and install surfaces.")
  }

  if (touchesAnyPath(files, ["src/tools/delegate-task", "src/plugin/tool-registry.ts"])) {
    bullets.push("Task and tool behavior updates, including delegate-task contract and runtime registration behavior.")
  }

  if (
    touchesAnyPath(files, [
      "src/plugin/tool-registry.ts",
      "src/plugin-handlers/agent-config-handler.ts",
      "src/plugin-handlers/tool-config-handler.ts",
      "src/hooks/tasks-todowrite-disabler",
    ])
  ) {
    bullets.push("Task-system default behavior alignment so omitted configuration behaves consistently across runtime paths.")
  }

  if (touchesAnyPath(files, [".github/workflows", "docs/guide/installation.md", "postinstall.mjs"])) {
    bullets.push("Install and publish workflow hardening, including safer release sequencing and package/install fixes.")
  }

  if (bullets.length === 0) {
    return []
  }

  return [
    "## Minor Compatibility and Stability Release",
    "",
    "This release carries compatibility-facing behavior changes and operational hardening. Read the summary below before upgrading or publishing.",
    "",
    ...bullets.map((bullet) => `- ${bullet}`),
    "",
    "## Commit Summary",
    "",
  ]
}

async function getContributors(previousTag: string): Promise<string[]> {
  const notes: string[] = []

  try {
    const compare =
      await $`gh api "/repos/code-yeongyu/oh-my-openagent/compare/${previousTag}...HEAD" --jq '.commits[] | {login: .author.login, message: .commit.message}'`.text()
    const contributors = new Map<string, string[]>()

    for (const line of compare.split("\n").filter(Boolean)) {
      const { login, message } = JSON.parse(line) as { login: string | null; message: string }
      const title = message.split("\n")[0] ?? ""
      if (title.match(/^(ignore:|test:|chore:|ci:|release:)/i)) continue

      if (login && !TEAM.includes(login)) {
        if (!contributors.has(login)) contributors.set(login, [])
        contributors.get(login)?.push(title)
      }
    }

    if (contributors.size > 0) {
      notes.push("")
      notes.push(`**Thank you to ${contributors.size} community contributor${contributors.size > 1 ? "s" : ""}:**`)
      for (const [username, userCommits] of contributors) {
        notes.push(`- @${username}:`)
        for (const commit of userCommits) {
          notes.push(`  - ${commit}`)
        }
      }
    }
  } catch {
    // Failed to fetch contributors
  }

  return notes
}

async function main() {
  const previousTag = await getLatestReleasedTag()

  if (!previousTag) {
    console.log("Initial release")
    process.exit(0)
  }

  const changedFiles = await getChangedFiles(previousTag)
  const changelog = await generateChangelog(previousTag)
  const contributors = await getContributors(previousTag)
  const framing = buildReleaseFraming(changedFiles)
  const notes = [...framing, ...changelog, ...contributors]

  if (notes.length === 0) {
    console.log("No notable changes")
  } else {
    console.log(notes.join("\n"))
  }
}

main()
