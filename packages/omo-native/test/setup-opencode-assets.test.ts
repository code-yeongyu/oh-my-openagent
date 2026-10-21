import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { planOpencodeAssets } from "../bin/lib/setup-opencode-assets.js"
import { teardownRoots } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => teardownRoots(roots))

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function fixture(config: unknown, options: { jsonc?: string, skills?: string[], referenceObjects?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omo-assets-"))
  roots.push(root)
  const home = join(root, "home")
  const configDir = join(root, "config", "opencode")
  mkdirSync(home, { recursive: true })
  if (options.jsonc !== undefined) write(join(configDir, "opencode.jsonc"), options.jsonc)
  if (config !== undefined) write(join(configDir, "opencode.json"), JSON.stringify(config, null, 2))
  for (const name of options.skills ?? []) {
    write(join(configDir, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n\nbody\n`)
  }
  return planOpencodeAssets({
    home,
    env: { XDG_CONFIG_HOME: join(root, "config") },
    ...(options.referenceObjects === undefined ? {} : { referenceObjects: options.referenceObjects }),
  })
}

describe("opencode asset plan", () => {
  describe("#given a local mcp server", () => {
    describe("#when it is planned", () => {
      test("#then the command array splits into the engine's command and args", () => {
        const plan = fixture({
          mcp: {
            "my-tool": {
              type: "local",
              command: ["bun", "x", "my-mcp", "--flag"],
              environment: { TOKEN: "{env:MY_TOKEN}" },
              enabled: false,
            },
          },
        })

        expect(plan.mcpServers).toEqual([{
          name: "my-tool",
          config: {
            type: "stdio",
            command: "bun",
            args: ["x", "my-mcp", "--flag"],
            env: { TOKEN: "${MY_TOKEN}" },
            enabled: false,
          },
        }])
      })
    })
  })

  describe("#given a local mcp server with a working directory", () => {
    describe("#when it is planned", () => {
      test("#then the cwd carries over so the server starts where opencode started it", () => {
        const plan = fixture({ mcp: { rooted: { type: "local", command: ["./bin/server"], cwd: "/srv/tools" } } })

        expect(plan.mcpServers).toEqual([{ name: "rooted", config: { type: "stdio", command: "./bin/server", cwd: "/srv/tools" } }])
      })
    })
  })

  describe("#given a remote mcp server", () => {
    describe("#when it is planned", () => {
      test("#then it becomes an http server and an explicit oauth opt-out is preserved", () => {
        const plan = fixture({
          mcp: {
            remote: { type: "remote", url: "https://example.test/mcp", headers: { A: "b" }, oauth: false },
          },
        })

        expect(plan.mcpServers).toEqual([{
          name: "remote",
          config: { type: "http", url: "https://example.test/mcp", headers: { A: "b" }, auth: false },
        }])
      })
    })
  })

  describe("#given a remote mcp server with a pre-registered oauth client", () => {
    describe("#when it is planned", () => {
      test("#then the client id, scopes and callback port carry over and a client secret is reported", () => {
        const plan = fixture({
          mcp: {
            gh: { type: "remote", url: "https://gh.test/mcp", oauth: { clientId: "cid", clientSecret: "s3cret", scope: "repo read:org", callbackPort: 19876 } },
          },
        })

        expect(plan.mcpServers).toEqual([{
          name: "gh",
          config: { type: "http", url: "https://gh.test/mcp", oauth: { clientId: "cid", callbackPort: 19876, scopes: ["repo", "read:org"] } },
        }])
        expect(plan.notices.join("\n")).toContain("gh oauth clientSecret")
        expect(plan.notices.join("\n")).not.toContain("s3cret")
      })
    })
  })

  describe("#given a value the engine's interpolation rejects", () => {
    describe("#when it is planned", () => {
      test("#then the server is dropped with a notice instead of breaking every mcp load", () => {
        const plan = fixture({
          mcp: {
            risky: { type: "local", command: ["sh", "-c", "echo $(whoami)"] },
            safe: { type: "local", command: ["true"] },
          },
        })

        expect(plan.mcpServers.map((server) => server.name)).toEqual(["safe"])
        expect(plan.notices.join("\n")).toContain("risky")
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["risky"])
      })
    })
  })

  describe("#given placeholders in an mcp server", () => {
    describe("#when the engine supports reference objects", () => {
      test("#then a {file:...} header becomes a $concat object with the path intact", () => {
        const plan = fixture({
          mcp: {
            "header-from-file": {
              type: "remote",
              url: "https://f.test/mcp",
              headers: { Authorization: "Bearer {file:~/.creds/dgx/litellm-key}" },
            },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([{
          name: "header-from-file",
          config: {
            type: "http",
            url: "https://f.test/mcp",
            headers: { Authorization: { $concat: ["Bearer ", { $file: "~/.creds/dgx/litellm-key" }] } },
          },
        }])
        expect(plan.refusedServers).toEqual([])
      })

      test("#then a bare {file:...} header becomes the reference object itself, not a one-element concat", () => {
        const plan = fixture({
          mcp: {
            "bare-file": {
              type: "remote",
              url: "https://f.test/mcp",
              headers: { Authorization: "{file:/abs/path/to/secret}" },
            },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([{
          name: "bare-file",
          config: {
            type: "http",
            url: "https://f.test/mcp",
            headers: { Authorization: { $file: "/abs/path/to/secret" } },
          },
        }])
      })

      test("#then a {env:NAME} environment value becomes a $env object", () => {
        const plan = fixture({
          mcp: {
            "env-value": { type: "local", command: ["tool"], environment: { TOKEN: "{env:MY_TOKEN}" } },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([{
          name: "env-value",
          config: { type: "stdio", command: "tool", env: { TOKEN: { $env: "MY_TOKEN" } } },
        }])
      })

      test("#then a relative {file:...} path is made absolute against the opencode config directory", () => {
        const plan = fixture({
          mcp: {
            "relative-file": {
              type: "remote",
              url: "https://f.test/mcp",
              headers: { Authorization: "{file:./local-secret.txt}" },
            },
          },
        }, { referenceObjects: true })

        const authorization = (plan.mcpServers[0].config as any).headers.Authorization
        expect(authorization.$file).toBeTypeOf("string")
        expect(authorization.$file.startsWith("/")).toBe(true)
        expect(authorization.$file.endsWith("/local-secret.txt")).toBe(true)
      })

      test("#then a {env:MY-TOKEN} placeholder is refused with a named message", () => {
        const plan = fixture({
          mcp: {
            "dashed-env": { type: "local", command: ["tool"], environment: { TOKEN: "{env:MY-TOKEN}" } },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([])
        expect(plan.notices.join("\n")).toContain("MY-TOKEN")
        expect(plan.notices.join("\n")).toContain("not a valid environment variable name")
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["dashed-env"])
      })

      test("#then a placeholder in a url is refused", () => {
        const plan = fixture({
          mcp: {
            "url-placeholder": { type: "remote", url: "https://{env:HOST}/mcp" },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["url-placeholder"])
        expect(plan.refusedServers[0].reason).toContain("url")
      })

      test("#then a {file:...} in the executable is reported, not written", () => {
        const plan = fixture({
          mcp: {
            "command-file": { type: "local", command: ["{file:/abs/path}", "tool"] },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["command-file"])
        expect(plan.refusedServers[0].reason).toContain("command")
        expect(plan.notices.join("\n")).toContain("not supported in this field")
      })

      test("#then a {file:...} in an argument becomes a reference object, because args[] accepts references", () => {
        const plan = fixture({
          mcp: {
            "args-file": { type: "local", command: ["tool", "{file:/abs/path}"] },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([{
          name: "args-file",
          config: { type: "stdio", command: "tool", args: [{ $file: "/abs/path" }] },
        }])
        expect(plan.refusedServers).toEqual([])
      })

      test("#then a {file:...} in oauth.clientId is refused, because that field does not accept references", () => {
        const plan = fixture({
          mcp: {
            "oauth-file": {
              type: "remote",
              url: "https://f.test/mcp",
              oauth: { clientId: "{file:/abs/path}", callbackPort: 19876 },
            },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([])
        expect(plan.notices.join("\n")).toContain("not supported in this field")
      })

      test("#then a malformed {env:NAME} in oauth.clientId is refused with the named message", () => {
        const plan = fixture({
          mcp: {
            "oauth-env": {
              type: "remote",
              url: "https://f.test/mcp",
              oauth: { clientId: "{env:MY-TOKEN}", callbackPort: 19876 },
            },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([])
        expect(plan.notices.join("\n")).toContain("not a valid environment variable name")
      })

      test("#then a complete mcp document with a reference in every field still produces a valid config", () => {
        const plan = fixture({
          mcp: {
            complete: {
              type: "remote",
              url: "https://f.test/mcp",
              headers: { Authorization: "Bearer {file:/abs/key}" },
              oauth: { clientId: "cid", callbackPort: 19876, scope: "repo" },
            },
            local: {
              type: "local",
              command: ["tool", "--flag", "a", "b"],
              cwd: "/srv/work",
              environment: { TOKEN: "{env:MY_TOKEN}" },
            },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([
          {
            name: "complete",
            config: {
              type: "http",
              url: "https://f.test/mcp",
              headers: { Authorization: { $concat: ["Bearer ", { $file: "/abs/key" }] } },
              oauth: { clientId: "cid", callbackPort: 19876, scopes: ["repo"] },
            },
          },
          {
            name: "local",
            config: {
              type: "stdio",
              command: "tool",
              args: ["--flag", "a", "b"],
              env: { TOKEN: { $env: "MY_TOKEN" } },
              cwd: "/srv/work",
            },
          },
        ])
        expect(plan.refusedServers).toEqual([])
      })
    })

    describe("#when the engine does not support reference objects", () => {
      test("#then a {file:...} reference is refused and the server is not imported", () => {
        const plan = fixture({
          mcp: {
            "file-header": { type: "remote", url: "https://f.test/mcp", headers: { Authorization: "{file:/abs/key}" } },
            plain: { type: "local", command: ["tool"], environment: { TOKEN: "{env:MY_TOKEN}" } },
          },
        }, { referenceObjects: false })

        expect(plan.mcpServers).toEqual([
          { name: "plain", config: { type: "stdio", command: "tool", env: { TOKEN: "${MY_TOKEN}" } } },
        ])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["file-header"])
        expect(plan.notices.join("\n")).toContain("file-header")
      })

      test("#then an empty {file:} placeholder is refused with a named message", () => {
        const plan = fixture({
          mcp: {
            "empty-file": { type: "remote", url: "https://f.test/mcp", headers: { Authorization: "{file:}" } },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([])
        expect(plan.notices.join("\n")).toContain("not a valid file path")
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["empty-file"])
      })

      test("#then a {env:MY-TOKEN} placeholder is refused with a named message", () => {
        const plan = fixture({
          mcp: {
            "dashed-env": { type: "local", command: ["tool"], environment: { TOKEN: "{env:MY-TOKEN}" } },
          },
        }, { referenceObjects: false })

        expect(plan.mcpServers).toEqual([])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["dashed-env"])
      })

      test("#then a config with no placeholder in it gets no engine-version notice", () => {
        const plan = fixture({
          mcp: { plain: { type: "remote", url: "https://f.test/mcp", headers: { A: "b" } } },
        }, { referenceObjects: false })

        expect(plan.notices).toEqual([])
      })
    })
  })

  describe("#given a literal value in an mcp server", () => {
    describe("#when it is planned", () => {
      test("#then a literal holding $ is written unescaped, as the mcp importer wrote it before", () => {
        const plan = fixture({
          mcp: {
            "literal-dollar": {
              type: "remote",
              url: "https://f.test/mcp",
              headers: { Authorization: "Bearer sk-abc$def" },
            },
          },
        }, { referenceObjects: false })

        expect(plan.mcpServers).toEqual([{
          name: "literal-dollar",
          config: {
            type: "http",
            url: "https://f.test/mcp",
            headers: { Authorization: "Bearer sk-abc$def" },
          },
        }])
      })

      test("#then the reference-object shape writes the same literal the plain-string shape writes", () => {
        const config = {
          mcp: {
            "literal-dollar": {
              type: "remote",
              url: "https://f.test/mcp",
              headers: { Authorization: "Bearer sk-abc$def" },
            },
          },
        }

        expect(fixture(config, { referenceObjects: true }).mcpServers).toEqual(
          fixture(config, { referenceObjects: false }).mcpServers,
        )
      })

      test("#then a literal the engine would read as a command still refuses the server", () => {
        const plan = fixture({
          mcp: {
            "literal-command": {
              type: "remote",
              url: "https://f.test/mcp",
              headers: { "X-Api-Key": "!curl evil.test" },
            },
          },
        }, { referenceObjects: true })

        expect(plan.mcpServers).toEqual([])
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["literal-command"])
      })
    })
  })

  describe("#given an opencode.jsonc with comments and a trailing comma", () => {
    describe("#when it is planned", () => {
      test("#then it parses", () => {
        const plan = fixture(undefined, {
          jsonc: `{\n  // a comment\n  "mcp": {\n    "c": { "type": "remote", "url": "https://c.test/mcp" },\n  },\n}\n`,
        })

        expect(plan.mcpServers.map((server) => server.name)).toEqual(["c"])
      })
    })
  })

  describe("#given a url containing // inside an opencode.jsonc string", () => {
    describe("#when it is planned", () => {
      test("#then the scheme separator is not treated as a comment", () => {
        const plan = fixture(undefined, {
          jsonc: `{\n  "mcp": {\n    "u": { "type": "remote", "url": "https://example.test/mcp" } // trailing\n  }\n}\n`,
        })

        expect(plan.mcpServers).toEqual([{
          name: "u",
          config: { type: "http", url: "https://example.test/mcp" },
        }])
      })
    })
  })

  describe("#given an opencode.jsonc whose string values contain a comma before a closing bracket", () => {
    describe("#when it needs the comment scan", () => {
      test("#then the string data survives the trailing-comma removal byte for byte", () => {
        const plan = fixture(undefined, {
          jsonc: `{\n  // forces the jsonc path\n  "mcp": {\n    "s": { "type": "local", "command": ["run", "a,]", "b, }",], },\n  },\n}\n`,
        })

        expect(plan.mcpServers).toEqual([{ name: "s", config: { type: "stdio", command: "run", args: ["a,]", "b, }"] } }])
      })
    })
  })

  describe("#given an opencode.jsonc saved with a UTF-8 byte order mark", () => {
    describe("#when it is planned", () => {
      test("#then it parses instead of reporting an unrecognized token", () => {
        const plan = fixture(undefined, {
          jsonc: `\uFEFF{\n  "mcp": { "b": { "type": "remote", "url": "https://b.test/mcp" }, },\n}\n`,
        })

        expect(plan.notices).toEqual([])
        expect(plan.mcpServers.map((server) => server.name)).toEqual(["b"])
      })
    })
  })

  describe("#given both an opencode.json and an opencode.jsonc", () => {
    describe("#when they are planned", () => {
      test("#then both are read and merged the way opencode merges them, jsonc last", () => {
        const plan = fixture({
          mcp: {
            "from-json": { type: "local", command: ["json-tool"] },
            shared: { type: "local", command: ["shared-tool"], environment: { A: "1" } },
          },
        }, {
          jsonc: `{\n  // jsonc layer\n  "mcp": {\n    "from-jsonc": { "type": "remote", "url": "https://c.test/mcp" },\n    "shared": { "enabled": false, "environment": { "B": "2" } },\n  },\n}\n`,
        })

        expect(plan.notices).toEqual([])
        expect(plan.mcpServers).toEqual([
          { name: "from-json", config: { type: "stdio", command: "json-tool" } },
          { name: "shared", config: { type: "stdio", command: "shared-tool", env: { A: "1", B: "2" }, enabled: false } },
          { name: "from-jsonc", config: { type: "http", url: "https://c.test/mcp" } },
        ])
      })
    })
  })

  describe("#given an opencode.json that does not parse next to a valid opencode.jsonc", () => {
    describe("#when they are planned", () => {
      test("#then the broken file is reported and the jsonc servers still import", () => {
        const root = mkdtempSync(join(tmpdir(), "omo-assets-"))
        roots.push(root)
        const configDir = join(root, "config", "opencode")
        write(join(configDir, "opencode.json"), "{ not json")
        write(join(configDir, "opencode.jsonc"), `{ "mcp": { "ok": { "type": "local", "command": ["ok"] } } }`)

        const plan = planOpencodeAssets({ home: join(root, "home"), env: { XDG_CONFIG_HOME: join(root, "config") } })

        expect(plan.mcpServers.map((server) => server.name)).toEqual(["ok"])
        expect(plan.notices.join("\n")).toContain("opencode.json")
      })
    })
  })

  describe("#given OPENCODE_CONFIG_DIR set next to the global config dir", () => {
    describe("#when they are planned", () => {
      test("#then the global dir is still read and the explicit dir and ~/.opencode layer on top", () => {
        const root = mkdtempSync(join(tmpdir(), "omo-assets-"))
        roots.push(root)
        const home = join(root, "home")
        const globalDir = join(root, "config", "opencode")
        const profileDir = join(root, "profile")
        write(join(globalDir, "opencode.json"), JSON.stringify({ mcp: { global: { type: "local", command: ["g"] }, shared: { type: "local", command: ["from-global"] } } }))
        write(join(profileDir, "opencode.jsonc"), `{ "mcp": { "profile": { "type": "local", "command": ["p"] }, "shared": { "command": ["from-profile"] }, }, }`)
        write(join(globalDir, "skills", "global-skill", "SKILL.md"), "---\nname: global-skill\ndescription: g\n---\n")
        write(join(home, ".opencode", "skill", "dot-skill", "SKILL.md"), "---\nname: dot-skill\ndescription: d\n---\n")
        write(join(profileDir, "skills", "profile-skill", "SKILL.md"), "---\nname: profile-skill\ndescription: p\n---\n")

        const plan = planOpencodeAssets({ home, env: { XDG_CONFIG_HOME: join(root, "config"), OPENCODE_CONFIG_DIR: profileDir } })

        expect(plan.mcpServers).toEqual([
          { name: "global", config: { type: "stdio", command: "g" } },
          { name: "shared", config: { type: "stdio", command: "from-profile" } },
          { name: "profile", config: { type: "stdio", command: "p" } },
        ])
        expect(plan.skills.map((skill) => skill.name)).toEqual(["dot-skill", "global-skill", "profile-skill"])
      })
    })
  })

  describe("#given global opencode skills", () => {
    describe("#when they are planned", () => {
      test("#then each skill directory is listed by name", () => {
        const plan = fixture({}, { skills: ["alpha", "beta"] })

        expect(plan.skills.map((skill) => skill.name)).toEqual(["alpha", "beta"])
      })
    })
  })

  describe("#given skill dirs the engine would not load", () => {
    describe("#when they are planned", () => {
      test("#then each is left out with a notice naming it and the valid skill still imports", () => {
        const root = mkdtempSync(join(tmpdir(), "omo-assets-"))
        roots.push(root)
        const skills = join(root, "config", "opencode", "skills")
        write(join(skills, "no-skill-file", "README.md"), "not a skill\n")
        write(join(skills, "no-description", "SKILL.md"), "---\nname: no-description\n---\n\nbody\n")
        write(join(skills, "good", "SKILL.md"), "---\nname: good\ndescription: fine\n---\n")

        const plan = planOpencodeAssets({ home: join(root, "home"), env: { XDG_CONFIG_HOME: join(root, "config") } })

        expect(plan.skills.map((skill) => skill.name)).toEqual(["good"])
        expect(plan.notices.join("\n")).toContain("skill no-skill-file has no SKILL.md")
        expect(plan.notices.join("\n")).toContain("skill no-description has no description")
        expect(plan.skippedSkills.map((skill: { name: string }) => skill.name).sort()).toEqual(["no-description", "no-skill-file"])
      })
    })
  })

  describe("#given no opencode config at all", () => {
    describe("#when it is planned", () => {
      test("#then the plan is empty and silent", () => {
        const plan = fixture(undefined)

        expect(plan).toEqual({ mcpServers: [], refusedServers: [], skills: [], skippedSkills: [], notices: [] })
      })
    })
  })
})
