#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = dirname(scriptDir)
const packageRoot = dirname(pluginRoot)
const defaultSourceSkill = join(packageRoot, "src", "components", "x-search", "skill", "SKILL.md")
// Deliberately NOT plugin/skills: pi.skills = ["./skills"] loads that dir eagerly, and the
// x-search skill must stay credential-gated (contributed at runtime via resources_discover).
const defaultTargetSkill = join(pluginRoot, "skills-conditional", "x-search", "SKILL.md")

export async function stageXSearchSkill(options = {}) {
  const sourceSkill = resolve(options.sourceSkill ?? defaultSourceSkill)
  const targetSkill = resolve(options.targetSkill ?? defaultTargetSkill)
  await validateSource(sourceSkill)

  const targetDir = dirname(targetSkill)
  await mkdir(targetDir, { recursive: true })
  const tempSkill = `${targetSkill}.tmp-${process.pid}-${Date.now()}`
  try {
    await copyFile(sourceSkill, tempSkill)
    await rename(tempSkill, targetSkill)
  } finally {
    await rm(tempSkill, { force: true })
  }
  return { ok: true, sourceSkill, targetSkill }
}

export async function checkXSearchSkillStaged(options = {}) {
  const sourceSkill = resolve(options.sourceSkill ?? defaultSourceSkill)
  const targetSkill = resolve(options.targetSkill ?? defaultTargetSkill)
  await validateSource(sourceSkill)

  let targetStat
  try {
    targetStat = await stat(targetSkill)
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return { ok: true, skipped: true, reason: "not staged locally", sourceSkill, targetSkill }
    }
    throw error
  }
  if (!targetStat.isFile()) {
    throw new Error(`x-search conditional skill stale: staged SKILL.md is not a file: ${targetSkill}`)
  }

  const [sourceBody, stagedBody] = await Promise.all([
    readFile(sourceSkill, "utf8"),
    readFile(targetSkill, "utf8"),
  ])
  if (sourceBody !== stagedBody) {
    throw new Error(`x-search conditional skill stale: staged SKILL.md does not match the source: ${targetSkill}`)
  }
  return { ok: true, sourceSkill, targetSkill }
}

async function validateSource(sourceSkill) {
  let sourceStat
  try {
    sourceStat = await stat(sourceSkill)
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new Error(`x-search source SKILL.md is missing: ${sourceSkill}`)
    }
    throw error
  }
  if (!sourceStat.isFile()) throw new Error(`x-search source SKILL.md is not a file: ${sourceSkill}`)
}

function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--check")) {
      const result = await checkXSearchSkillStaged()
      if (result.skipped) {
        console.log(`x-search conditional skill not staged locally; skipping freshness check: ${result.targetSkill}`)
      } else {
        console.log(`x-search conditional skill is current: ${result.targetSkill}`)
      }
    } else {
      const result = await stageXSearchSkill()
      console.log(`Staged x-search conditional skill: ${result.targetSkill}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
