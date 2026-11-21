import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { teardownRoots } from "./teardown.test-support"

// The real launcher: the model-choice stage reads the engine's model catalog through the installed senpi.
const LAUNCHER = resolve(fileURLToPath(new URL("../bin/omo.js", import.meta.url)))
const TTY_DRIVER = resolve(fileURLToPath(new URL("tty-driver.py", import.meta.url)))
const TELEMETRY_ENV = "OMO_SEND_ANONYMOUS_TELEMETRY=0"
const PLAN_PROMPT = "[Y/n]"
const STAGE_PROMPT = "[y/N]"
const NOT_IMPORTED = "Non-interactive setup did not import"
const roots: string[] = []

afterEach(() => teardownRoots(roots))

type Sandbox = { home: string, agentDir: string, omoConfig: string }

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2))
}

// One item of every class the summary covers: an API key and an OAuth login, an MCP server and a
// refused one, a skill and a broken one, a custom provider, and a default model on that provider.
function opencodeUser(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "omo-setup-summary-"))
  roots.push(root)
  const home = join(root, "home")
  const opencodeDir = join(home, ".config", "opencode")
  write(join(home, ".local", "share", "opencode", "auth.json"), {
    google: { type: "api", key: "g-key" },
    anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
  })
  write(join(opencodeDir, "opencode.json"), {
    model: "acme/acme-large",
    provider: { acme: { options: { baseURL: "https://api.acme.example/v1", apiKey: "acme-key" }, models: { "acme-large": {} } } },
    mcp: {
      context7: { type: "remote", url: "https://mcp.context7.com/mcp" },
      shelly: { type: "local", command: ["sh", "-c", "echo $(whoami)"] },
    },
  })
  write(join(opencodeDir, "skills", "release-notes", "SKILL.md"), "---\nname: release-notes\ndescription: notes\n---\nbody\n")
  write(join(opencodeDir, "skills", "broken", "README.md"), "not a skill\n")
  return { home, agentDir: join(home, ".omo", "agent"), omoConfig: join(home, ".omo", "omo.jsonc") }
}

function env(item: Sandbox): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...process.env, HOME: item.home, USERPROFILE: item.home }
  for (const name of Object.keys(scrubbed)) {
    if (/^(OMO_|SENPI_|PI_|OPENCODE_|XDG_)/.test(name) || name.endsWith("_CODING_AGENT_DIR")) delete scrubbed[name]
  }
  return scrubbed
}

function run(item: Sandbox, args: string[]): string {
  const result = spawnSync(process.execPath, [LAUNCHER, "setup", ...args], { encoding: "utf8", env: env(item) })
  if (result.error) throw result.error
  expect(result.status).toBe(0)
  return result.stdout
}

// On a real pty, answering the first prompt that carries `marker`.
function runOnTerminal(item: Sandbox, answer: string, marker: string): string {
  const result = spawnSync("python3", [TTY_DRIVER, answer, marker, process.execPath, LAUNCHER, "setup"], { encoding: "utf8", env: env(item) })
  if (result.error) throw result.error
  expect(result.status).toBe(0)
  return result.stdout
}

function occurrences(text: string, token: string): number {
  return text.split(token).length - 1
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"))
}

describe("omo setup migration summary", () => {
  describe("#given an OpenCode user with logins, MCP servers, skills, a custom provider and a model choice", () => {
    test.skipIf(process.platform === "win32")("#when setup runs on a terminal and the user accepts the default #then one consent imports every class", () => {
      // given
      const item = opencodeUser()

      // when
      const output = runOnTerminal(item, "\n", PLAN_PROMPT)

      // then
      expect(occurrences(output, PLAN_PROMPT)).toBe(1)
      expect(occurrences(output, STAGE_PROMPT)).toBe(0)
      expect(occurrences(output, TELEMETRY_ENV)).toBe(1)
      expect(readJson(join(item.agentDir, "auth.json"))).toEqual({
        google: { type: "api_key", key: "g-key" },
        acme: { type: "api_key", key: "acme-key" },
      })
      expect(Object.keys(readJson(join(item.agentDir, "mcp.json")).mcpServers)).toEqual(["context7"])
      expect(readdirSync(join(item.agentDir, "skills"))).toEqual(["release-notes"])
      expect(Object.keys(readJson(join(item.agentDir, "models.json")).providers)).toEqual(["acme"])
      expect(readJson(join(item.agentDir, "settings.json"))).toEqual({ defaultProvider: "acme", defaultModel: "acme-large" })
      expect(output).toContain("model-choices-carried: default model, model_profile")
      // Harnesses that are not installed get no row, and a real plan gets no placeholder template.
      expect(output).not.toContain("gajae-code")
      expect(output).not.toContain("oh-my-pi")
      expect(output).not.toContain("<custom-baseUrl-provider>")
    })

    test("#when setup is a dry run #then it prints the plan, asks nothing and writes nothing", () => {
      // given
      const item = opencodeUser()

      // when: --yes as well, so only the dry run keeps the files unwritten
      const stdout = run(item, ["--dry-run", "--yes"])

      // then
      expect(existsSync(join(item.home, ".omo"))).toBe(false)
      expect(occurrences(stdout, PLAN_PROMPT)).toBe(0)
      expect(occurrences(stdout, NOT_IMPORTED)).toBe(0)
      expect(occurrences(stdout, TELEMETRY_ENV)).toBe(1)
      for (const line of ["planned-add: google", "planned-mcp: context7", "planned-skills: release-notes", "planned-providers: acme", "planned-model-choices: default model, model_profile"]) {
        expect(stdout).toContain(line)
      }
    })

    test("#when setup runs non-interactively #then the whole plan is declined once, and --ask-each declines each class on its own", () => {
      // given
      const item = opencodeUser()

      // when
      const whole = run(item, [])
      const each = run(item, ["--ask-each"])

      // then: credentials, MCP servers and skills, custom providers. The default model names acme,
      // which the declined provider stage does not write, so the model choice is re-planned away.
      expect(occurrences(whole, NOT_IMPORTED)).toBe(1)
      expect(occurrences(each, NOT_IMPORTED)).toBe(3)
      expect(each).toContain("model choice not carried: default model acme/acme-large")
      expect(existsSync(join(item.home, ".omo"))).toBe(false)
    })

    test("#when setup runs again after importing #then there is nothing to consent to and no file changes", () => {
      // given
      const item = opencodeUser()
      run(item, ["--yes"])
      const files = ["auth.json", "mcp.json", "models.json", "settings.json"].map((name) => join(item.agentDir, name)).concat(item.omoConfig)
      const before = files.map((path) => readFileSync(path, "utf8"))

      // when: no --yes, so any pending class would print the non-interactive refusal
      const stdout = run(item, [])

      // then
      expect(occurrences(stdout, NOT_IMPORTED)).toBe(0)
      expect(occurrences(stdout, TELEMETRY_ENV)).toBe(1)
      expect(files.map((path) => readFileSync(path, "utf8"))).toEqual(before)
      expect(stdout).toContain("imported: 0")
      expect(stdout).toContain("mcp-imported: 0")
    })
  })
})
