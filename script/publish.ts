#!/usr/bin/env bun

import { $ } from "bun"
import { existsSync } from "node:fs"
import { join } from "node:path"

const PACKAGE_NAME = "oh-my-opencode"
const bump = process.env.BUMP as "major" | "minor" | "patch" | undefined
const versionOverride = process.env.VERSION
const republishMode = process.env.REPUBLISH === "true"
const prepareOnly = process.argv.includes("--prepare-only")

const PLATFORM_PACKAGES = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
  "windows-x64",
]

console.log("=== Publishing oh-my-opencode (multi-package) ===\n")

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
  // Handle prerelease versions (e.g., 3.0.0-beta.7)
  const baseVersion = version.split("-")[0]
  const [major, minor, patch] = baseVersion.split(".").map(Number)
  switch (type) {
    case "major":
      return `${major + 1}.0.0`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "patch":
      return `${major}.${minor}.${patch + 1}`
  }
}

async function updatePackageVersion(pkgPath: string, newVersion: string): Promise<void> {
  let pkg = await Bun.file(pkgPath).text()
  pkg = pkg.replace(/"version": "[^"]+"/, `"version": "${newVersion}"`)
  await Bun.write(pkgPath, pkg)
  console.log(`Updated: ${pkgPath}`)
}

async function updateAllPackageVersions(newVersion: string): Promise<void> {
  console.log("\nSyncing version across all packages...")
  
  // Update main package.json
  const mainPkgPath = new URL("../package.json", import.meta.url).pathname
  await updatePackageVersion(mainPkgPath, newVersion)
  
  // Update optionalDependencies versions in main package.json
  let mainPkg = await Bun.file(mainPkgPath).text()
  for (const platform of PLATFORM_PACKAGES) {
    const pkgName = `oh-my-opencode-${platform}`
    mainPkg = mainPkg.replace(
      new RegExp(`"${pkgName}": "[^"]+"`),
      `"${pkgName}": "${newVersion}"`
    )
  }
  await Bun.write(mainPkgPath, mainPkg)
  
  // Update each platform package.json
  for (const platform of PLATFORM_PACKAGES) {
    const pkgPath = new URL(`../packages/${platform}/package.json`, import.meta.url).pathname
    if (existsSync(pkgPath)) {
      await updatePackageVersion(pkgPath, newVersion)
    } else {
      console.warn(`Warning: ${pkgPath} not found`)
    }
  }
}

async function findPreviousTag(currentVersion: string): Promise<string | null> {
  // For beta versions, find the previous beta tag (e.g., 3.0.0-beta.11 for 3.0.0-beta.12)
  const betaMatch = currentVersion.match(/^(\d+\.\d+\.\d+)-beta\.(\d+)$/)
  if (betaMatch) {
    const [, base, num] = betaMatch
    const prevNum = parseInt(num) - 1
    if (prevNum >= 1) {
      const prevTag = `${base}-beta.${prevNum}`
      const exists = await $`git rev-parse v${prevTag}`.nothrow()
      if (exists.exitCode === 0) return prevTag
    }
  }
  return null
}

async function generateChangelog(previous: string, currentVersion?: string): Promise<string[]> {
  const notes: string[] = []

  // Try to find the most accurate previous tag for comparison
  let compareTag = previous
  if (currentVersion) {
    const prevBetaTag = await findPreviousTag(currentVersion)
    if (prevBetaTag) {
      compareTag = prevBetaTag
      console.log(`Using previous beta tag for comparison: v${compareTag}`)
    }
  }

  try {
    const log = await $`git log v${compareTag}..HEAD --oneline --format="%h %s"`.text()
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

interface PublishResult {
  success: boolean
  alreadyPublished?: boolean
  error?: string
}

async function checkPackageVersionExists(pkgName: string, version: string): Promise<boolean> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkgName}/${version}`)
    return res.ok
  } catch {
    return false
  }
}

async function publishPackage(cwd: string, distTag: string | null, useProvenance = true, pkgName?: string, version?: string): Promise<PublishResult> {
  // In republish mode, skip if package already exists on npm
  if (republishMode && pkgName && version) {
    const exists = await checkPackageVersionExists(pkgName, version)
    if (exists) {
      return { success: true, alreadyPublished: true }
    }
    console.log(`    ${pkgName}@${version} not found on npm, publishing...`)
  }

  const tagArgs = distTag ? ["--tag", distTag] : []
  const provenanceArgs = process.env.CI && useProvenance ? ["--provenance"] : []
  const env = useProvenance ? {} : { NPM_CONFIG_PROVENANCE: "false" }
  
  try {
    await $`npm publish --access public --ignore-scripts ${provenanceArgs} ${tagArgs}`.cwd(cwd).env({ ...process.env, ...env })
    return { success: true }
  } catch (error: any) {
    const stderr = error?.stderr?.toString() || error?.message || ""
    
    // Only treat as "already published" if we're certain the package exists
    // E409/EPUBLISHCONFLICT = definitive "version already exists"
    if (
      stderr.includes("EPUBLISHCONFLICT") ||
      stderr.includes("E409") ||
      stderr.includes("cannot publish over") ||
      stderr.includes("You cannot publish over the previously published versions")
    ) {
      return { success: true, alreadyPublished: true }
    }
    
    // E403 can mean "already exists" OR "no permission" - verify by checking npm registry
    if (stderr.includes("E403")) {
      if (pkgName && version) {
        const exists = await checkPackageVersionExists(pkgName, version)
        if (exists) {
          return { success: true, alreadyPublished: true }
        }
      }
      // If we can't verify or it doesn't exist, it's a real error
      return { success: false, error: stderr }
    }
    
    // 404 errors are NEVER "already published" - they indicate the package doesn't exist
    // or OIDC token issues. Always treat as failure.
    return { success: false, error: stderr }
  }
}

async function publishAllPackages(version: string): Promise<void> {
  const distTag = getDistTag(version)
  const skipPlatform = process.env.SKIP_PLATFORM_PACKAGES === "true"
  
  if (skipPlatform) {
    console.log("\n⏭️  Skipping platform packages (SKIP_PLATFORM_PACKAGES=true)")
  } else {
    console.log("\n📦 Publishing platform packages in batches (to avoid OIDC token expiration)...")
    
    // Publish in batches of 2 to avoid OIDC token expiration
    // npm processes requests sequentially even when sent in parallel,
    // so too many parallel requests can cause token expiration
    const BATCH_SIZE = 2
    const failures: string[] = []
    
    for (let i = 0; i < PLATFORM_PACKAGES.length; i += BATCH_SIZE) {
      const batch = PLATFORM_PACKAGES.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(PLATFORM_PACKAGES.length / BATCH_SIZE)
      
      console.log(`\n  Batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`)
      
      const publishPromises = batch.map(async (platform) => {
        const pkgDir = join(process.cwd(), "packages", platform)
        const pkgName = `oh-my-opencode-${platform}`
        
        console.log(`    Starting ${pkgName}...`)
        const result = await publishPackage(pkgDir, distTag, false, pkgName, version)
        
        return { platform, pkgName, result }
      })
      
      const results = await Promise.all(publishPromises)
      
      for (const { pkgName, result } of results) {
        if (result.success) {
          if (result.alreadyPublished) {
            console.log(`    ✓ ${pkgName}@${version} (already published)`)
          } else {
            console.log(`    ✓ ${pkgName}@${version}`)
          }
        } else {
          console.error(`    ✗ ${pkgName} failed: ${result.error}`)
          failures.push(pkgName)
        }
      }
    }
    
    if (failures.length > 0) {
      throw new Error(`Failed to publish: ${failures.join(", ")}`)
    }
  }
  
  // Publish main package last
  console.log(`\n📦 Publishing main package...`)
  const mainResult = await publishPackage(process.cwd(), distTag, true, PACKAGE_NAME, version)
  
  if (mainResult.success) {
    if (mainResult.alreadyPublished) {
      console.log(`  ✓ ${PACKAGE_NAME}@${version} (already published)`)
    } else {
      console.log(`  ✓ ${PACKAGE_NAME}@${version}`)
    }
  } else {
    console.error(`  ✗ ${PACKAGE_NAME} failed: ${mainResult.error}`)
    throw new Error(`Failed to publish ${PACKAGE_NAME}`)
  }
}

async function buildPackages(): Promise<void> {
  const skipPlatform = process.env.SKIP_PLATFORM_PACKAGES === "true"
  
  console.log("\nBuilding packages...")
  await $`bun run clean && bun run build`
  
  if (skipPlatform) {
    console.log("⏭️  Skipping platform binaries (SKIP_PLATFORM_PACKAGES=true)")
  } else {
    console.log("Building platform binaries...")
    await $`bun run build:binaries`
  }
}

async function gitTagAndRelease(newVersion: string, notes: string[]): Promise<void> {
  if (!process.env.CI) return

  console.log("\nCommitting and tagging...")
  await $`git config user.email "github-actions[bot]@users.noreply.github.com"`
  await $`git config user.name "github-actions[bot]"`
  
  // Add all package.json files
  await $`git add package.json assets/oh-my-opencode.schema.json`
  for (const platform of PLATFORM_PACKAGES) {
    await $`git add packages/${platform}/package.json`.nothrow()
  }

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

  // Push tags first (critical for release), then try branch push (non-critical)
  console.log("Pushing tags...")
  await $`git push origin --tags`
  
  console.log("Pushing branch...")
  const branchPush = await $`git push origin HEAD`.nothrow()
  if (branchPush.exitCode !== 0) {
    console.log(`⚠️  Branch push failed (remote may have new commits). Tag was pushed successfully.`)
    console.log(`   To sync manually: git pull --rebase && git push`)
  }

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

  if (prepareOnly) {
    console.log("=== Prepare-only mode: updating versions ===")
    await updateAllPackageVersions(newVersion)
    console.log(`\n=== Versions updated to ${newVersion} ===`)
    return
  }

  if (await checkVersionExists(newVersion)) {
    if (republishMode) {
      console.log(`Version ${newVersion} exists on npm. REPUBLISH mode: checking for missing platform packages...`)
    } else {
      console.log(`Version ${newVersion} already exists on npm. Skipping publish.`)
      console.log(`(Use REPUBLISH=true to publish missing platform packages)`)
      process.exit(0)
    }
  }

  await updateAllPackageVersions(newVersion)
  const changelog = await generateChangelog(previous, newVersion)
  const contributors = await getContributors(previous)
  const notes = [...changelog, ...contributors]

  await buildPackages()
  await publishAllPackages(newVersion)
  await gitTagAndRelease(newVersion, notes)

  console.log(`\n=== Successfully published ${PACKAGE_NAME}@${newVersion} (8 packages) ===`)
}

main()
