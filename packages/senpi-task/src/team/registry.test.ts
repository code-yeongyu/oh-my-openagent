import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { type SenpiTeamMemberPorts, loadTeamRegistry } from "./index"

const created: string[] = []

const allowAll: SenpiTeamMemberPorts = {
  isCategoryResolvable: () => true,
  isKnownAgent: () => true,
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-task-team-registry-"))
  created.push(dir)
  return dir
}

function writeProjectTeamSpec(projectRoot: string, teamName: string, spec: unknown): void {
  const teamDir = join(projectRoot, ".omo", "teams", teamName)
  mkdirSync(teamDir, { recursive: true })
  writeFileSync(join(teamDir, "config.json"), JSON.stringify(spec), "utf8")
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("loadTeamRegistry", () => {
  test("#given an omo.json teams section with a category and agent-alias member #when loaded #then it round-trips into a team-core spec", async () => {
    // given
    const projectRoot = makeProjectDir()
    const omoTeams = {
      "research-team": {
        members: [
          { kind: "category", category: "quick", prompt: "investigate" },
          { kind: "agent", subagent_type: "finder" },
        ],
      },
    }

    // when
    const result = await loadTeamRegistry({ projectRoot, omoTeams, ports: allowAll })

    // then
    expect(result.errors).toEqual([])
    expect(result.teams).toHaveLength(1)
    const entry = result.teams[0]
    expect(entry?.name).toBe("research-team")
    expect(entry?.source).toBe("omo-json")
    expect(entry?.spec.leadAgentId).toBe("lead")
    expect(entry?.spec.members).toHaveLength(2)
  })

  test("#given a directory spec and an omo.json spec sharing a name #when loaded #then the project directory wins", async () => {
    // given
    const projectRoot = makeProjectDir()
    writeProjectTeamSpec(projectRoot, "shared", {
      members: [{ kind: "subagent_type", subagent_type: "atlas" }],
    })
    const omoTeams = {
      shared: { members: [{ kind: "category", category: "quick", prompt: "work" }] },
    }

    // when
    const result = await loadTeamRegistry({ projectRoot, omoTeams, ports: allowAll })

    // then
    expect(result.teams).toHaveLength(1)
    const entry = result.teams[0]
    expect(entry?.name).toBe("shared")
    expect(entry?.source).toBe("project")
    expect(entry?.spec.members[0]?.kind).toBe("subagent_type")
  })

  test("#given a member with an unresolvable kind #when loaded #then an error is recorded and zero teams spawn", async () => {
    // given
    const projectRoot = makeProjectDir()
    const omoTeams = {
      "bad-team": { members: [{ kind: "oracle-like-unknown", name: "x" }] },
    }
    const ports: SenpiTeamMemberPorts = {
      isCategoryResolvable: () => false,
      isKnownAgent: () => false,
    }

    // when
    const result = await loadTeamRegistry({ projectRoot, omoTeams, ports })

    // then
    expect(result.teams).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.name).toBe("bad-team")
    expect(result.errors[0]?.code).toBe("UNRESOLVABLE_CATEGORY")
  })

  test("#given a team declaring a raw lead field #when loaded #then it is rejected and spawns zero members", async () => {
    // given
    const projectRoot = makeProjectDir()
    const omoTeams = {
      "lead-field-team": {
        lead: { kind: "subagent_type", subagent_type: "sisyphus" },
        members: [{ kind: "category", category: "quick", prompt: "work" }],
      },
    }

    // when
    const result = await loadTeamRegistry({ projectRoot, omoTeams, ports: allowAll })

    // then
    expect(result.teams).toEqual([])
    expect(result.errors[0]?.code).toBe("RESERVED_LEAD_FIELD")
  })

  test("#given no team sources #when loaded #then it returns empty teams and errors", async () => {
    // given
    const projectRoot = makeProjectDir()

    // when
    const result = await loadTeamRegistry({ projectRoot, ports: allowAll })

    // then
    expect(result.teams).toEqual([])
    expect(result.errors).toEqual([])
  })
})
