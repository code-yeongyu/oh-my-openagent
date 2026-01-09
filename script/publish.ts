#!/usr/bin/env bun

import { $ } from "bun"

const PACKAGE_NAME = "oh-my-opencode"
const bump = process.env.BUMP as "major" | "minor" | "patch" | undefined
const versionOverride = process.env.VERSION

console.log("=== Publishing oh-my-opencode ===\n")

async function fetchPreviousVersion(): Promise<string> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`)
    if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`)
    const data = (await res.json()) as { version: string }
    console.log(`Previous version: ${data.version}`)
    return data.version
  } catch {
    console.log("No previous version found, starting from 0.0.0")
    return "0.0.0"
  }
}

function bumpVersion(version: string, type: "major" | "minor" | "patch"): string {
  const [major, minor, patch] = version.split(".").map(Number)
  switch (type) {
    case "major":
      return `${major + 1}.0.0`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "patch":
      return `${major}.${minor}.${patch + 1}`
  }
}

async function updatePackageVersion(newVersion: string): Promise<void> {
  const pkgPath = new URL("../package.json", import.meta.url).pathname
  let pkg = await Bun.file(pkgPath).text()
  pkg = pkg.replace(/"version": "[^"]+"/, `"version": "${newVersion}"`)
  await Bun.file(pkgPath).write(pkg)
  console.log(`Updated: ${pkgPath}`)
}

async function generateChangelog(previous: string): Promise<string[]> {
  const notes: string[] = []

  try {
    const log = await $`git log v${previous}..HEAD --oneline --format="%h %s"`.text()
    const commits = log
      .split("\n")
      .filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:|ci:|release:)/i))

    if (commits.length > 0) {
      for (const commit of commits) {
        notes.push(`- ${commit}`)
      }
      console.log("\n--- Changelog ---")
      console.log(notes.join("\n"))
      console.log("-----------------\n")
    }
  } catch {
    console.log("No previous tags found, skipping changelog generation")
  }

  return notes
}

async function getContributors(previous: string): Promise<string[]> {
  const notes: string[] = []

  const team = ["actions-user", "github-actions[bot]", "code-yeongyu"]

  try {
    const compare =
      await $`gh api "/repos/code-yeongyu/oh-my-opencode/compare/v${previous}...HEAD" --jq '.commits[] | {login: .author.login, message: .commit.message}'`.text()
    const contributors = new Map<string, string[]>()

    for (const line of compare.split("\n").filter(Boolean)) {
      const { login, message } = JSON.parse(line) as { login: string | null; message: string }
      const title = message.split("\n")[0] ?? ""
      if (title.match(/^(ignore:|test:|chore:|ci:|release:)/i)) continue

      if (login && !team.includes(login)) {
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
      console.log("\n--- Contributors ---")
      console.log(notes.join("\n"))
      console.log("--------------------\n")
    }
  } catch (error) {
    console.log("Failed to fetch contributors:", error)
  }

  return notes
}

function getDistTag(version: string): string | null {
  if (!version.includes("-")) return null
  const prerelease = version.split("-")[1]
  const tag = prerelease?.split(".")[0]
  return tag || "next"
}

async function buildAndPublish(version: string): Promise<void> {
  console.log("\nPublishing to npm...")
  const distTag = getDistTag(version)
  const tagArgs = distTag ? ["--tag", distTag] : []
  
  if (process.env.CI) {
    await $`npm publish --access public --provenance --ignore-scripts ${tagArgs}`
  } else {
    await $`npm publish --access public --ignore-scripts ${tagArgs}`
  }
}

async function gitTagAndRelease(newVersion: string, notes: string[]): Promise<void> {
  if (!process.env.CI) return

  console.log("\nCommitting and tagging...")
  await $`git config user.email "github-actions[bot]@users.noreply.github.com"`
  await $`git config user.name "github-actions[bot]"`
  await $`git add package.json assets/oh-my-opencode.schema.json`

  const hasStagedChanges = await $`git diff --cached --quiet`.nothrow()
  if (hasStagedChanges.exitCode !== 0) {
    await $`git commit -m "release: v${newVersion}"`
  } else {
    console.log("No changes to commit (version already updated)")
  }

  const tagExists = await $`git rev-parse v${newVersion}`.nothrow()
  if (tagExists.exitCode !== 0) {
    await $`git tag v${newVersion}`
  } else {
    console.log(`Tag v${newVersion} already exists`)
  }

  await $`git push origin HEAD --tags`

  console.log("\nCreating GitHub release...")
  const releaseNotes = notes.length > 0 ? notes.join("\n") : "No notable changes"
  const releaseExists = await $`gh release view v${newVersion}`.nothrow()
  if (releaseExists.exitCode !== 0) {
    await $`gh release create v${newVersion} --title "v${newVersion}" --notes ${releaseNotes}`
  } else {
    console.log(`Release v${newVersion} already exists`)
  }
}

async function checkVersionExists(version: string): Promise<boolean> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/${version}`)
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  const previous = await fetchPreviousVersion()
  const newVersion = versionOverride || (bump ? bumpVersion(previous, bump) : bumpVersion(previous, "patch"))
  console.log(`New version: ${newVersion}\n`)

  if (await checkVersionExists(newVersion)) {
    console.log(`Version ${newVersion} already exists on npm. Skipping publish.`)
    process.exit(0)
  }

  await updatePackageVersion(newVersion)
  const changelog = await generateChangelog(previous)
  const contributors = await getContributors(previous)
  const notes = [...changelog, ...contributors]

  await buildAndPublish(newVersion)
  await gitTagAndRelease(newVersion, notes)

  console.log(`\n=== Successfully published ${PACKAGE_NAME}@${newVersion} ===`)
}

main()
