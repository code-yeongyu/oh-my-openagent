import { describe, expect, test } from "bun:test"

import { planCuratedReadonlyCommand } from "./curated-readonly-bash"

describe("planCuratedReadonlyCommand", () => {
  test("#given read-only curl and GitHub requests #when planned #then direct executables are returned without a shell", () => {
    expect(planCuratedReadonlyCommand({ program: "curl", args: ["--silent", "https://example.com/docs"] })).toEqual({
      program: "curl",
      args: ["--disable", "--silent", "https://example.com/docs"],
    })
    expect(planCuratedReadonlyCommand({ program: "gh", args: ["search", "code", "createTaskEngine", "--limit", "5"] })).toEqual({
      program: "gh",
      args: ["search", "code", "createTaskEngine", "--limit", "5"],
    })
  })

  test("#given mutation-capable flags or commands #when planned #then every request is rejected", () => {
    const requests = [
      { program: "curl", args: ["--request", "POST", "https://example.com"] },
      { program: "curl", args: ["--output", "artifact", "https://example.com"] },
      { program: "curl", args: ["--data", "x=1", "https://example.com"] },
      { program: "gh", args: ["api", "repos/acme/repo", "--method", "DELETE"] },
      { program: "gh", args: ["repo", "clone", "acme/repo"] },
    ] as const

    for (const request of requests) {
      expect(() => planCuratedReadonlyCommand(request)).toThrow("read-only")
    }
  })
})
