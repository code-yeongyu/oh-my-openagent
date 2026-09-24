import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadMcpConfig } from "../../../node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/mcp/config.js"
import { teardownRoots } from "./teardown.test-support"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const roots: string[] = []

afterEach(() => teardownRoots(roots))

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type Fixture = { home: string, agentDir: string, configHome: string, launcher: string }

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-assets-e2e-"))
  roots.push(root)
  const app = join(root, "app")
  mkdirSync(join(root, "home"), { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  write(join(app, "package.json"), JSON.stringify({ name: "omo-ai", version: "test", type: "module" }))
  return {
    home: join(root, "home"),
    agentDir: join(root, "senpi-agent"),
    configHome: join(root, "config"),
    launcher: join(app, "bin", "omo.js"),
  }
}

function opencode(item: Fixture, config: unknown, skills: string[] = []): void {
  const configDir = join(item.configHome, "opencode")
  write(join(configDir, "opencode.json"), JSON.stringify(config, null, 2))
  for (const name of skills) {
    write(join(configDir, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: imported\n---\n\nbody\n`)
  }
}

function run(item: Fixture, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: item.home,
    USERPROFILE: item.home,
    SENPI_CODING_AGENT_DIR: item.agentDir,
    XDG_CONFIG_HOME: item.configHome,
    XDG_DATA_HOME: join(item.home, "unused-data"),
  }
  delete env.OMO_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  delete env.OPENCODE_CONFIG_DIR
  delete env.OPENCODE_CONFIG
  const result = spawnSync(process.execPath, [item.launcher, ...args], { encoding: "utf8", env })
  if (result.error) throw result.error
  return result
}

function mcp(item: Fixture): Record<string, unknown> {
  return JSON.parse(readFileSync(join(item.agentDir, "mcp.json"), "utf8"))
}

describe("omo setup opencode asset import", () => {
  describe("#given global opencode mcp servers and skills", () => {
    describe("#when setup is accepted", () => {
      test("#then they land in the engine's global mcp.json and global skill root", () => {
        const item = fixture()
        opencode(item, {
          mcp: {
            "local-tool": { type: "local", command: ["node", "server.js"], environment: { A: "b" } },
            "remote-tool": { type: "remote", url: "https://example.test/mcp" },
          },
        }, ["migrated-skill"])

        const result = run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(mcp(item)).toEqual({
          mcpServers: {
            "local-tool": { type: "stdio", command: "node", args: ["server.js"], env: { A: "b" } },
            "remote-tool": { type: "http", url: "https://example.test/mcp" },
          },
        })
        expect(existsSync(join(item.agentDir, "skills", "migrated-skill", "SKILL.md"))).toBe(true)
        expect(result.stdout).toContain("mcp-imported: 2")
        expect(result.stdout).toContain("skills-imported: 1")
      })
    })
  })

  describe("#given opencode servers whose values the engine's interpolation would reject", () => {
    describe("#when setup imports the rest", () => {
      test("#then the pinned engine still loads the written mcp.json and every imported server", () => {
        const item = fixture()
        write(join(item.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { mine: { type: "stdio", command: "mine" } } }))
        opencode(item, {
          mcp: {
            bang: { type: "local", command: ["tool", "  !important"] },
            subst: { type: "local", command: ["sh", "-c", "exec $(which tool)"] },
            token: { type: "local", command: ["tool"], environment: { TOKEN: "{env:QA_TOKEN}" } },
            remote: { type: "remote", url: "https://example.test/mcp", headers: { A: "{env:QA_TOKEN}" }, oauth: false },
            off: { type: "local", command: ["off"], enabled: false },
            client: { type: "remote", url: "https://o.test/mcp", oauth: { clientId: "cid", scope: "read write", callbackPort: 19876 } },
            rooted: { type: "local", command: ["tool"], cwd: "/srv/tools" },
          },
        })

        const result = run(item, ["setup", "--yes"])
        const loaded = loadMcpConfig({ agentDir: item.agentDir, cwd: item.home, projectTrusted: false, env: { QA_TOKEN: "t0k" } })

        expect(result.status).toBe(0)
        expect(result.stdout).toContain("mcp server bang")
        expect(result.stdout).toContain("mcp server subst")
        expect(Object.keys(loaded.servers).sort()).toEqual(["client", "mine", "off", "remote", "rooted", "token"])
        expect(loaded.servers.client?.config?.oauth).toEqual({ clientId: "cid", scopes: ["read", "write"], callbackPort: 19876 })
        expect(loaded.servers.rooted?.config?.cwd).toBe("/srv/tools")
        expect(loaded.servers.token?.config?.env).toEqual({ TOKEN: "t0k" })
        expect(loaded.servers.remote?.config?.headers).toEqual({ A: "t0k" })
        expect(loaded.servers.off.state).toBe("disabled")
      })
    })
  })

  describe("#given the engine already has a server and a skill of the same name", () => {
    describe("#when setup is accepted", () => {
      test("#then neither is overwritten and both are reported as skipped", () => {
        const item = fixture()
        const existingMcp = `${JSON.stringify({
          mcpServers: { keep: { type: "stdio", command: "mine" } },
          settings: { toolPrefix: "x" },
        }, null, 2)}\n`
        write(join(item.agentDir, "mcp.json"), existingMcp)
        write(join(item.agentDir, "skills", "keep-skill", "SKILL.md"), "mine\n")
        opencode(item, {
          mcp: {
            keep: { type: "local", command: ["theirs"] },
            fresh: { type: "local", command: ["new"] },
          },
        }, ["keep-skill"])

        const result = run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(mcp(item).mcpServers).toEqual({
          keep: { type: "stdio", command: "mine" },
          fresh: { type: "stdio", command: "new" },
        })
        expect(mcp(item).settings).toEqual({ toolPrefix: "x" })
        expect(readFileSync(join(item.agentDir, "skills", "keep-skill", "SKILL.md"), "utf8")).toBe("mine\n")
        expect(result.stdout).toContain("mcp-skipped-existing: 1")
        expect(result.stdout).toContain("skills-skipped-existing: 1")
        expect(readdirSync(item.agentDir).some((name) => name.startsWith("mcp.json.bak-"))).toBe(true)
      })
    })
  })

  describe("#given an existing mcp.json whose mcpServers is not an object", () => {
    describe("#when setup is accepted", () => {
      test("#then the file is left byte-identical and the servers are reported as not imported", () => {
        const item = fixture()
        const existing = `${JSON.stringify({ mcpServers: [{ command: "x" }] })}\n`
        write(join(item.agentDir, "mcp.json"), existing)
        opencode(item, { mcp: { fresh: { type: "local", command: ["new"] } } })

        const result = run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(readFileSync(join(item.agentDir, "mcp.json"), "utf8")).toBe(existing)
        expect(result.stdout).toContain("malformed mcp.json; these servers were not imported: fresh")
      })
    })
  })

  describe("#given an opencode skill named like a skill the omo plugin bundles", () => {
    describe("#when setup is accepted", () => {
      test("#then it is not copied over the bundled one and is reported as skipped", () => {
        const item = fixture()
        write(join(dirname(dirname(item.launcher)), "plugin", "skills", "git-master", "SKILL.md"), "---\nname: git-master\ndescription: bundled\n---\n")
        opencode(item, { mcp: {} }, ["git-master", "mine-only"])

        const result = run(item, ["setup", "--yes"])

        expect(result.status).toBe(0)
        expect(existsSync(join(item.agentDir, "skills", "git-master"))).toBe(false)
        expect(existsSync(join(item.agentDir, "skills", "mine-only", "SKILL.md"))).toBe(true)
        expect(result.stdout).toContain("skills-skipped-bundled: git-master")
      })
    })
  })

  describe("#given a dry run", () => {
    describe("#when setup previews the assets", () => {
      test("#then nothing is written and the preview names them", () => {
        const item = fixture()
        opencode(item, { mcp: { preview: { type: "local", command: ["x"] } } }, ["preview-skill"])

        const result = run(item, ["setup", "--dry-run"])

        expect(result.status).toBe(0)
        expect(existsSync(join(item.agentDir, "mcp.json"))).toBe(false)
        expect(existsSync(join(item.agentDir, "skills"))).toBe(false)
        expect(result.stdout).toContain("planned-mcp: preview")
        expect(result.stdout).toContain("planned-skills: preview-skill")
      })
    })
  })

  describe("#given setup runs twice", () => {
    describe("#when the second run finds nothing new", () => {
      test("#then the imported files are byte-identical", () => {
        const item = fixture()
        opencode(item, { mcp: { once: { type: "local", command: ["x"] } } }, ["once-skill"])

        run(item, ["setup", "--yes"])
        const afterFirst = readFileSync(join(item.agentDir, "mcp.json"), "utf8")
        const files = readdirSync(item.agentDir)

        const second = run(item, ["setup", "--yes"])

        expect(second.status).toBe(0)
        expect(second.stdout).toContain("mcp-imported: 0")
        expect(readFileSync(join(item.agentDir, "mcp.json"), "utf8")).toBe(afterFirst)
        expect(readdirSync(item.agentDir)).toEqual(files)
      })
    })
  })
})
