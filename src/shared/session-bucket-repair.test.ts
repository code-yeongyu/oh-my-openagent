import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { repairMisbucketedSessionMetadata } from "./session-bucket-repair"

interface SessionMetaInput {
  id: string
  directory: string
  projectID: string
  parentID?: string
  title?: string
}

async function writeSessionMeta(
  sessionRoot: string,
  bucket: string,
  meta: SessionMetaInput,
): Promise<void> {
  const bucketDir = join(sessionRoot, bucket)
  await mkdir(bucketDir, { recursive: true })
  await writeFile(
    join(bucketDir, `${meta.id}.json`),
    `${JSON.stringify(
      {
        id: meta.id,
        slug: "test",
        version: "0.0.0-test",
        directory: meta.directory,
        projectID: meta.projectID,
        ...(meta.parentID ? { parentID: meta.parentID } : {}),
        title: meta.title ?? "test",
        time: {
          created: 1,
          updated: 1,
        },
      },
      null,
      2,
    )}\n`,
  )
}

describe("session-bucket-repair", () => {
  let tempDir: string
  let sessionRoot: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "omo-session-repair-"))
    sessionRoot = join(tempDir, "session")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test("repairs mis-bucketed child session using parent bucket", async () => {
    const parentID = "ses_parent"
    const childID = "ses_child"
    const projectBucket = "proj_abc123"

    await writeSessionMeta(sessionRoot, projectBucket, {
      id: parentID,
      directory: "C:\\github\\OpenViking",
      projectID: projectBucket,
      title: "parent",
    })

    await writeSessionMeta(sessionRoot, "global", {
      id: childID,
      directory: "C:\\github\\OpenViking",
      projectID: "global",
      parentID,
      title: "child",
    })

    const result = await repairMisbucketedSessionMetadata({
      directory: "C:/github/OpenViking",
      sessionID: childID,
      storageRoot: sessionRoot,
    })

    expect(result.repaired).toBe(1)
    expect(result.scanned).toBe(1)

    const repairedPath = join(sessionRoot, projectBucket, `${childID}.json`)
    expect(existsSync(repairedPath)).toBe(true)

    const repairedMeta = JSON.parse(await readFile(repairedPath, "utf-8")) as {
      projectID: string
      parentID?: string
    }

    expect(repairedMeta.projectID).toBe(projectBucket)
    expect(repairedMeta.parentID).toBe(parentID)
  })

  test("does not repair when parent bucket cannot be resolved", async () => {
    const result = await repairMisbucketedSessionMetadata({
      directory: "C:/github/OpenViking",
      sessionID: "ses_missing_parent",
      storageRoot: sessionRoot,
    })

    expect(result.repaired).toBe(0)
    expect(result.scanned).toBe(0)
  })

  test("repairs mis-bucketed main session from global using projectID when parentID is missing", async () => {
    const mainID = "ses_main_global"
    const projectBucket = "proj_main_bucket"

    await writeSessionMeta(sessionRoot, "global", {
      id: mainID,
      directory: "C:\\github\\OpenViking",
      projectID: projectBucket,
      title: "main-session",
    })

    const result = await repairMisbucketedSessionMetadata({
      directory: "C:/github/OpenViking",
      sessionID: mainID,
      storageRoot: sessionRoot,
    })

    expect(result.repaired).toBe(1)
    expect(result.scanned).toBe(1)

    const repairedPath = join(sessionRoot, projectBucket, `${mainID}.json`)
    expect(existsSync(repairedPath)).toBe(true)

    const repairedMeta = JSON.parse(await readFile(repairedPath, "utf-8")) as {
      projectID: string
      parentID?: string
    }

    expect(repairedMeta.projectID).toBe(projectBucket)
    expect(repairedMeta.parentID).toBeUndefined()
  })

  test("does not overwrite existing target metadata", async () => {
    const parentID = "ses_parent"
    const childID = "ses_child"
    const projectBucket = "proj_existing"

    await writeSessionMeta(sessionRoot, projectBucket, {
      id: parentID,
      directory: "C:\\github\\OpenViking",
      projectID: projectBucket,
    })

    await writeSessionMeta(sessionRoot, projectBucket, {
      id: childID,
      directory: "C:\\github\\OpenViking",
      projectID: projectBucket,
      parentID,
      title: "already-correct",
    })

    await writeSessionMeta(sessionRoot, "global", {
      id: childID,
      directory: "C:\\github\\OpenViking",
      projectID: "global",
      parentID,
      title: "stale-global-copy",
    })

    const before = await readFile(join(sessionRoot, projectBucket, `${childID}.json`), "utf-8")

    const result = await repairMisbucketedSessionMetadata({
      directory: "C:/github/OpenViking",
      sessionID: childID,
      storageRoot: sessionRoot,
    })

    const after = await readFile(join(sessionRoot, projectBucket, `${childID}.json`), "utf-8")

    expect(result.repaired).toBe(0)
    expect(after).toBe(before)
  })

  test("repairs all matching global child sessions in sweep mode", async () => {
    const parentID = "ses_parent"
    const projectBucket = "proj_sweep"

    await writeSessionMeta(sessionRoot, projectBucket, {
      id: parentID,
      directory: "C:\\github\\OpenViking",
      projectID: projectBucket,
    })

    await writeSessionMeta(sessionRoot, "global", {
      id: "ses_child_1",
      directory: "C:\\github\\OpenViking",
      projectID: "global",
      parentID,
    })

    await writeSessionMeta(sessionRoot, "global", {
      id: "ses_child_2",
      directory: "C:\\github\\OpenViking",
      projectID: "global",
      parentID,
    })

    await writeSessionMeta(sessionRoot, "global", {
      id: "ses_other_project",
      directory: "C:\\github\\AnotherRepo",
      projectID: "global",
      parentID,
    })

    const result = await repairMisbucketedSessionMetadata({
      directory: "C:/github/OpenViking",
      storageRoot: sessionRoot,
    })

    expect(result.repaired).toBe(2)
    expect(existsSync(join(sessionRoot, projectBucket, "ses_child_1.json"))).toBe(true)
    expect(existsSync(join(sessionRoot, projectBucket, "ses_child_2.json"))).toBe(true)
    expect(existsSync(join(sessionRoot, projectBucket, "ses_other_project.json"))).toBe(false)
  })
})
