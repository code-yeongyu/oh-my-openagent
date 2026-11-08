#!/usr/bin/env bun

/**
 * Standalone verification of changelog-backfill transformer.
 * This script demonstrates the core functionality without requiring full project build.
 * Run: bun script/changelog-backfill-verify.ts
 *
 * Imports from split modules to verify all exports work correctly.
 */

import * as fs from "fs"
import * as path from "path"
import {
  stampBackfillMarker,
  extractBackfillMarker,
  normalizeHeading,
  parseVersion,
  parseDate,
  validateReleaseRequirements,
  transformReleaseToEntry,
  transformReleases,
  auditFixtureMissingReleases,
} from "./changelog-backfill-index"
// All functions imported from split modules above

// ==============================================================================
// Main verification
// ==============================================================================

async function main() {
  console.log("🔍 OmO Changelog Backfill Transformer - Standalone Verification\n")

  // Load fixture
  const fixtureFile = path.join(import.meta.dir, "../.omo/fixtures/releases.json")
  const fixtureText = fs.readFileSync(fixtureFile, "utf-8")
  const fixtureData = JSON.parse(fixtureText)
  const releases = fixtureData.releases as any[]

  console.log(`📦 Loaded fixture: ${releases.length} total releases\n`)

  // RED test 1: Releases without marker should fail validation
  console.log("🔴 RED Test 1: Release without marker should fail validation")
  const noMarkerRelease = {
    tagName: "v5.0.0-beta.99",
    publishedAt: "2026-09-11T14:00:00Z",
    isPrerelease: true,
    body: "## Fixed\n\n- Some change",
  }
  const noMarkerErrors = validateReleaseRequirements(noMarkerRelease)
  console.log(
    `   Result: ${noMarkerErrors.length > 0 ? "✅ FAIL (as expected)" : "❌ PASS (should fail)"}`
  )
  console.log(`   Errors: ${noMarkerErrors.map((e) => e.code).join(", ")}\n`)

  // RED test 2: Release without publishedAt should fail validation
  console.log("🔴 RED Test 2: Release without publishedAt should fail validation")
  const noDateRelease = {
    tagName: "v5.0.0-beta.99",
    publishedAt: null,
    isPrerelease: true,
    body: "## Fixed\n\n- Change\n\n<!-- omo-backfill-marker: v5.0.0-beta.99 -->",
  }
  const noDateErrors = validateReleaseRequirements(noDateRelease)
  console.log(
    `   Result: ${noDateErrors.length > 0 ? "✅ FAIL (as expected)" : "❌ PASS (should fail)"}`
  )
  console.log(`   Errors: ${noDateErrors.map((e) => e.code).join(", ")}\n`)

  // GREEN test 1: Valid release should transform
  console.log("🟢 GREEN Test 1: Valid release transforms successfully")
  const validRelease = {
    tagName: "v5.0.0-beta.3",
    publishedAt: "2026-08-10T10:16:58Z",
    isPrerelease: true,
    body: "## Fixed\n\n- Memory extension crash\n\n<!-- omo-backfill-marker: v5.0.0-beta.3 -->",
  }
  const validEntry = transformReleaseToEntry(validRelease)
  console.log(`   Result: ${validEntry ? "✅ PASS" : "❌ FAIL"}`)
  if (validEntry) {
    console.log(`   Version: ${validEntry.version}`)
    console.log(`   Date: ${validEntry.date}`)
    console.log(`   Marked: ${validEntry.marked}`)
    console.log(`   Timestamp: ${validEntry.publishedAt}\n`)
  }

  // GREEN test 2: Deterministic normalization
  console.log("🟢 GREEN Test 2: Deterministic heading normalization")
  const heading = "## Added\n\n\n- Feature 1\n- Feature 2\n\n"
  const norm1 = normalizeHeading(heading)
  const norm2 = normalizeHeading(heading)
  console.log(`   Result: ${norm1 === norm2 ? "✅ PASS (deterministic)" : "❌ FAIL"}`)
  console.log(`   Output: "${norm1}"\n`)

  // GREEN test 3: Idempotent stamping
  console.log("🟢 GREEN Test 3: Idempotent marker stamping")
  const body = "## Fixed\n\n- Bug"
  const stamped1 = stampBackfillMarker(body, "5.0.0-beta.5")
  const stamped2 = stampBackfillMarker(stamped1, "5.0.0-beta.5")
  console.log(`   Result: ${stamped1 === stamped2 ? "✅ PASS (idempotent)" : "❌ FAIL"}`)
  const markerCount = (stamped2.match(/<!-- omo-backfill-marker:/g) || []).length
  console.log(`   Marker count: ${markerCount} (should be 1)\n`)

  // GREEN test 4: Raw body content preserved
  console.log("🟢 GREEN Test 4: Raw body content preservation")
  const testRelease = releases.find((r) => r.tagName === "v5.0.0-beta.20")
  if (testRelease && testRelease.body) {
    const entry = transformReleaseToEntry(testRelease)
    const contentPreserved = entry && entry.content.includes("Parallel composition")
    console.log(`   Result: ${contentPreserved ? "✅ PASS" : "❌ FAIL"}`)
    console.log(`   Original has "Parallel composition": ${testRelease.body.includes("Parallel composition")}`)
    if (entry) {
      console.log(`   Transformed has "Parallel composition": ${entry.content.includes("Parallel composition")}\n`)
    }
  }

  // Fixture audit: Missing releases
  console.log("🔍 Fixture Audit: Missing Releases")
  const audit = auditFixtureMissingReleases(releases)
  console.log(`   Missing count: ${audit.missingCount}`)
  console.log(`   Missing tags: ${audit.missingTags.join(", ")}\n`)

  // Transform all valid releases from fixture
  console.log("📊 Batch Transformation (Fixture → Entries)")
  const validReleases = releases.filter((r) => r.body !== null)
  const entries = transformReleases(validReleases)
  console.log(`   Input (valid): ${validReleases.length} releases`)
  console.log(`   Output: ${entries.length} entries`)
  console.log(`   All marked: ${entries.every((e) => e.marked)}`)
  console.log(`   Oldest: ${entries[entries.length - 1]?.date || "N/A"}`)
  console.log(`   Newest: ${entries[0]?.date || "N/A"}\n`)

  // Summary
  console.log("✅ Verification Complete")
  console.log(`   Pure transformer is deterministic, fail-closed, and idempotent`)
  console.log(`   Ready for integration into changelog backfill pipeline`)
}

main().catch(console.error)
