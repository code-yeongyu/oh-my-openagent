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

async function generateChangelog(previous: string): Promise<string> {
  try {
    const log = await $`git log v${previous}..HEAD --oneline --format="%h %s"`.text()
    const commits = log
      .split("\n")
      .filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:|ci:|release:)/i))

    if (commits.length > 0) {
      const changelog = commits.map((c) => `- ${c}`).join("\n")
      console.log("\n--- Changelog ---")
      console.log(changelog)
      console.log("-----------------\n")
      return changelog
    }
  } catch {
    console.log("No previous tags found, skipping changelog generation")
  }
  return ""
}

async function buildAndPublish(): Promise<void> {
  console.log("\nPublishing to npm...")
  // --ignore-scripts: workflow에서 이미 빌드 완료, prepublishOnly 재실행 방지
  if (process.env.CI) {
    await $`npm publish --access public --provenance --ignore-scripts`
  } else {
    await $`npm publish --access public --ignore-scripts`
  }
}

async function gitTagAndRelease(newVersion: string, changelog: string): Promise<void> {
  if (!process.env.CI) return

  console.log("\nCommitting and tagging...")
  await $`git config user.email "github-actions[bot]@users.noreply.github.com"`
  await $`git config user.name "github-actions[bot]"`
  await $`git add package.json`

  // Commit only if there are staged changes (idempotent)
  const hasStagedChanges = await $`git diff --cached --quiet`.nothrow()
  if (hasStagedChanges.exitCode !== 0) {
    await $`git commit -m "release: v${newVersion}"`
  } else {
    console.log("No changes to commit (version already updated)")
  }

  // Tag only if it doesn't exist (idempotent)
  const tagExists = await $`git rev-parse v${newVersion}`.nothrow()
  if (tagExists.exitCode !== 0) {
    await $`git tag v${newVersion}`
  } else {
    console.log(`Tag v${newVersion} already exists`)
  }

  // Push (idempotent - git push is already idempotent)
  await $`git push origin HEAD --tags`

  // Create release only if it doesn't exist (idempotent)
  console.log("\nCreating GitHub release...")
  const releaseNotes = changelog || "No notable changes"
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
  await buildAndPublish()
  await gitTagAndRelease(newVersion, changelog)

  console.log(`\n=== Successfully published ${PACKAGE_NAME}@${newVersion} ===`)
}

main()
