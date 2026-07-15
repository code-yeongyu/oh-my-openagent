import { beforeEach, describe, expect, it } from "bun:test"
import {
  clearProjectAgentOrigins,
  hasProjectAgentOrigin,
  registerProjectAgentOrigins,
} from "./project-agent-origin-registry"

describe("project agent origin registry", () => {
  beforeEach(() => {
    clearProjectAgentOrigins()
  })

  it("#given project origin #when queried from normalized descendant worktree #then qualifies exact agent", () => {
    registerProjectAgentOrigins("/project/.", ["repository-reviewer"])

    const hasOrigin = hasProjectAgentOrigin("/project/member/../member-worktree", "repository-reviewer")

    expect(hasOrigin).toBe(true)
  })

  it("#given root origin and empty child registration #when queried from member worktree #then inherits root agent", () => {
    registerProjectAgentOrigins("/project", ["repository-reviewer"])
    registerProjectAgentOrigins("/project/member-worktree", ["member-only"])
    registerProjectAgentOrigins("/project/member-worktree/.", [])

    const inheritedHasOrigin = hasProjectAgentOrigin("/project/member-worktree", "repository-reviewer")
    const clearedChildHasOrigin = hasProjectAgentOrigin("/project/member-worktree", "member-only")

    expect(inheritedHasOrigin).toBe(true)
    expect(clearedChildHasOrigin).toBe(false)
  })

  it("#given root origin and non-empty nearer registration #when nearer set lacks root agent #then rejects shadowed root agent", () => {
    registerProjectAgentOrigins("/project", ["repository-reviewer"])
    registerProjectAgentOrigins("/project/member-worktree", ["member-only"])

    const rootHasOrigin = hasProjectAgentOrigin("/project/member-worktree/nested", "repository-reviewer")
    const memberHasOrigin = hasProjectAgentOrigin("/project/member-worktree/nested", "member-only")

    expect(rootHasOrigin).toBe(false)
    expect(memberHasOrigin).toBe(true)
  })

  it("#given project origin #when queried from exact directory #then preserves exact-directory behavior", () => {
    registerProjectAgentOrigins("/project", ["repository-reviewer"])

    const hasOrigin = hasProjectAgentOrigin("/project", "repository-reviewer")
    const caseMismatchHasOrigin = hasProjectAgentOrigin("/project", "Repository-Reviewer")
    const prefixNameHasOrigin = hasProjectAgentOrigin("/project", "repository-review")

    expect(hasOrigin).toBe(true)
    expect(caseMismatchHasOrigin).toBe(false)
    expect(prefixNameHasOrigin).toBe(false)
  })

  it("#given project origin #when queried from sibling prefix collision or unrelated directory #then rejects", () => {
    registerProjectAgentOrigins("/project", ["repository-reviewer"])

    const siblingHasOrigin = hasProjectAgentOrigin("/sibling/member-worktree", "repository-reviewer")
    const prefixCollisionHasOrigin = hasProjectAgentOrigin("/project-other/member-worktree", "repository-reviewer")
    const unrelatedHasOrigin = hasProjectAgentOrigin("/unrelated", "repository-reviewer")

    expect(siblingHasOrigin).toBe(false)
    expect(prefixCollisionHasOrigin).toBe(false)
    expect(unrelatedHasOrigin).toBe(false)
  })

  it("#given child registration #when queried from parent #then rejects", () => {
    registerProjectAgentOrigins("/project/member-worktree", ["repository-reviewer"])

    const hasOrigin = hasProjectAgentOrigin("/project", "repository-reviewer")

    expect(hasOrigin).toBe(false)
  })

  it("#given cleared origins #when queried from exact or descendant directory #then rejects", () => {
    registerProjectAgentOrigins("/project", ["repository-reviewer"])
    clearProjectAgentOrigins()

    const exactHasOrigin = hasProjectAgentOrigin("/project", "repository-reviewer")
    const descendantHasOrigin = hasProjectAgentOrigin("/project/member-worktree", "repository-reviewer")

    expect(exactHasOrigin).toBe(false)
    expect(descendantHasOrigin).toBe(false)
  })
})
