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
const TELEMETRY_ENV = "DO_NOT_TRACK=1"
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
  delete scrubbed.CMD_API_KEY
  delete scrubbed.COMMANDCODE_API_KEY
  return scrubbed
}

function run(item: Sandbox, args: string[]): string {
  const result = spawnSync(process.execPath, [LAUNCHER, "setup", ...args], { encoding: "utf8", env: env(item) })
  if (result.error) throw result.error
  expect(result.status).toBe(0)
  return result.stdout
}

// Like run, with extra env vars the home's setup findings are keyed from (never scrubbed: they carry
// no OMO_/OPENCODE_ prefix the scrubber removes).
function runWithEnv(item: Sandbox, keys: Record<string, string>, args: string[]): string {
  const result = spawnSync(process.execPath, [LAUNCHER, "setup", ...args], { encoding: "utf8", env: { ...env(item), ...keys } })
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

  describe("#given a home with no OpenCode config and CMD_API_KEY set", () => {
    // A home with nothing setup can import from OpenCode's config: the Command Code provider is
    // setup's own finding, keyed from the environment.
    function commandCodeUser(): Sandbox {
      const root = mkdtempSync(join(tmpdir(), "omo-setup-summary-cc-"))
      roots.push(root)
      const home = join(root, "home")
      return { home, agentDir: join(home, ".omo", "agent"), omoConfig: join(home, ".omo", "omo.jsonc") }
    }

    test("#when setup runs with --yes #then the Command Code provider is planned, named as its own source, and written to models.json and auth.json", () => {
      // given
      const item = commandCodeUser()

      // when
      const output = runWithEnv(item, { CMD_API_KEY: "SK-CMD-SENTINEL-SUMMARY" }, ["--yes"])

      // then
      expect(output).toContain("Found your Command Code setup")
      expect(output).toContain("commandcode -> https://api.commandcode.ai/provider/v1, 12 models")
      expect(output).toContain("key from environment variable CMD_API_KEY - will be imported")
      // The key env var's value never appears anywhere; the engine interpolates the reference.
      expect(output).not.toContain("SK-CMD-SENTINEL-SUMMARY")
      // The plan has the provider, so the summary includes the optional ZDR hand edit.
      expect(output).toContain("To make the Command Code provider enforce zero data retention, add the header \"x-cmd-zdr: 1\" to its models.json entry by hand.")
      const models = readJson(join(item.agentDir, "models.json")).providers
      expect(Object.keys(models)).toEqual(["commandcode"])
      expect(models.commandcode.baseUrl).toBe("https://api.commandcode.ai/provider/v1")
      expect(models.commandcode.models.length).toBeGreaterThanOrEqual(8)
      expect(readJson(join(item.agentDir, "auth.json")).commandcode).toEqual({ type: "api_key", key: `\${CMD_API_KEY}` })
    })

    test("#when setup is a dry run #then the Command Code provider is announced alongside its guidance", () => {
      // given
      const item = commandCodeUser()

      // when
      const stdout = runWithEnv(item, { CMD_API_KEY: "SK-CMD-SENTINEL-SUMMARY" }, ["--dry-run", "--yes"])

      // then
      expect(stdout).toContain("Found your Command Code setup")
      expect(stdout).toContain("commandcode -> https://api.commandcode.ai/provider/v1")
      expect(existsSync(join(item.home, ".omo"))).toBe(false)
      expect(stdout).toContain("To make the Command Code provider enforce zero data retention, add the header \"x-cmd-zdr: 1\" to its models.json entry by hand.")
    })
  })

  describe("#given a home with no key for Command Code set", () => {
    test("#when setup runs #then no Command Code guidance is printed", () => {
      // given
      const root = mkdtempSync(join(tmpdir(), "omo-setup-summary-cc-"))
      roots.push(root)
      const home = join(root, "home")
      const item: Sandbox = { home, agentDir: join(home, ".omo", "agent"), omoConfig: join(home, ".omo", "omo.jsonc") }

      // when
      const stdout = runWithEnv(item, {}, ["--dry-run", "--yes"])

      // then: no key env var is set and no commandcode entry exists, so the summary names no
      // Command Code guidance at all; no row, no files.
      expect(stdout).not.toContain("To make the Command Code provider enforce zero data retention, add the header \"x-cmd-zdr: 1\" to its models.json entry by hand.")
      expect(existsSync(join(item.home, ".omo"))).toBe(false)
    })
  })

  describe("#given an OpenCode config whose only provider is already in omo's models.json", () => {
    test("#when setup is a dry run #then OpenCode is still named and no Command Code guidance is printed", () => {
      // given: no opencode auth.json, so detection does not install the harness; the provider stage
      // is the only config with something found, and it classifies as nothing added and nothing skipped.
      const root = mkdtempSync(join(tmpdir(), "omo-setup-summary-opencode-providers-"))
      roots.push(root)
      const home = join(root, "home")
      const opencodeDir = join(home, ".config", "opencode")
      write(join(opencodeDir, "opencode.json"), {
        provider: { acme: { options: { baseURL: "https://api.acme.example/v1", apiKey: "acme-key" }, models: { "acme-large": {} } } },
      })
      const agentDir = join(home, ".omo", "agent")
      write(join(agentDir, "models.json"), {
        providers: { acme: { baseUrl: "https://api.acme.example/v1", models: [{ id: "acme-large" }] } },
      })
      const item: Sandbox = { home, agentDir, omoConfig: join(home, ".omo", "omo.jsonc") }

      // when
      const stdout = run(item, ["--dry-run", "--yes"])

      // then
      expect(stdout).toContain("Found your OpenCode setup")
      expect(stdout).toContain("1 already in omo's models.json (acme) - kept as is")
      expect(stdout).not.toContain("Command Code")
    })
  })
})
