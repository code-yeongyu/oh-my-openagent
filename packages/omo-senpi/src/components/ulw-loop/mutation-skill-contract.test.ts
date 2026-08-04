import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "bun:test"

const packageRoot = join(import.meta.dir, "../../..")
const sourceSkillPath = join(packageRoot, "skills/ulw-mutation-test/SKILL.md")
const stagedSkillPath = join(packageRoot, "plugin/skills/ulw-mutation-test/SKILL.md")
const loopSkillPath = join(packageRoot, "skills/ulw-loop/SKILL.md")
const loopWorkflowPath = join(packageRoot, "skills/ulw-loop/references/full-workflow.md")
const syncScriptPath = join(packageRoot, "plugin/scripts/sync-skills.mjs")

function readRequired(path: string): string {
  expect(existsSync(path), `expected ${path} to exist`).toBe(true)
  return readFileSync(path, "utf8")
}

function frontmatterField(markdown: string, field: string): string | undefined {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1]
  return frontmatter
    ?.split("\n")
    .map((line) => line.match(/^([^:]+):\s*(.+)$/))
    .find((match) => match?.[1] === field)?.[2]
}

function secondLevelHeadings(markdown: string): string[] {
  let insideFence = false
  const headings: string[] = []

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      insideFence = !insideFence
      continue
    }
    if (!insideFence && line.startsWith("## ")) headings.push(line.slice(3))
  }

  return headings
}

function outcomePolicies(markdown: string): Map<string, { evidence: string; action: string }> {
  const policies = new Map<string, { evidence: string; action: string }>()
  const classification = markdown.match(/^## Classify the Outcome\n([\s\S]*?)(?=^## )/m)?.[1] ?? ""

  for (const line of classification.split("\n")) {
    const columns = line.match(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \|$/)
    if (columns?.[1] !== undefined && columns[2] !== undefined && columns[3] !== undefined) {
      policies.set(columns[1], { evidence: columns[2].trim(), action: columns[3].trim() })
    }
  }

  return policies
}

function sectionBody(markdown: string, heading: string): string {
  const sections = markdown.split(/^## /m)
  return sections.find((section) => section.startsWith(`${heading}\n`))?.slice(heading.length + 1) ?? ""
}

function thirdLevelSection(markdown: string, heading: string): string {
  const marker = `### ${heading}\n`
  const start = markdown.indexOf(marker)
  if (start < 0) return ""

  const body = markdown.slice(start + marker.length)
  const nextHeading = body.search(/^#{2,3} /m)
  return nextHeading < 0 ? body : body.slice(0, nextHeading)
}

function paragraphContaining(markdown: string, token: string): string {
  return (markdown.split(/\n\s*\n/).find((paragraph) => paragraph.includes(token)) ?? "").replace(/\s+/g, " ")
}

describe("ulw-mutation-test skill contract", () => {
  it("#given the native skill source #when it is staged #then Senpi receives the same named workflow", () => {
    const sourceSkill = readRequired(sourceSkillPath)
    const stagedSkill = readRequired(stagedSkillPath)

    expect(frontmatterField(sourceSkill, "name")).toBe("ulw-mutation-test")
    expect(frontmatterField(stagedSkill, "name")).toBe("ulw-mutation-test")
    expect(stagedSkill).toBe(sourceSkill.replace(/\n{3,}/g, "\n\n"))
    expect(secondLevelHeadings(sourceSkill)).toEqual([
      "When to Run",
      "Safety Invariants",
      "Gate",
      "Design 3-5 Mutations",
      "Predict Before Results",
      "Execute One Mutation",
      "Classify the Outcome",
      "Repair Surviving Mutations",
      "Restore and Verify",
      "Report",
      "Completion Contract",
    ])
  })

  it("#given an in-promise survivor #when the outcome policy is parsed #then test repair and the same mutation rerun are mandatory", () => {
    const policies = outcomePolicies(readRequired(sourceSkillPath))
    const survivor = policies.get("survived_in_promise")

    expect([...policies.keys()]).toEqual([
      "killed",
      "survived_in_promise",
      "survived_unowned",
      "misattributed",
      "invalid",
      "unreached",
      "equivalent",
      "inconclusive",
    ])
    expect(survivor?.action).toMatch(/\brepair\b/i)
    expect(survivor?.action).toMatch(/\brerun\b/i)
  })

  it("#given empty invalid unreached or interrupted attempts #when decisions are parsed #then none can pass and restoration stays mandatory", () => {
    const skill = readRequired(sourceSkillPath)
    const gate = sectionBody(skill, "Gate")
    const safety = sectionBody(skill, "Safety Invariants")
    const notApplicable = paragraphContaining(sectionBody(skill, "When to Run"), "not_applicable")
    const prediction = sectionBody(skill, "Predict Before Results")
    const execution = sectionBody(skill, "Execute One Mutation")
    const policies = outcomePolicies(skill)

    expect(gate).toMatch(/empty candidate set cannot pass/i)
    expect(gate).toContain("not_verified")
    expect(policies.get("invalid")?.action).toMatch(/\breplacement\b/i)
    expect(policies.get("unreached")?.action).toMatch(/\breached code\b|\bcorrect test\b/i)
    expect(policies.get("inconclusive")?.action).toMatch(/\bcannot pass\b/i)
    expect(safety).toMatch(/clean files[\s\S]*explicitly snapshotted/i)
    expect(safety).toMatch(/overlapping[\s\S]*pre-existing dirty changes/i)
    expect(safety).toMatch(/malformed command[\s\S]*timeout[\s\S]*restoration path/i)
    expect(execution).toMatch(
      /apply only that mutation[\s\S]*bounded[\s\S]*timeout[\s\S]*restoration[\s\S]*classify/i,
    )
    expect(execution).toMatch(/no compiler[\s\S]*(?:parser|loader)[\s\S]*preflight/i)
    expect(sectionBody(skill, "Restore and Verify")).toMatch(/content hash[\s\S]*scoped diff[\s\S]*residue/i)
    expect(prediction).toMatch(/validation command[\s\S]*deadline[\s\S]*test command[\s\S]*deadline/i)
    expect(safety).toMatch(/generated artifact[\s\S]*process[\s\S]*port/i)
    expect(skill).toMatch(/command deadlines[\s\S]*PID\/PGID cleanup[\s\S]*generated outputs/i)
    expect(notApplicable).toContain("assertion")
    expect(notApplicable).toContain("test case")
    expect(notApplicable).toContain("fixture expectation")
    expect(notApplicable).toContain("prompt-behavior rule")
    expect(notApplicable).toContain("test-quality claim")
  })

  it("#given the ulw-loop workflow #when a work unit changes tests #then mutation validation precedes checkpointing", () => {
    const workflow = readRequired(loopWorkflowPath)
    const compactLoop = readRequired(loopSkillPath)
    const mutationGate = workflow.indexOf("### Mutation-Test Gate")
    const gitCheckpoint = workflow.indexOf("#### GIT CHECKPOINT")
    const perCriterionCycle = thirdLevelSection(workflow, "Per-Criterion Cycle")
    const finalQualityGate = sectionBody(workflow, "Final Quality Gate")
    const notApplicable = paragraphContaining(thirdLevelSection(workflow, "Mutation-Test Gate"), "not_applicable")

    expect(mutationGate).toBeGreaterThan(-1)
    expect(gitCheckpoint).toBeGreaterThan(mutationGate)
    expect(workflow.slice(mutationGate, gitCheckpoint)).toContain("`ulw-mutation-test`")
    expect(perCriterionCycle).toContain("assertions")
    expect(perCriterionCycle).toContain("test cases")
    expect(perCriterionCycle).toContain("fixture expectations")
    expect(perCriterionCycle).toContain("prompt-behavior rules")
    expect(perCriterionCycle).toContain("test-quality claims")
    expect(perCriterionCycle).toMatch(/require its report before checkpointing/i)
    expect(finalQualityGate).toMatch(/mutation report[\s\S]*exact restoration receipt/i)
    expect(compactLoop).toContain("test-quality claims")
    expect(notApplicable).toContain("assertion")
    expect(notApplicable).toContain("test case")
    expect(notApplicable).toContain("fixture expectation")
    expect(notApplicable).toContain("prompt-behavior rule")
    expect(notApplicable).toContain("test-quality claim")
    const buildGate = finalQualityGate.indexOf("generated-output freshness")
    const freeze = finalQualityGate.indexOf("FREEZE")
    const manualQa = finalQualityGate.indexOf("Manual-QA")
    const finalHashes = finalQualityGate.indexOf("final hashes")
    const reviewers = finalQualityGate.indexOf("code reviewer")
    expect(buildGate).toBeGreaterThan(-1)
    expect(freeze).toBeGreaterThan(buildGate)
    expect(manualQa).toBeGreaterThan(freeze)
    expect(finalHashes).toBeGreaterThan(manualQa)
    expect(reviewers).toBeGreaterThan(finalHashes)
  })

  it("#given the skill synchronizer #when native skills are enumerated #then mutation testing is distributed", () => {
    const syncScript = readRequired(syncScriptPath)
    const registeredNames = [...syncScript.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1])

    expect(registeredNames).toContain("ulw-mutation-test")
  })
})
