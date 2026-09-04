import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, test } from "node:test"

import { checkXSearchSkillStaged, stageXSearchSkill } from "./stage-x-search-skill.mjs"

const tempDirs = []
const STAGING_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-senpi-x-search-skill-stage-test-"))
  tempDirs.push(root)
  const sourceSkill = join(root, "source", "skill", "SKILL.md")
  const targetSkill = join(root, "plugin", "skills-conditional", "x-search", "SKILL.md")
  await mkdir(dirname(sourceSkill), { recursive: true })
  await writeFile(sourceSkill, "---\nname: x-search\ndescription: source copy\n---\nBODY\n", "utf8")
  return { sourceSkill, targetSkill }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("x-search conditional skill staging", () => {
  test("#given no staged copy #when --check runs #then it skips with a notice for a fresh checkout", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()

    const result = await checkXSearchSkillStaged(fixture)

    assert.deepEqual(result, {
      ok: true,
      skipped: true,
      reason: "not staged locally",
      sourceSkill: fixture.sourceSkill,
      targetSkill: fixture.targetSkill,
    })
  })

  test("#given a staged copy #when --check runs #then it passes and the bytes match the source", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()

    const staged = await stageXSearchSkill(fixture)
    const result = await checkXSearchSkillStaged(fixture)

    assert.equal(staged.ok, true)
    assert.equal(staged.targetSkill, fixture.targetSkill)
    assert.equal(result.ok, true)
    assert.equal(await readFile(fixture.targetSkill, "utf8"), await readFile(fixture.sourceSkill, "utf8"))
  })

  test("#given a stale staged copy #when --check runs #then it fails as stale", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await stageXSearchSkill(fixture)
    await writeFile(fixture.targetSkill, "---\nname: x-search\ndescription: stale copy\n---\nOLD BODY\n", "utf8")

    await assert.rejects(checkXSearchSkillStaged(fixture), /stale/)
  })

  test("#given a missing source skill #when staged #then it fails loudly instead of writing a partial copy", { timeout: STAGING_TEST_TIMEOUT_MS }, async () => {
    const fixture = await makeFixture()
    await rm(fixture.sourceSkill)

    await assert.rejects(stageXSearchSkill(fixture), /source SKILL\.md is missing/)
  })
})
