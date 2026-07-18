import { describe, expect, it } from "bun:test"

import { LABEL_MAX } from "./constants"
import { teamLines, teamNodes } from "./team-section"
import type { ViewNode } from "./element-helpers"
import type { TeamsState } from "./state-types"

const theme = {
  accent: "accent",
  borderSubtle: "border",
  error: "error",
  info: "info",
  success: "success",
  text: "text",
  textMuted: "muted",
  warning: "warning",
}

function isMouseHandler(value: unknown): value is (event: { stopPropagation: () => void }) => void {
  return typeof value === "function"
}

function memberRows(nodes: readonly ViewNode[]): readonly ViewNode[] {
  return nodes[0]?.children?.slice(1) ?? []
}

describe("team sidebar section", () => {
  it("#given expanded teams with valid and missing member sessions #when rendering #then it shows the count and navigates only valid rows without bubbling", () => {
    // given
    const teams: TeamsState = {
      kind: "list",
      teams: [
        {
          name: "sidebar-team",
          members: [
            { name: "running", status: "running", work: "Implementing sidebar", sessionId: "ses-running" },
            { name: "idle", status: "idle", work: null, sessionId: null },
          ],
        },
      ],
    }
    const navigatedSessionIds: string[] = []
    let toggleCount = 0

    // when
    const nodes = teamNodes(teams, theme, {
      collapsed: false,
      onToggle: () => {
        toggleCount += 1
      },
      onNavigateSession: (sessionId) => {
        navigatedSessionIds.push(sessionId)
      },
    })
    const [header, navigableRow, idleRow] = nodes[0]?.children ?? []
    const navigateHandler = navigableRow?.props.onMouseDown
    const toggleHandler = header?.props.onMouseDown
    let propagationStopped = false

    // then
    expect(nodes).toHaveLength(1)
    expect(header?.text).toBeUndefined()
    expect(JSON.stringify(nodes)).toContain("Team (2)")
    expect(memberRows(nodes)).toHaveLength(2)
    expect(idleRow?.props.onMouseDown).toBeUndefined()
    if (!isMouseHandler(toggleHandler)) {
      throw new Error("team header was not interactive")
    }
    if (!isMouseHandler(navigateHandler)) {
      throw new Error("member row was not interactive")
    }
    toggleHandler({ stopPropagation: () => undefined })
    navigateHandler({
      stopPropagation: () => {
        propagationStopped = true
      },
    })
    expect(toggleCount).toBe(1)
    expect(propagationStopped).toBe(true)
    expect(navigatedSessionIds).toEqual(["ses-running"])
  })

  it("#given collapsed teams #when rendering #then it keeps only the foldable Team header", () => {
    // given
    const teams: TeamsState = {
      kind: "list",
      teams: [{ name: "sidebar-team", members: [{ name: "idle", status: "idle", work: null, sessionId: null }] }],
    }

    // when
    const nodes = teamNodes(teams, theme, {
      collapsed: true,
      onToggle: () => undefined,
      onNavigateSession: () => undefined,
    })

    // then
    expect(memberRows(nodes)).toHaveLength(0)
    expect(JSON.stringify(nodes)).toContain("Team (1)")
  })

  it("#given long Team member fields #when rendering a member row #then the full row stays within the sidebar label bound", () => {
    // given
    const teams: TeamsState = {
      kind: "list",
      teams: [{
        name: "team-name-that-is-far-too-long",
        members: [{
          name: "member-name-that-is-far-too-long",
          status: "running",
          work: "current work that is also far too long",
          sessionId: null,
        }],
      }],
    }

    // when
    const memberLine = teamLines(teams)[1]

    // then
    expect(memberLine?.length).toBeLessThanOrEqual(LABEL_MAX)
    expect(memberLine).toEndWith("...")
  })
})
