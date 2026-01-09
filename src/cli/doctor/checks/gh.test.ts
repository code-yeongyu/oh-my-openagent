import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as gh from "./gh"

describe("gh cli check", () => {
  describe("getGhCliInfo", () => {
    it("returns gh cli info structure", async () => {
      // #given
      // #when checking gh cli info
      const info = await gh.getGhCliInfo()

      // #then should return valid info structure
      expect(typeof info.installed).toBe("boolean")
      expect(info.authenticated === true || info.authenticated === false).toBe(true)
      expect(Array.isArray(info.scopes)).toBe(true)
    })
  })

  describe("checkGhCli", () => {
    let getInfoSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      getInfoSpy?.mockRestore()
    })

    it("returns warn when gh is not installed", async () => {
      // #given gh not installed
      getInfoSpy = spyOn(gh, "getGhCliInfo").mockResolvedValue({
        installed: false,
        version: null,
        path: null,
        authenticated: false,
        username: null,
        scopes: [],
        error: null,
      })

      // #when checking
      const result = await gh.checkGhCli()

      // #then should warn (optional)
      expect(result.status).toBe("warn")
      expect(result.message).toContain("Not installed")
      expect(result.details).toContain("Install: https://cli.github.com/")
    })

    it("returns warn when gh is installed but not authenticated", async () => {
      // #given gh installed but not authenticated
      getInfoSpy = spyOn(gh, "getGhCliInfo").mockResolvedValue({
        installed: true,
        version: "2.40.0",
        path: "/usr/local/bin/gh",
        authenticated: false,
        username: null,
        scopes: [],
        error: "not logged in",
      })

      // #when checking
      const result = await gh.checkGhCli()

      // #then should warn about auth
      expect(result.status).toBe("warn")
      expect(result.message).toContain("2.40.0")
      expect(result.message).toContain("not authenticated")
      expect(result.details).toContain("Authenticate: gh auth login")
    })

    it("returns pass when gh is installed and authenticated", async () => {
      // #given gh installed and authenticated
      getInfoSpy = spyOn(gh, "getGhCliInfo").mockResolvedValue({
        installed: true,
        version: "2.40.0",
        path: "/usr/local/bin/gh",
        authenticated: true,
        username: "octocat",
        scopes: ["repo", "read:org"],
        error: null,
      })

      // #when checking
      const result = await gh.checkGhCli()

      // #then should pass
      expect(result.status).toBe("pass")
      expect(result.message).toContain("2.40.0")
      expect(result.message).toContain("octocat")
      expect(result.details).toContain("Account: octocat")
      expect(result.details).toContain("Scopes: repo, read:org")
    })
  })

  describe("getGhCliCheckDefinition", () => {
    it("returns correct check definition", () => {
      // #given
      // #when getting definition
      const def = gh.getGhCliCheckDefinition()

      // #then should have correct properties
      expect(def.id).toBe("gh-cli")
      expect(def.name).toBe("GitHub CLI")
      expect(def.category).toBe("tools")
      expect(def.critical).toBe(false)
      expect(typeof def.check).toBe("function")
    })
  })
})
