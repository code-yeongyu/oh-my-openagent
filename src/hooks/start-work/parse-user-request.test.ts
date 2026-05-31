/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { parseUserRequest } from "./parse-user-request"

describe("parseUserRequest", () => {
  describe("when no user-request tag", () => {
    test("#given prompt without tag #when parsing #then returns nulls", () => {
      const result = parseUserRequest("Just a regular message without any tags")
      expect(result.planName).toBeNull()
      expect(result.explicitWorktreePath).toBeNull()
    })
  })

  describe("when user-request tag is empty", () => {
    test("#given empty user-request tag #when parsing #then returns nulls", () => {
      const result = parseUserRequest("<user-request>  </user-request>")
      expect(result.planName).toBeNull()
      expect(result.explicitWorktreePath).toBeNull()
    })
  })

  describe("when only plan name given", () => {
    test("#given plan name without worktree flag #when parsing #then returns plan name with null worktree", () => {
      const result = parseUserRequest("<session-context>\n<user-request>my-plan</user-request>\n</session-context>")
      expect(result.planName).toBe("my-plan")
      expect(result.explicitWorktreePath).toBeNull()
    })
  })

  describe("when only --worktree flag given", () => {
    test("#given --worktree with path only #when parsing #then returns worktree path with null plan", () => {
      const result = parseUserRequest("<user-request>--worktree /home/user/repo-feat</user-request>")
      expect(result.planName).toBeNull()
      expect(result.explicitWorktreePath).toBe("/home/user/repo-feat")
    })
  })

  describe("when plan name and --worktree are both given", () => {
    test("#given plan name before --worktree #when parsing #then returns both", () => {
      const result = parseUserRequest("<user-request>my-plan --worktree /path/to/worktree</user-request>")
      expect(result.planName).toBe("my-plan")
      expect(result.explicitWorktreePath).toBe("/path/to/worktree")
    })

    test("#given --worktree before plan name #when parsing #then returns both", () => {
      const result = parseUserRequest("<user-request>--worktree /path/to/worktree my-plan</user-request>")
      expect(result.planName).toBe("my-plan")
      expect(result.explicitWorktreePath).toBe("/path/to/worktree")
    })
  })

  describe("when plan name is wrapped in quotes", () => {
    test("#given quoted plan name #when parsing #then strips wrapping quotes", () => {
      const result = parseUserRequest("<user-request>\"my feature plan\"</user-request>")
      expect(result.planName).toBe("my feature plan")
      expect(result.explicitWorktreePath).toBeNull()
    })
  })

  describe("when --worktree flag has no path", () => {
    test("#given --worktree without path #when parsing #then worktree path is null", () => {
      const result = parseUserRequest("<user-request>--worktree</user-request>")
      expect(result.explicitWorktreePath).toBeNull()
    })
  })

  describe("when ultrawork keywords are present", () => {
    test("#given plan name with ultrawork keyword #when parsing #then strips keyword from plan name", () => {
      const result = parseUserRequest("<user-request>my-plan ultrawork</user-request>")
      expect(result.planName).toBe("my-plan")
    })

    test("#given plan name with ulw keyword and worktree #when parsing #then strips ulw, preserves worktree", () => {
      const result = parseUserRequest("<user-request>my-plan ulw --worktree /path/to/wt</user-request>")
      expect(result.planName).toBe("my-plan")
      expect(result.explicitWorktreePath).toBe("/path/to/wt")
    })

    test("#given only ultrawork keyword with worktree #when parsing #then plan name is null, worktree preserved", () => {
      const result = parseUserRequest("<user-request>ultrawork --worktree /wt</user-request>")
      expect(result.planName).toBeNull()
      expect(result.explicitWorktreePath).toBe("/wt")
    })
  })
})
