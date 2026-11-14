import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { load } from "js-yaml"

// #13192: a step that resolves the module graph of repository code reads the generated outputs that are no longer
// tracked, so in every job it must come after that job's build step. This is a rule over every job of every workflow,
// with no per-job data: it catches a step added later to a job the reader classification marked as reading nothing.
// A plain script that imports a generated module is not detected here; the job classification stays the judgment for
// those.
const MODULE_GRAPH_COMMANDS: readonly RegExp[] = [
  // Test runners.
  /\bbun\s+(?:--[\w-]+(?:=\S+)?\s+)*test\b/,
  /\bbun\s+run\s+test(?::[\w-]+)?\b/,
  /\bvitest\b/,
  /\bvp\s+test\b/,
  // Type and graph checkers.
  /\bbun\s+run\s+typecheck[\w:-]*/,
  /\btsc\b/,
  /\btsgo\b/,
  /\bbun\s+check\b/,
  /\bknip\b/,
  // Bundlers and packers.
  /\bbun\s+build\b/,
  /\bbun\s+run\s+build[\w:-]*/,
  /\bbun\s+(?:run\s+)?script\/build-[\w-]+\.ts\b/,
  /\bbun\s+(?:run\s+)?packages\/\S*\/build\.ts\b/,
  /\bnpm\s+pack\b/,
  /\bbun\s+pm\s+pack\b/,
  /\bnpm\s+publish\b/,
  /script\/verify-omo-ai-payload\.mjs/,
]

// A step in the class that runs before (or without) a build of its job, with the reason. An exception is safe when its
// job runs on pull requests: a wrong one turns that job red on the pull request that breaks it. A job that never runs
// on a pull request (publish, release, scheduled) needs a stronger reason, such as the job that built what it consumes.
const UNBUILT_BY_DESIGN =
  "runs unbuilt by design on every pull request: no typechecked project includes a file that imports a generated output and knip ignores untracked outputs, so a new such import fails this job on the pull request that adds it"

const MODULE_GRAPH_EXCEPTIONS: ReadonlyArray<{
  readonly job: string
  readonly command: RegExp
  readonly reason: string
}> = [
  { job: "ci.yml typecheck", command: /^bun run typecheck$/, reason: UNBUILT_BY_DESIGN },
  { job: "ci.yml typecheck", command: /^bun run knip:check$/, reason: UNBUILT_BY_DESIGN },
  {
    job: "desktop-engine.yml native-contract",
    command: /bun test script\/desktop-engine-release\.test\.ts/,
    reason: "release asset assembly tests import release scripts only, no generated output",
  },
  {
    job: "desktop-engine.yml native-contract",
    command: /bun run test:desktop/,
    reason: "the desktop package's own tests; that package imports no generated output",
  },
  {
    job: "desktop-engine.yml native-contract",
    command: /bun test packages\/omo-native\/test\/macos-trust-helper\.macos\.test\.ts/,
    reason: "drives the compiled macOS trust helper through its decoder; no generated output on its path",
  },
  {
    job: "engine-trust-helper.yml windows-helper",
    command: /bun test --timeout \d+ test\/windows-trust-helper\.test\.ts/,
    reason: "tests the Windows helper's output through its decoder inside the package directory",
  },
  {
    job: "compiled-worker.yml relocated-worker",
    command: /^bun test$/,
    reason: "runs in a scratch directory holding three copied source files, not the repository",
  },
  {
    job: "computer-engine.yml native-contract",
    command: /bun run test:computer/,
    reason: "the computer engine package's own tests; that package imports no generated output",
  },
  {
    job: "linux-trust-containers.yml linux-trust",
    command: /bun test --timeout \d+ packages\/omo-native\/test\/linux-trust-containers\.test\.ts/,
    reason: "drives the compiled engine inside distro containers; no generated output on its path",
  },
  {
    job: "publish-platform.yml keychain-helper",
    command: /bun packages\/omo-native\/keychain-helper\/build\.ts/,
    reason: "builds the native keychain helper from Swift sources; it imports no generated output",
  },
  {
    job: "publish-platform.yml publish",
    command: /npm publish "\$\{args\[@\]\}"/,
    reason: "consumes the platform packages built by job build (needs: build), which builds the generated files first",
  },
]

export interface ModuleGraphStep {
  readonly job: string
  readonly step: string
  readonly command: string
}

type RawStep = { readonly name?: unknown; readonly run?: unknown }

const commandLines = (run: string): string[] =>
  run
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

// A .github/scripts/*.sh a step calls counts by its own command lines; echo/printf text and assignments of string
// literals only name a command and do not run it.
function scriptResolvesModuleGraph(scriptsDir: string, script: string, builds: RegExp): boolean {
  let text: string
  try {
    text = readFileSync(join(scriptsDir, script), "utf8")
  } catch {
    return false
  }
  return commandLines(text).some(
    (line) => !/^(?:echo|printf)\b/.test(line) && !/^[\w-]+=["']/.test(line) && inClass(line, builds),
  )
}

const inClass = (line: string, builds: RegExp): boolean =>
  !builds.test(line) && MODULE_GRAPH_COMMANDS.some((pattern) => pattern.test(line))

export function moduleGraphStepsBeforeBuild(workflowsDir: string, builds: RegExp): ModuleGraphStep[] {
  const scriptsDir = join(workflowsDir, "..", "scripts")
  const found: ModuleGraphStep[] = []
  for (const name of readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file))) {
    const parsed: unknown = load(readFileSync(join(workflowsDir, name), "utf8").replace(/\r\n/g, "\n"))
    const jobs: Record<string, { steps?: RawStep[] }> =
      parsed !== null && typeof parsed === "object" && "jobs" in parsed ? Object(parsed.jobs) : {}
    for (const [jobName, definition] of Object.entries(jobs)) {
      const job = `${name} ${jobName}`
      let built = false
      for (const step of definition?.steps ?? []) {
        const run = typeof step.run === "string" ? step.run : ""
        for (const line of built ? [] : commandLines(run)) {
          const script = /\.github\/scripts\/([\w.-]+\.sh)/.exec(line)?.[1]
          const resolves =
            inClass(line, builds) || (script !== undefined && scriptResolvesModuleGraph(scriptsDir, script, builds))
          const excepted = MODULE_GRAPH_EXCEPTIONS.some((entry) => entry.job === job && entry.command.test(line))
          if (resolves && !excepted)
            found.push({ job, step: typeof step.name === "string" ? step.name : "(unnamed)", command: line })
        }
        if (builds.test(run)) built = true
      }
    }
  }
  return found
}
