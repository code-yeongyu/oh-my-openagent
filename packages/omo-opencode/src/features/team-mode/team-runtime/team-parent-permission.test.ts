import { describe, expect, it, mock } from "bun:test"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { FinalOpenCodeAgent } from "../final-open-code-agent-registry"
import { resolveTeamParentPermission, TeamParentPermissionError } from "./team-parent-permission"

type PermissionRule = FinalOpenCodeAgent["permission"][number]

function createAgent(name: string, permission: PermissionRule[]): FinalOpenCodeAgent {
  return {
    name,
    mode: "primary",
    permission,
  }
}

function createContext(registry: FinalOpenCodeAgent[], parentPermission: PermissionRule[]): ExecutorContext {
  return {
    client: {
      app: {
        agents: mock(async () => ({ data: registry })),
      },
      session: {
        get: mock(async () => ({
          data: {
            id: "lead-session",
            directory: "/repo",
            permission: parentPermission,
          },
        })),
      },
    } as ExecutorContext["client"],
    manager: {} as ExecutorContext["manager"],
    directory: "/repo",
  }
}

describe("resolveTeamParentPermission", () => {
  it("#given canonical caller key #when registry uses canonical display name #then prepends only agent deny rules", async () => {
    const agentDeny: PermissionRule = { permission: "bash", pattern: "*", action: "deny" }
    const sessionAllow: PermissionRule = { permission: "read", pattern: "*", action: "allow" }
    const sessionDeny: PermissionRule = { permission: "question", pattern: "*", action: "deny" }
    const ctx = createContext([
      createAgent("Sisyphus - ultraworker", [
        { permission: "team_create", pattern: "*", action: "allow" },
        agentDeny,
        { permission: "edit", pattern: "*", action: "ask" },
      ]),
    ], [sessionAllow, sessionDeny])

    const permission = await resolveTeamParentPermission({
      ctx,
      leadSessionId: "lead-session",
      callerAgentTypeId: "sisyphus",
    })

    expect(permission).toEqual([agentDeny, sessionAllow, sessionDeny])
  })

  it("#given unrelated project identity #when resolving canonical caller key #then fails closed", async () => {
    const ctx = createContext([createAgent("project-sisyphus-reviewer", [])], [])

    const result = resolveTeamParentPermission({
      ctx,
      leadSessionId: "lead-session",
      callerAgentTypeId: "sisyphus",
    })

    await expect(result).rejects.toBeInstanceOf(TeamParentPermissionError)
  })

  it("#given duplicate canonical identities #when resolving caller permission #then fails closed", async () => {
    const ctx = createContext([
      createAgent("sisyphus", []),
      createAgent("Sisyphus - ultraworker", []),
    ], [])

    const result = resolveTeamParentPermission({
      ctx,
      leadSessionId: "lead-session",
      callerAgentTypeId: "sisyphus",
    })

    await expect(result).rejects.toBeInstanceOf(TeamParentPermissionError)
  })
})
