import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as gh from "./gh"

describe("gh cli check", () => {
  describe("getGhCliInfo", () => {
    function createProc(opts: { stdout?: string; stderr?: string; exitCode?: number }) {
      const stdoutText = opts.stdout ?? ""
      const stderrText = opts.stderr ?? ""
      const exitCode = opts.exitCode ?? 0
      const encoder = new TextEncoder()

      return {
        stdout: new ReadableStream({
          start(controller) {
            if (stdoutText) controller.enqueue(encoder.encode(stdoutText))
            controller.close()
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            if (stderrText) controller.enqueue(encoder.encode(stderrText))
            controller.close()
          },
        }),
        exited: Promise.resolve(exitCode),
        exitCode,
      } as unknown as ReturnType<typeof Bun.spawn>
    }

    it("returns gh cli info structure", async () => {
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation((cmd) => {
        if (Array.isArray(cmd) && cmd[0] === "which" && cmd[1] === "gh") {
          return createProc({ stdout: "/usr/bin/gh\n" })
        }

        if (Array.isArray(cmd) && cmd[0] === "gh" && cmd[1] === "--version") {
          return createProc({ stdout: "gh version 2.40.0\n" })
        }

        if (Array.isArray(cmd) && cmd[0] === "gh" && cmd[1] === "auth" && cmd[2] === "status") {
          return createProc({
            exitCode: 0,
            stderr: "Logged in to github.com account octocat (keyring)\nToken scopes: 'repo', 'read:org'\n",
          })
        }

        throw new Error(`Unexpected Bun.spawn call: ${Array.isArray(cmd) ? cmd.join(" ") : String(cmd)}`)
      })

      try {
        const info = await gh.getGhCliInfo()

        expect(info.installed).toBe(true)
        expect(info.version).toBe("2.40.0")
        expect(typeof info.authenticated).toBe("boolean")
        expect(Array.isArray(info.scopes)).toBe(true)
      } finally {
        spawnSpy.mockRestore()
      }
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
