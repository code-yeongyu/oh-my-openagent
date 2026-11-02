import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { formatCombinedDescription } from "./description-formatter"
import { makeCommand, makeSkill } from "./description-formatter.test-support"
import type { CoreListedSkill, SkillInfo } from "./types"

const HOME = "/home/user"
const REPO = "/repo"

function coreEntry(name: string, location: string, description = `${name} core desc`): CoreListedSkill {
  return { name, description, location }
}

const customizeOpencode = coreEntry("customize-opencode", "<built-in>", "Customize OpenCode")

type OverlapCase = {
  shape: string
  skill: SkillInfo
  // What OpenCode core's Skill.all() returned to the plugin; undefined = the list was unavailable.
  coreList: CoreListedSkill[] | undefined
  listedBy: "core" | "skill-tool" | "both"
}

const claudeUserSkillPath = `${HOME}/.claude/skills/claude-user-skill/SKILL.md`

const linkedRoot = mkdtempSync(join(tmpdir(), "skill-core-overlap-"))
mkdirSync(join(linkedRoot, "agents", "skills", "linked-skill"), { recursive: true })
writeFileSync(join(linkedRoot, "agents", "skills", "linked-skill", "SKILL.md"), "---\nname: linked-skill\n---\nbody")
mkdirSync(join(linkedRoot, "config"))
symlinkSync(join(linkedRoot, "agents", "skills"), join(linkedRoot, "config", "skills"), "junction")
afterAll(() => rmSync(linkedRoot, { recursive: true, force: true }))

const cases: OverlapCase[] = [
  {
    shape: "standard user SKILL.md that core lists",
    skill: makeSkill("claude-user-skill", "user desc", { scope: "user", location: claudeUserSkillPath }),
    coreList: [customizeOpencode, coreEntry("claude-user-skill", claudeUserSkillPath, "user desc")],
    listedBy: "core",
  },
  {
    shape: "standard project .opencode SKILL.md that core lists",
    skill: makeSkill("project-skill", "project desc", {
      scope: "opencode-project",
      location: `${REPO}/.opencode/skills/project-skill/SKILL.md`,
    }),
    coreList: [coreEntry("project-skill", `${REPO}/.opencode/skills/project-skill/SKILL.md`, "project desc")],
    listedBy: "core",
  },
  {
    shape: "Windows SKILL.md path that core lists with backslashes",
    skill: makeSkill("windows-skill", "win desc", {
      scope: "user",
      location: "C:/Users/me/.claude/skills/windows-skill/SKILL.md",
    }),
    coreList: [coreEntry("windows-skill", "C:\\Users\\me\\.claude\\skills\\windows-skill\\SKILL.md", "win desc")],
    listedBy: "core",
  },
  {
    shape: "same file reached by core and OMO through a symlinked skills dir",
    skill: makeSkill("linked-skill", "linked desc", {
      scope: "opencode",
      location: join(linkedRoot, "config", "skills", "linked-skill", "SKILL.md"),
    }),
    coreList: [coreEntry("linked-skill", join(linkedRoot, "agents", "skills", "linked-skill", "SKILL.md"), "linked desc")],
    listedBy: "core",
  },
  {
    shape: "core built-in skill merged from the native list",
    skill: makeSkill("customize-opencode", "Customize OpenCode", { scope: "config", location: "<built-in>" }),
    coreList: [customizeOpencode],
    listedBy: "core",
  },
  {
    shape: "flat skills/<name>.md file core does not scan",
    skill: makeSkill("flat-skill", "flat desc", { scope: "user", location: `${HOME}/.claude/skills/flat-skill.md` }),
    coreList: [customizeOpencode],
    listedBy: "skill-tool",
  },
  {
    shape: "skills/<name>/<name>.md file core does not scan",
    skill: makeSkill("nested-skill", "nested desc", {
      scope: "project",
      location: `${REPO}/.agents/skills/nested-skill/nested-skill.md`,
    }),
    coreList: [customizeOpencode],
    listedBy: "skill-tool",
  },
  {
    shape: "SKILL.md without a name that core skips",
    skill: makeSkill("nameless-skill", "nameless desc", {
      scope: "project",
      location: `${REPO}/.opencode/skills/nameless-skill/SKILL.md`,
    }),
    coreList: [customizeOpencode],
    listedBy: "skill-tool",
  },
  {
    shape: "SKILL.md without a description that core lists but does not render",
    skill: makeSkill("undescribed-skill", "", {
      scope: "user",
      location: `${HOME}/.claude/skills/undescribed-skill/SKILL.md`,
    }),
    coreList: [coreEntry("undescribed-skill", `${HOME}/.claude/skills/undescribed-skill/SKILL.md`, "")],
    listedBy: "skill-tool",
  },
  ...["OPENCODE_DISABLE_EXTERNAL_SKILLS", "OPENCODE_DISABLE_CLAUDE_CODE", "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS"].map(
    (flag): OverlapCase => ({
      shape: `${flag} set, so core skips ~/.claude/skills`,
      skill: makeSkill("claude-user-skill", "user desc", { scope: "user", location: claudeUserSkillPath }),
      coreList: [customizeOpencode],
      listedBy: "skill-tool",
    }),
  ),
  {
    shape: "CLAUDE_CONFIG_DIR ending in /.claude that core never scans",
    skill: makeSkill("profile-skill", "profile desc", {
      scope: "user",
      location: "/work/profiles/alt/.claude/skills/profile-skill/SKILL.md",
    }),
    coreList: [customizeOpencode],
    listedBy: "skill-tool",
  },
  {
    shape: "core lists the same file under a different name",
    skill: makeSkill("shadowed-skill", "user desc", {
      scope: "project",
      location: `${REPO}/.claude/skills/shadowed-skill/SKILL.md`,
    }),
    coreList: [coreEntry("other-name", `${REPO}/.claude/skills/shadowed-skill/SKILL.md`)],
    listedBy: "skill-tool",
  },
  {
    shape: "core lists a different copy of the same name",
    skill: makeSkill("copied-skill", "copy desc", {
      scope: "opencode",
      location: `${HOME}/.config/opencode/skills/copied-skill/SKILL.md`,
    }),
    coreList: [coreEntry("copied-skill", `${HOME}/.agents/skills/.backup/copied-skill/SKILL.md`, "copy desc")],
    listedBy: "both",
  },
  {
    shape: "core list unavailable (no PluginInput.skills and the /skill endpoint failed)",
    skill: makeSkill("claude-user-skill", "user desc", { scope: "user", location: claudeUserSkillPath }),
    coreList: undefined,
    listedBy: "skill-tool",
  },
  {
    shape: "core list empty",
    skill: makeSkill("claude-user-skill", "user desc", { scope: "user", location: claudeUserSkillPath }),
    coreList: [],
    listedBy: "skill-tool",
  },
  {
    shape: "OMO-bundled skill core cannot see",
    skill: makeSkill("git-master", "bundled desc", {
      scope: "builtin",
      location: "/opt/oh-my-openagent/dist/skills/git-master/SKILL.md",
    }),
    coreList: [customizeOpencode],
    listedBy: "skill-tool",
  },
]

// Mirrors OpenCode core's Skill.fmt: <available_skills> renders only entries with a description.
function renderedByCore(coreList: CoreListedSkill[] | undefined, name: string): boolean {
  return (coreList ?? []).some((entry) => entry.name === name && (entry.description ?? "").trim() !== "")
}

describe("formatCombinedDescription core overlap", () => {
  it.each(cases.map((testCase) => [testCase.shape, testCase] as const))(
    "lists the skill where expected and never nowhere: %s",
    (_shape: string, testCase: OverlapCase) => {
      const description = formatCombinedDescription([testCase.skill], [], {
        includeSkills: true,
        coreListedSkills: testCase.coreList,
      })
      const inSkillTool = description.includes(`<name>/${testCase.skill.name}</name>`)
      const inCore = renderedByCore(testCase.coreList, testCase.skill.name)

      expect({ inCore, inSkillTool }).toEqual({
        inCore: testCase.listedBy !== "skill-tool",
        inSkillTool: testCase.listedBy !== "core",
      })
    },
  )

  it("still lists slash commands when every skill is already covered by core", () => {
    const description = formatCombinedDescription(
      [makeSkill("claude-user-skill", "user desc", { scope: "user", location: claudeUserSkillPath })],
      [makeCommand("handoff", "handoff command")],
      { includeSkills: true, coreListedSkills: [coreEntry("claude-user-skill", claudeUserSkillPath, "user desc")] },
    )

    expect(description).toContain("<available_items>")
    expect(description).toContain("/handoff")
    expect(description).not.toContain("/claude-user-skill")
  })

  it("suppresses builtin command aliases using the full skill list, not only the OMO-private remainder", () => {
    const refactorPath = `${REPO}/.opencode/skills/refactor/SKILL.md`
    const description = formatCombinedDescription(
      [
        makeSkill("refactor", "full refactor skill", { scope: "opencode-project", location: refactorPath }),
        makeSkill("ulw-execute", "full ulw-execute skill"),
      ],
      [
        makeCommand("refactor", "short refactor command"),
        makeCommand("ulw-execute", "short ulw-execute command"),
        makeCommand("handoff", "handoff command"),
      ],
      { includeSkills: true, coreListedSkills: [coreEntry("refactor", refactorPath, "full refactor skill")] },
    )

    expect(description).toContain("/ulw-execute")
    expect(description).toContain("/handoff")
    expect(description).not.toContain("/refactor")
    expect(description).not.toContain("short refactor command")
    expect(description).not.toContain("short ulw-execute command")
  })
})
