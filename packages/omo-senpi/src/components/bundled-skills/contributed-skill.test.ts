import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { resolveContributedSkill } from "./contributed-skill"

const OWN_PATH = "/skills/computer-use/SKILL.md"
const USER_PATH = "/user-skills/computer-use/SKILL.md"

function resolveWith(
  commands: readonly { name: string; source: string; sourceInfo?: { path?: string } }[] | undefined,
) {
  const pi = new FakeExtensionAPI()
  if (commands !== undefined) pi.getCommands = () => commands
  return resolveContributedSkill({
    pi,
    name: "computer-use",
    path: () => OWN_PATH,
    cwd: tmpdir(),
    env: process.env,
  })
}

describe("resolveContributedSkill (#12544 review)", () => {
  test("#given no same-name skill is loaded #when resolving #then the skill is contributed", () => {
    expect(resolveWith([])).toEqual({ kind: "contributed", path: OWN_PATH })
  })

  test("#given a loaded same-name skill with no path #when resolving #then it still yields (#12544 review)", () => {
    // A listing entry without `sourceInfo.path` still occupies the name; contributing ours
    // would surface as a skill-conflict collision (#9160). The `ownerPath === undefined`
    // branch of `skillStatusLine` stays reachable through this case.
    expect(resolveWith([{ name: "skill:computer-use", source: "skill" }])).toEqual({
      kind: "yielded",
      ownerPath: undefined,
    })
  })

  test("#given a loaded same-name skill with another path #when resolving #then it yields to that owner", () => {
    expect(resolveWith([{ name: "skill:computer-use", source: "skill", sourceInfo: { path: USER_PATH } }])).toEqual({
      kind: "yielded",
      ownerPath: USER_PATH,
    })
  })

  test("#given the loaded entry is our own copy #when resolving #then the skill is contributed", () => {
    expect(resolveWith([{ name: "skill:computer-use", source: "skill", sourceInfo: { path: OWN_PATH } }])).toEqual({
      kind: "contributed",
      path: OWN_PATH,
    })
  })

  test("#given the skill is in disabled_skills #when resolving #then it is disabled", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-contributed-skill-home-"))
    const cwd = mkdtempSync(join(tmpdir(), "omo-contributed-skill-cwd-"))
    try {
      mkdirSync(join(cwd, ".omo"), { recursive: true })
      writeFileSync(join(cwd, ".omo", "omo.jsonc"), JSON.stringify({ disabled_skills: ["computer-use"] }))
      const pi = new FakeExtensionAPI()
      expect(
        resolveContributedSkill({
          pi,
          name: "computer-use",
          path: () => OWN_PATH,
          cwd,
          env: { ...process.env, HOME: home },
        }),
      ).toEqual({ kind: "disabled" })
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
