import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { runProfileClear, runProfileCurrent, runProfileList, runProfileUse } from "./profile"

const CONFIG_WITH_PROFILES = `{
  // preserve this comment
  "profiles": {
    "kimi": { "categories": { "quick": { "model": "kimi-model" } } },
    "gpt": { "categories": { "quick": { "model": "gpt-model" } } }
  }
}
`

type Fixture = {
  readonly configPath: string
  readonly cwd: string
  readonly environment: Record<string, string | undefined>
}

const fixtureRoots = new Set<string>()

afterEach(() => {
  for (const root of fixtureRoots) rmSync(root, { force: true, recursive: true })
  fixtureRoots.clear()
})

function makeFixture(config: string, projectConfig?: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-profile-cli-"))
  fixtureRoots.add(root)
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "work")
  const configPath = join(homeDir, ".omo", "omo.jsonc")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(configPath, config)
  if (projectConfig !== undefined) {
    mkdirSync(join(cwd, ".omo"), { recursive: true })
    writeFileSync(join(cwd, ".omo", "omo.jsonc"), projectConfig)
  }
  return { configPath, cwd, environment: { HOME: homeDir } }
}

function capture(): { readonly lines: string[]; readonly write: (line: string) => void } {
  const lines: string[] = []
  return { lines, write: (line: string): void => void lines.push(line) }
}

describe("omo profile", () => {
  test("#given unsorted profiles #when listing #then sorted names are printed without an active marker", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    const exitCode = runProfileList({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    expect(exitCode).toBe(0)
    expect(output.lines).toEqual(["Profiles:", "  gpt", "  kimi"])
  })

  test("#given a defined profile #when using it #then active_profile persists and comments survive", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    const exitCode = runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    const written = readFileSync(fixture.configPath, "utf-8")
    expect(exitCode).toBe(0)
    expect(written).toContain(`"active_profile": "gpt"`)
    expect(written).toContain("// preserve this comment")
    expect(output.lines.join("\n")).toContain(`Activated profile "gpt"`)
  })

  test("#given OMO_PROFILE wins #when using another profile #then persisted and effective states are both reported", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    const exitCode = runProfileUse("gpt", {
      cwd: fixture.cwd,
      environment: { ...fixture.environment, OMO_PROFILE: "kimi" },
      output: output.write,
    })

    expect(exitCode).toBe(0)
    expect(readFileSync(fixture.configPath, "utf-8")).toContain(`"active_profile": "gpt"`)
    expect(output.lines.join("\n")).toContain(`Active profile remains "kimi" (from OMO_PROFILE).`)
  })

  test("#given an unknown profile #when using it #then the command fails without changing config", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const errors = capture()

    const exitCode = runProfileUse("missing", {
      cwd: fixture.cwd,
      environment: fixture.environment,
      errorOutput: errors.write,
    })

    expect(exitCode).toBe(1)
    expect(errors.lines.join("\n")).toContain(`Unknown profile "missing"`)
    expect(errors.lines.join("\n")).toContain("gpt, kimi")
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(CONFIG_WITH_PROFILES)
  })

  test("#given an empty profile name #when using it #then the command fails without changing config", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const errors = capture()

    const exitCode = runProfileUse("", {
      cwd: fixture.cwd,
      environment: fixture.environment,
      errorOutput: errors.write,
    })

    expect(exitCode).toBe(1)
    expect(errors.lines.join("\n")).toContain("Profile name must not be empty")
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(CONFIG_WITH_PROFILES)
  })

  test("#given a project-only profile #when using it #then persistence is rejected without changing user config", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES, `{
      "profiles": { "local": { "categories": { "quick": { "model": "local-model" } } } }
    }`)
    const output = capture()
    const errors = capture()

    const listExitCode = runProfileList({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })
    const useExitCode = runProfileUse("local", {
      cwd: fixture.cwd,
      environment: fixture.environment,
      errorOutput: errors.write,
    })

    expect(listExitCode).toBe(0)
    expect(output.lines).toContain("  local (project only)")
    expect(useExitCode).toBe(1)
    expect(errors.lines.join("\n")).toContain(`Profile "local" is defined only in project config`)
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(CONFIG_WITH_PROFILES)
  })

  test("#given malformed config #when running profile commands #then each fails without base or success output", () => {
    const fixture = makeFixture(`{ "profiles": {`)
    const commands = [
      (output: ReturnType<typeof capture>, errors: ReturnType<typeof capture>) => runProfileList({ cwd: fixture.cwd, environment: fixture.environment, output: output.write, errorOutput: errors.write }),
      (output: ReturnType<typeof capture>, errors: ReturnType<typeof capture>) => runProfileCurrent({ cwd: fixture.cwd, environment: fixture.environment, output: output.write, errorOutput: errors.write }),
      (output: ReturnType<typeof capture>, errors: ReturnType<typeof capture>) => runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: output.write, errorOutput: errors.write }),
      (output: ReturnType<typeof capture>, errors: ReturnType<typeof capture>) => runProfileClear({ cwd: fixture.cwd, environment: fixture.environment, output: output.write, errorOutput: errors.write }),
    ]

    for (const command of commands) {
      const output = capture()
      const errors = capture()

      const exitCode = command(output, errors)

      expect(exitCode).toBe(1)
      expect(output.lines).toEqual([])
      expect(errors.lines.join("\n")).toContain("JSONC parse error")
    }
  })

  test("#given a missing environment-selected profile #when listing, showing current, or clearing #then base is effective", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const environment = { ...fixture.environment, OMO_PROFILE: "missing" }
    const listOutput = capture()
    const currentOutput = capture()
    const clearOutput = capture()

    expect(runProfileList({ cwd: fixture.cwd, environment, output: listOutput.write, errorOutput: capture().write })).toBe(0)
    expect(runProfileCurrent({ cwd: fixture.cwd, environment, output: currentOutput.write, errorOutput: capture().write })).toBe(0)
    expect(runProfileClear({ cwd: fixture.cwd, environment, output: clearOutput.write, errorOutput: capture().write })).toBe(0)
    expect(listOutput.lines.join("\n")).not.toContain("missing")
    expect(listOutput.lines.some((line) => line.startsWith("*"))).toBe(false)
    expect(currentOutput.lines).toEqual(["No active profile (using the base config)."])
    expect(clearOutput.lines.join("\n")).toContain("already using the base config")
    expect(clearOutput.lines.join("\n")).not.toContain("missing")
  })

  test("#given a missing persisted profile #when clearing #then it is removed and base remains effective", () => {
    const fixture = makeFixture(`{
      "active_profile": "missing",
      "profiles": { "gpt": { "categories": { "quick": { "model": "gpt-model" } } } }
    }`)
    const output = capture()

    const exitCode = runProfileClear({ cwd: fixture.cwd, environment: fixture.environment, output: output.write, errorOutput: capture().write })

    expect(exitCode).toBe(0)
    expect(readFileSync(fixture.configPath, "utf-8")).not.toContain("active_profile")
    expect(output.lines.join("\n")).toContain("No active profile (using the base config).")
    expect(output.lines.join("\n")).not.toContain("Active profile remains")
  })

  test("#given persisted state #when asking for current #then the selected name and origin print", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: capture().write })
    const output = capture()

    const exitCode = runProfileCurrent({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("gpt (persisted")
  })

  test("#given no selection #when asking for current #then base config is reported", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const output = capture()

    const exitCode = runProfileCurrent({ cwd: fixture.cwd, environment: fixture.environment, output: output.write })

    expect(exitCode).toBe(0)
    expect(output.lines.join("\n")).toContain("No active profile")
  })

  test("#given persisted state and OMO_PROFILE #when clearing #then only persisted state is removed", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    runProfileUse("gpt", { cwd: fixture.cwd, environment: fixture.environment, output: capture().write })
    const output = capture()

    const exitCode = runProfileClear({
      cwd: fixture.cwd,
      environment: { ...fixture.environment, OMO_PROFILE: "kimi" },
      output: output.write,
    })

    expect(exitCode).toBe(0)
    expect(readFileSync(fixture.configPath, "utf-8")).not.toContain("active_profile")
    expect(output.lines.join("\n")).toContain(`Active profile remains "kimi" (from OMO_PROFILE).`)
  })

  test("#given nothing persisted #when clearing twice #then both clears succeed without writes", () => {
    const fixture = makeFixture(CONFIG_WITH_PROFILES)
    const first = capture()
    const second = capture()

    const firstExitCode = runProfileClear({ cwd: fixture.cwd, environment: fixture.environment, output: first.write })
    const secondExitCode = runProfileClear({ cwd: fixture.cwd, environment: fixture.environment, output: second.write })

    expect(firstExitCode).toBe(0)
    expect(secondExitCode).toBe(0)
    expect(first.lines.join("\n")).toContain("No persisted profile")
    expect(second.lines.join("\n")).toContain("No persisted profile")
    expect(readFileSync(fixture.configPath, "utf-8")).toBe(CONFIG_WITH_PROFILES)
  })
})
