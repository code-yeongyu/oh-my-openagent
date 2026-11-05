import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  auditSkillReferences,
  formatFinding,
  suggestName,
  type AuditedFile,
  type Edition,
  type ReferenceCatalog,
} from "./skill-reference-audit"

const repoRoot = resolve(import.meta.dir, "..")
const fixtureRoot = mkdtempSync(join(tmpdir(), "skill-reference-audit-"))

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

function writeFixture(relativePath: string, content: string): string {
  const path = join(fixtureRoot, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

function perEdition(senpi: string[], opencode: string[], codex: string[]): Record<Edition, ReadonlySet<string>> {
  return {
    senpi: new Set(senpi),
    opencode: new Set(opencode),
    codex: new Set(codex),
    repo: new Set([...senpi, ...opencode, ...codex]),
  }
}

const otherSkillRoot = join(fixtureRoot, "skills", "other")
writeFixture("skills/other/SKILL.md", "---\nname: other\ndescription: d\n---\n")
writeFixture("skills/other/references/present.md", "present\n")
writeFixture("skills/main/references/python/httpx2.md", "real file\n")

const catalog: ReferenceCatalog = {
  skills: perEdition(["git-master", "bun", "other"], ["git-master", "team-mode", "other"], ["git-master", "teammode", "other"]),
  agents: perEdition(["explore", "plan-reviewer"], ["explore", "oracle"], ["explorer", "plan"]),
  categories: perEdition(["quick", "deep-low"], ["quick", "deep-low"], ["quick", "deep-low"]),
  skillRoots: new Map([["other", [otherSkillRoot]]]),
}

function audit(relativePath: string, content: string, editions: readonly Edition[], taskDialect: AuditedFile["taskDialect"] = "senpi") {
  const path = writeFixture(relativePath, content)
  const file: AuditedFile = { path, editions, skillRoot: join(fixtureRoot, "skills", "main"), taskDialect }
  return auditSkillReferences(fixtureRoot, { catalog, files: [file] }).map((finding) => ({
    referenceClass: finding.referenceClass,
    reference: finding.reference,
    missingIn: finding.missingIn,
    suggestion: finding.suggestion,
  }))
}

describe("skill reference audit", () => {
  test("#given every shipped skill and prompt in this repository #when audited #then every skill, path, agent and category reference resolves in each edition that ships it", () => {
    // given / when
    const findings = auditSkillReferences(repoRoot)

    // then
    expect(findings.map(formatFinding)).toEqual([])
  })

  test("#given a load_skills entry with an underscore instead of a hyphen #when audited #then it is reported with the real name as the suggestion", () => {
    expect(audit("skills/main/SKILL.md", 'task(category="quick", load_skills=["git_master"])\n', ["senpi", "opencode"])).toEqual([
      { referenceClass: "skill-name", reference: "git_master", missingIn: ["senpi", "opencode"], suggestion: "git-master" },
    ])
  })

  test("#given a prose pointer to a skill that exists in one edition only #when the file ships to two #then only the edition that lacks it is reported", () => {
    expect(audit("skills/main/one.md", "Read the `bun` skill before your first cell.\n", ["senpi", "opencode"])).toEqual([
      { referenceClass: "skill-name", reference: "bun", missingIn: ["opencode"], suggestion: undefined },
    ])
  })

  test("#given an optional mention #when the skill exists in some edition #then it passes, and when it exists in none #then it is reported", () => {
    expect(audit("skills/main/two.md", "When the session lists the `teammode` skill, use it.\n", ["opencode"])).toEqual([])
    expect(audit("skills/main/three.md", "When the session lists the `open-design` skill, use it.\n", ["opencode"])).toEqual([
      { referenceClass: "skill-name", reference: "open-design", missingIn: ["opencode"], suggestion: undefined },
    ])
  })

  test("#given an optional mention whose name exists only in this repository's own local skills #when audited #then it is reported unless the text says the skill is project-local", () => {
    const repoOnlyCatalog: ReferenceCatalog = { ...catalog, skills: { ...catalog.skills, repo: new Set([...catalog.skills.repo, "work-with-pr"]) } }
    const path = writeFixture("skills/main/repo-only.md", "When the session lists the `work-with-pr` skill, use it.\nIf the environment provides a `work-with-pr` skill (some repositories define one project-locally), use it.\n")
    const file: AuditedFile = { path, editions: ["senpi"], skillRoot: join(fixtureRoot, "skills", "main"), taskDialect: "senpi" }
    expect(auditSkillReferences(fixtureRoot, { catalog: repoOnlyCatalog, files: [file] }).map((finding) => [finding.line, finding.reference])).toEqual([[1, "work-with-pr"]])
  })

  test("#given a conditional about the project rather than the skill #when audited #then the mention is still required in every edition", () => {
    expect(audit("skills/main/three-b.md", "If the project has a React app, load the `teammode` skill.\n", ["opencode", "codex"])).toEqual([
      { referenceClass: "skill-name", reference: "teammode", missingIn: ["opencode"], suggestion: "team-mode" },
    ])
  })

  test("#given a skill-relative path in the wrong directory #when audited #then the existing file with that name is suggested", () => {
    expect(audit("skills/main/references/python/libraries.md", "See `references/httpx2.md` first.\n", ["codex"])).toEqual([
      { referenceClass: "skill-path", reference: "references/httpx2.md", missingIn: ["codex"], suggestion: "references/python/httpx2.md" },
    ])
  })

  test("#given a path the prose places in another skill #when audited #then it resolves against that skill's root", () => {
    expect(audit("skills/main/four.md", "Follow the `other` skill's `references/present.md`.\n", ["senpi"])).toEqual([])
    expect(audit("skills/main/five.md", "Follow the `other` skill's `references/never-written-guide.md`.\n", ["senpi"])).toEqual([
      { referenceClass: "skill-path", reference: "other:references/never-written-guide.md", missingIn: ["senpi"], suggestion: undefined },
    ])
  })

  test("#given task targets naming a missing agent and category #when audited in the Senpi dialect #then both are reported with the nearest real name", () => {
    expect(audit("skills/main/six.md", 'task(subagent_type="explroe", prompt="x")\ntask(category="quik", prompt="y")\n', ["senpi"])).toEqual([
      { referenceClass: "agent-name", reference: "explroe", missingIn: ["senpi"], suggestion: "explore" },
      { referenceClass: "category-name", reference: "quik", missingIn: ["senpi"], suggestion: "quick" },
    ])
  })

  test("#given a Codex agent_type #when audited #then it is checked against the Codex roles, not the subagent_type names", () => {
    expect(audit("skills/main/seven.md", '{"agent_type":"explore"}\n', ["codex"], "codex")).toEqual([
      { referenceClass: "agent-name", reference: "explore", missingIn: ["codex"], suggestion: "explorer" },
    ])
  })
})

describe("suggestName", () => {
  test("#given a separator or case variant #when suggested #then the normalized match wins over a closer edit", () => {
    expect(suggestName("Git_Master", ["git-master", "git-mastr"])).toBe("git-master")
  })

  test("#given a short name two edits away #when suggested #then nothing is proposed", () => {
    expect(suggestName("abcd", ["abxy"])).toBeUndefined()
  })
})
