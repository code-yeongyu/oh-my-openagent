import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagDefinition } from "./graph"
import { createDagManager } from "./manager"
import { createDagSkillMaterializer, readDagSkillManifest } from "./skills"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunId } from "./types"

const cleanupRoots: string[] = []
const parentSessionId = "parent-session"
const rootSessionId = "root-session"
const runId = "run-skills" as DagRunId
const at = "2025-01-01T00:00:00.000Z"

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const directory = fs.mkdtempSync(join(tmpdir(), prefix))
  cleanupRoots.push(directory)
  return directory
}

function writeSkill(cwd: string, name: string, body: string): void {
  const directory = join(cwd, ".senpi", "skills", name)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(join(directory, "SKILL.md"), body, "utf8")
}

function skillPrompt(cwd: string, name: string, body: string, prompt: string): string {
  const skillPath = join(cwd, ".senpi", "skills", name, "SKILL.md")
  const skillDir = join(cwd, ".senpi", "skills", name)
  return [
    `<skill name="${name}" location="${skillPath}">`,
    `References are relative to ${skillDir}.`,
    "",
    body,
    "</skill>",
    "",
    prompt,
  ].join("\n")
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "run-key", name: "skills run", nodes }
}

function materializer(store: DagFileStore, cwd: string): ReturnType<typeof createDagSkillMaterializer> {
  // homeDir is pinned to an empty temp dir so the developer's real ~/.senpi never leaks in.
  return createDagSkillMaterializer({ store, cwd, homeDir: tempDir("senpi-dag-skills-home-") })
}

describe("createDagSkillMaterializer at run creation", () => {
  test("#given a node requesting a present skill #when materialized #then the skill block precedes the original prompt", () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    writeSkill(cwd, "programming", "programming skill body")
    const store = createDagFileStore({ project_dir: project })

    // when
    const result = materializer(store, cwd)({
      runId,
      definition: definition([{ id: "build", prompt: "ship the feature", category: "quick", load_skills: ["programming"] }]),
      at,
    })

    // then
    const effectivePrompt = result.nodes[0]?.effectivePrompt ?? ""
    expect(effectivePrompt).toBe(skillPrompt(cwd, "programming", "programming skill body", "ship the feature"))
    expect(effectivePrompt.indexOf("programming skill body")).toBeLessThan(effectivePrompt.indexOf("ship the feature"))
  })

  test("#given a resolved skill #when materialized #then the manifest records the requested names, the sha256 digest, and the pinned cwd", () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    const body = "git-master skill body\nwith two lines"
    writeSkill(cwd, "git-master", body)
    const store = createDagFileStore({ project_dir: project })

    // when
    materializer(store, cwd)({
      runId,
      definition: definition([{ id: "commit", prompt: "commit it", subagent_type: "explore", load_skills: ["git-master"] }]),
      at,
    })

    // then
    const manifest = readDagSkillManifest(store, runId)
    expect(manifest?.cwd).toBe(cwd)
    expect(manifest?.nodes[0]).toMatchObject({
      nodeId: "commit",
      requested: ["git-master"],
      resolved: [{ name: "git-master", sha256: sha256(body) }],
      missing: [],
      prompt: "commit it",
    })
  })

  test("#given a node requesting an absent skill #when materialized #then a missing_skill diagnostic is recorded and the prompt still dispatches", () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    writeSkill(cwd, "programming", "programming skill body")
    const store = createDagFileStore({ project_dir: project })

    // when
    const result = materializer(store, cwd)({
      runId,
      definition: definition([
        { id: "build", prompt: "ship the feature", category: "quick", load_skills: ["programming", "nonexistent"] },
      ]),
      at,
    })

    // then
    expect(result.diagnostics).toEqual([
      { kind: "missing_skill", nodeId: "build" as DagNodeId, skill: "nonexistent", message: 'Skill "nonexistent" was not found.', at },
    ])
    expect(result.nodes[0]?.effectivePrompt).toBe(skillPrompt(cwd, "programming", "programming skill body", "ship the feature"))
    expect(readDagSkillManifest(store, runId)?.nodes[0]?.missing).toEqual(["nonexistent"])
  })

  test("#given a materialized run #when SKILL.md is rewritten on disk #then the persisted effectivePrompt still carries the creation-time content", () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    writeSkill(cwd, "programming", "v1 skill body")
    const store = createDagFileStore({ project_dir: project })
    const materialize = materializer(store, cwd)
    materialize({
      runId,
      definition: definition([{ id: "build", prompt: "ship the feature", category: "quick", load_skills: ["programming"] }]),
      at,
    })

    // when
    writeSkill(cwd, "programming", "v2 skill body")

    // then
    const persisted = readDagSkillManifest(store, runId)?.nodes[0]
    expect(persisted?.effectivePrompt).toContain("v1 skill body")
    expect(persisted?.effectivePrompt).not.toContain("v2 skill body")
    expect(persisted?.resolved).toEqual([{ name: "programming", sha256: sha256("v1 skill body") }])
  })

  test("#given a node without load_skills #when materialized #then the effective prompt is the untouched original", () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    const store = createDagFileStore({ project_dir: project })

    // when
    const result = materializer(store, cwd)({
      runId,
      definition: definition([{ id: "plain", prompt: "no skills here", category: "quick" }]),
      at,
    })

    // then
    expect(result.nodes).toEqual([{ nodeId: "plain", effectivePrompt: "no skills here" }])
    expect(result.diagnostics).toEqual([])
  })
})

describe("createDagSkillMaterializer wired into DagManager.start", () => {
  test("#given a run created with a materializer #when the cwd loses the skill afterwards #then the persisted definition keeps the creation-time effectivePrompt", async () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    writeSkill(cwd, "programming", "v1 skill body")
    const store = createDagFileStore({ project_dir: project })
    const manager = createDagManager({
      store,
      materializeSkills: createDagSkillMaterializer({ store, cwd, homeDir: tempDir("senpi-dag-skills-home-") }),
    })
    const started = await manager.start({
      definition: definition([{ id: "build", prompt: "ship the feature", category: "quick", load_skills: ["programming"] }]),
      parentSessionId,
      rootSessionId,
    })

    // when
    fs.rmSync(join(cwd, ".senpi"), { recursive: true, force: true })

    // then
    const record = manager.record(started.snapshot.runId, parentSessionId)
    expect(record.definition.nodes[0]?.effectivePrompt).toBe(skillPrompt(cwd, "programming", "v1 skill body", "ship the feature"))
    expect(record.definition.nodes[0]?.prompt).toBe("ship the feature")
  })

  test("#given a missing skill #when the run is created #then the run exists with a missing_skill diagnostic and no failure", async () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    const store = createDagFileStore({ project_dir: project })
    const manager = createDagManager({
      store,
      materializeSkills: createDagSkillMaterializer({ store, cwd, homeDir: tempDir("senpi-dag-skills-home-") }),
    })

    // when
    const started = await manager.start({
      definition: definition([{ id: "build", prompt: "ship the feature", category: "quick", load_skills: ["nonexistent"] }]),
      parentSessionId,
      rootSessionId,
    })

    // then
    expect(started.snapshot.status).toBe("pending")
    expect(started.snapshot.diagnostics).toContainEqual({
      kind: "missing_skill",
      nodeId: "build" as DagNodeId,
      skill: "nonexistent",
      message: 'Skill "nonexistent" was not found.',
      at: expect.any(String),
    })
    expect(started.snapshot.nodes[0]?.state).toBe("pending")
  })

  test("#given a materialized run #when the same definition is submitted again #then the fingerprint ignores the skill content entirely", async () => {
    // given
    const project = tempDir("senpi-dag-skills-project-")
    const cwd = tempDir("senpi-dag-skills-cwd-")
    writeSkill(cwd, "programming", "v1 skill body")
    const store = createDagFileStore({ project_dir: project })
    const nodes = definition([
      { id: "build", prompt: "ship the feature", category: "quick", load_skills: ["programming"] },
    ])
    const withSkills = createDagManager({
      store,
      materializeSkills: createDagSkillMaterializer({ store, cwd, homeDir: tempDir("senpi-dag-skills-home-") }),
    })
    const bare = createDagManager({ store })
    const materialized = await withSkills.start({ definition: nodes, parentSessionId, rootSessionId })

    // when
    const plain = await bare.start({ definition: nodes, parentSessionId: "other-session", rootSessionId })

    // then
    expect(materialized.snapshot.definitionFingerprint).toBe(plain.snapshot.definitionFingerprint)
  })
})
