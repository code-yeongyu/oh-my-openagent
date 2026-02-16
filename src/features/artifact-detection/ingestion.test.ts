import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { resetMcbAvailability } from "../mcb-integration"
import { ingestArtifacts } from "./ingestion"
import type { DetectedArtifact } from "./types"

function makeArtifact(overrides: Partial<DetectedArtifact> = {}): DetectedArtifact {
  return {
    class: "sisyphus-plan",
    path: "/tmp/test/plan.md",
    relativePath: "plan.md",
    contentHash: "abcdef1234567890",
    detectedAt: Date.now(),
    sizeBytes: 100,
    ...overrides,
  }
}

describe("artifact-detection/ingestion", () => {
  const TEST_DIR = join(tmpdir(), "artifact-ingestion-test-" + Date.now())

  beforeEach(() => {
    resetMcbAvailability()
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(join(TEST_DIR, ".sisyphus"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  //#given new artifacts with no prior ingestion
  //#when ingestArtifacts is called without storeOperation
  //#then all artifacts are ingested and hashes are persisted
  it("ingests new artifacts and persists hashes", async () => {
    const artifacts = [
      makeArtifact({ contentHash: "hash_a_1234567890" }),
      makeArtifact({ contentHash: "hash_b_1234567890", relativePath: "plan2.md" }),
    ]

    const result = await ingestArtifacts(artifacts, TEST_DIR, "test-collection")
    expect(result.ingested).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)

    const hashFile = join(TEST_DIR, ".sisyphus", ".ingested-hashes.json")
    expect(existsSync(hashFile)).toBe(true)
    const records = JSON.parse(readFileSync(hashFile, "utf-8"))
    expect(records).toHaveLength(2)
  })

  //#given artifacts already ingested
  //#when ingestArtifacts is called with same hashes
  //#then duplicates are skipped
  it("skips already-ingested artifacts", async () => {
    const artifacts = [makeArtifact({ contentHash: "already_ingested1" })]

    await ingestArtifacts(artifacts, TEST_DIR, "test-collection")
    const result = await ingestArtifacts(artifacts, TEST_DIR, "test-collection")

    expect(result.ingested).toBe(0)
    expect(result.skipped).toBe(1)
  })

  //#given artifacts with a storeOperation that succeeds
  //#when ingestArtifacts is called
  //#then it calls storeOperation for each new artifact
  it("calls storeOperation for each new artifact", async () => {
    const stored: DetectedArtifact[] = []
    const storeOp = async (artifact: DetectedArtifact) => {
      stored.push(artifact)
    }

    const artifacts = [
      makeArtifact({ contentHash: "store_test_00001" }),
      makeArtifact({ contentHash: "store_test_00002", relativePath: "plan2.md" }),
    ]

    const result = await ingestArtifacts(artifacts, TEST_DIR, "test-collection", storeOp)
    expect(result.ingested).toBe(2)
    expect(stored).toHaveLength(2)
  })

  //#given a storeOperation that throws
  //#when ingestArtifacts is called
  //#then the failed artifact is recorded with error details
  it("records store operation failure", async () => {
    const storeOp = async (_artifact: DetectedArtifact) => {
      throw new Error("connection timeout")
    }

    const artifacts = [makeArtifact({ contentHash: "fail_test_00001" })]

    const result = await ingestArtifacts(artifacts, TEST_DIR, "test-collection", storeOp)
    expect(result.failed).toBe(1)
    expect(result.ingested).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("connection timeout")
  })

  //#given a mix of new and previously-ingested artifacts
  //#when ingestArtifacts is called
  //#then only new ones are processed
  it("only processes new artifacts in a mixed batch", async () => {
    const existing = [makeArtifact({ contentHash: "existing_hash_01" })]
    await ingestArtifacts(existing, TEST_DIR, "test-collection")

    const mixed = [
      makeArtifact({ contentHash: "existing_hash_01" }),
      makeArtifact({ contentHash: "brand_new_hash_01", relativePath: "new.md" }),
    ]

    const result = await ingestArtifacts(mixed, TEST_DIR, "test-collection")
    expect(result.skipped).toBe(1)
    expect(result.ingested).toBe(1)
  })
})
