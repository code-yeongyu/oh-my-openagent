import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
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

// A `{file:...}` reference is refused unless the file is readable by this user alone, so every
// fixture secret is created with its mode set explicitly rather than left at umask default.
function writeFileRef(path: string, content: string, mode = 0o600): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  chmodSync(path, mode)
  return path
}

type FileRefFixture = { root: string, home: string, configHome: string, secretsDir: string }

// XDG_CONFIG_HOME is the real machine's unset case, so `~/.config/opencode` and the XDG root are the
// same directory here and a `~`-rooted reference means what it means for the user.
function fileRefFixture(): FileRefFixture {
  const root = mkdtempSync(join(tmpdir(), "omo-assets-"))
  roots.push(root)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  return { root, home, configHome: join(home, ".config"), secretsDir: join(home, ".config", "opencode", "secrets") }
}

// One remote MCP server whose only value is the referenced file, so a test asserts the file's fate
// and nothing else the conversion does.
function fileRefPlan(item: FileRefFixture, reference: string, options: { allowlistRoots?: string[] } = {}) {
  write(join(item.configHome, "opencode", "opencode.json"), JSON.stringify({
    mcp: { probe: { type: "remote", url: "https://f.test/mcp", headers: { Authorization: `{file:${reference}}` } } },
  }))
  return planOpencodeAssets({ home: item.home, env: {}, fileRefAllowlistRoots: options.allowlistRoots })
}

function refusals(plan: ReturnType<typeof planOpencodeAssets>): { reference: string, reason: string }[] {
  return plan.refusedFileRefs
}

function fixture(config: unknown, options: { jsonc?: string, skills?: string[] } = {}) {
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
  return planOpencodeAssets({ home, env: { XDG_CONFIG_HOME: join(root, "config") } })
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

  describe("#given placeholders the engine has no spelling for", () => {
    describe("#when they are planned", () => {
      test("#then those servers are refused with a notice instead of carrying literal placeholder text", () => {
        const plan = fixture({
          mcp: {
            "file-header": { type: "remote", url: "https://f.test/mcp", headers: { Authorization: "Bearer {file:~/.secrets/token}" } },
            "dashed-env": { type: "local", command: ["tool"], environment: { TOKEN: "{env:MY-TOKEN}" } },
            plain: { type: "local", command: ["tool"], environment: { TOKEN: "{env:MY_TOKEN}" } },
          },
        })

        expect(plan.mcpServers).toEqual([{ name: "plain", config: { type: "stdio", command: "tool", env: { TOKEN: "${MY_TOKEN}" } } }])
        expect(plan.notices.join("\n")).toContain("file-header")
        expect(plan.notices.join("\n")).toContain("dashed-env")
        expect(plan.refusedServers.map((server: { name: string }) => server.name)).toEqual(["file-header", "dashed-env"])
      })
    })
  })

  describe("#given a remote mcp server whose header references an allowlisted file via {file:...}", () => {
    describe("#when it is planned", () => {
      test("#then the file's trimmed contents replace the placeholder and the server imports verbatim", () => {
        const item = fileRefFixture()
        const secretPath = writeFileRef(join(item.secretsDir, "token"), "Bearer real-token\n")

        const plan = fileRefPlan(item, secretPath)

        expect(plan.mcpServers).toEqual([{
          name: "probe",
          config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: "Bearer real-token" } },
        }])
        expect(plan.refusedServers).toEqual([])
      })

      test("#then the resolved reference is reported with the canonical path it read", () => {
        const item = fileRefFixture()
        writeFileRef(join(item.secretsDir, "token"), "Bearer canonical")

        const plan = fileRefPlan(item, "~/.config/opencode/secrets/token")

        expect(plan.resolvedFileRefs).toEqual([{
          reference: "~/.config/opencode/secrets/token",
          source: join(item.secretsDir, "token"),
        }])
        expect(plan.refusedFileRefs).toEqual([])
      })

      test("#then a leading ~ expands against the caller-provided home, never os.homedir()", () => {
        const item = fileRefFixture()
        writeFileRef(join(item.secretsDir, "tilde-token"), "Bearer tilde-token")

        const plan = fileRefPlan(item, "~/.config/opencode/secrets/tilde-token")

        expect(plan.mcpServers).toEqual([{
          name: "probe",
          config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: "Bearer tilde-token" } },
        }])
        expect(plan.refusedServers).toEqual([])
      })
    })
  })

  describe("#given a {file:...} reference the allowlist refuses", () => {
    describe("#when it is planned", () => {
      test("#then a denylisted prefix is denied, and no allowlist entry can widen it", () => {
        const item = fileRefFixture()

        const plan = fileRefPlan(item, "/proc/self/environ", { allowlistRoots: ["/proc", join(item.configHome, "opencode")] })

        expect(plan.mcpServers).toEqual([])
        expect(refusals(plan)).toEqual([{ reference: "/proc/self/environ", reason: "denied" }])
      })

      test("#then an existing file outside every allowlist root is outside_allowlist", () => {
        const item = fileRefFixture()
        const outside = writeFileRef(join(item.root, "outside-token"), "Bearer outside")

        const plan = fileRefPlan(item, outside)

        expect(plan.mcpServers).toEqual([])
        expect(refusals(plan)).toEqual([{ reference: outside, reason: "outside_allowlist" }])
        expect(plan.notices.join("\n")).toContain(outside)
      })

      test("#then a symlink under the allowlist is refused rather than followed to its target", () => {
        const item = fileRefFixture()
        const linkPath = join(item.secretsDir, "hostname-link")
        mkdirSync(item.secretsDir, { recursive: true })
        symlinkSync("/etc/hostname", linkPath)

        const plan = fileRefPlan(item, linkPath)

        expect(plan.mcpServers).toEqual([])
        expect(refusals(plan)).toEqual([{ reference: linkPath, reason: "symlink" }])
      })

      test("#then a group-or-other-readable secret is too_permissive", () => {
        const item = fileRefFixture()
        const secretPath = writeFileRef(join(item.secretsDir, "loose-token"), "Bearer loose", 0o644)

        const plan = fileRefPlan(item, secretPath)

        expect(plan.mcpServers).toEqual([])
        expect(refusals(plan)).toEqual([{ reference: secretPath, reason: "too_permissive" }])
      })

      test("#then a path under the allowlist that does not exist is missing", () => {
        const item = fileRefFixture()
        const absent = join(item.secretsDir, "absent")

        const plan = fileRefPlan(item, absent)

        expect(plan.mcpServers).toEqual([])
        expect(refusals(plan)).toEqual([{ reference: absent, reason: "missing" }])
      })

      test("#then a file that holds only whitespace is missing, since it holds no secret", () => {
        const item = fileRefFixture()
        const emptyPath = writeFileRef(join(item.secretsDir, "empty"), "   \n\n")

        const plan = fileRefPlan(item, emptyPath)

        expect(plan.mcpServers).toEqual([])
        expect(refusals(plan)).toEqual([{ reference: emptyPath, reason: "missing" }])
        expect(plan.notices.join("\n")).toContain("probe")
      })

      test("#then a relative reference is outside_allowlist, since setup's cwd is not a stable anchor", () => {
        const item = fileRefFixture()

        const plan = fileRefPlan(item, "./local-secret.txt")

        expect(plan.mcpServers).toEqual([])
        expect(refusals(plan)).toEqual([{ reference: "./local-secret.txt", reason: "outside_allowlist" }])
      })
    })
  })

  describe("#given security.file_ref_allowlist_roots naming an extra root", () => {
    describe("#when a reference inside it is planned", () => {
      test("#then it resolves, so a user can widen the allowlist without a new release", () => {
        const item = fileRefFixture()
        const extraRoot = join(item.root, "extra")
        const secretPath = writeFileRef(join(extraRoot, "key"), "Bearer extra-token")

        const plan = fileRefPlan(item, secretPath, { allowlistRoots: [join(item.configHome, "opencode"), extraRoot] })

        expect(plan.mcpServers).toEqual([{
          name: "probe",
          config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: "Bearer extra-token" } },
        }])
        expect(plan.refusedFileRefs).toEqual([])
      })

      test("#then a ~-rooted entry is expanded against the caller-provided home", () => {
        const item = fileRefFixture()
        const extraRoot = join(item.home, ".vendor-secrets")
        const secretPath = writeFileRef(join(extraRoot, "key"), "Bearer home-extra")

        const plan = fileRefPlan(item, secretPath, { allowlistRoots: ["~/.vendor-secrets"] })

        expect(plan.mcpServers).toEqual([{
          name: "probe",
          config: { type: "http", url: "https://f.test/mcp", headers: { Authorization: "Bearer home-extra" } },
        }])
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

        expect(plan).toEqual({ mcpServers: [], refusedServers: [], skills: [], skippedSkills: [], refusedFileRefs: [], resolvedFileRefs: [], notices: [] })
      })
    })
  })
})
