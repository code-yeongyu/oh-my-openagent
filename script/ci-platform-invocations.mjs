import { readFileSync } from "node:fs"

// Every path a macOS/Windows-only CI step names is platform-specific without
// being listed by hand (#10856). A step is macOS/Windows-only when its `if:`
// selects that runner (or the macOS/Windows-only Codex platform suite), or when
// its job runs only on macOS/Windows (an OS matrix with no ubuntu leg, or a
// literal macOS/Windows `runs-on`). A `.github/scripts/*.sh` script such a step
// runs is read one level deep, so commands moved into a script stay covered;
// `.ps1` scripts, nested script calls, and paths outside the roots in
// `pathToken` are not followed. A named test covers its stem followed by `.`,
// `-`, `_` or the end of the name, so the sibling helpers it imports
// (`scheduler-frontier.ts` for `scheduler.test.ts`) stay covered while an
// unrelated `schedulers.ts` does not.
const platformCondition = /runner\.os == 'Windows'|runner\.os == 'macOS'|matrix\.suite == 'platform'/
const pathToken = /(?<=(?:^|[^\w/.$-])(?:\$\{?\w+\}?\/|\}\}\/)?)(?:\.\/)?((?:packages|script|\.github|bin|crates)\/[A-Za-z0-9_.@/-]*[A-Za-z0-9_-]|bunfig[\w.-]*\.toml)/g
const jobHeader = /^ {2}[A-Za-z0-9_-]+:\s*$/
const literalPlatformRunner = /^ {4}runs-on:\s*["']?(?:macos|windows)[\w.-]*["']?\s*$/
const ciScript = /^\.github\/scripts\/[\w.-]+\.sh$/
const stepStart = /^ {6}- /
const testFile = /^(.*?)(?:\.(?:windows|win32|darwin|macos|platform))?\.test\.[cm]?[jt]s$/
// `packages/<name>` and `packages/<name>/<dir>` are suite partitions a leg passes
// to `bun test`, not code that only one operating system exercises.
const suitePartition = /^packages\/[^/]+(?:\/[^/]+)?$/

function matrixOses(jobLines) {
  return jobLines.flatMap((line) => {
    const listed = /^\s+os:\s*\[(.*)\]\s*$/.exec(line)
    if (listed?.[1] !== undefined) return listed[1].split(",").map((os) => os.trim())
    const single = /^\s+(?:-\s+)?os:\s*([\w.-]+)\s*$/.exec(line)
    return single?.[1] === undefined ? [] : [single[1]]
  })
}

function splitBlocks(lines, startsBlock) {
  const blocks = []
  for (const line of lines) {
    if (startsBlock.test(line) || blocks.length === 0) blocks.push([])
    blocks[blocks.length - 1].push(line)
  }
  return blocks
}

export function platformOnlyStepTexts(workflowText) {
  const lines = workflowText.split("\n")
  const jobsAt = lines.indexOf("jobs:")
  if (jobsAt === -1) throw new Error("workflow has no top-level jobs: block")
  return splitBlocks(lines.slice(jobsAt + 1), jobHeader).flatMap((job) => {
    const oses = matrixOses(job)
    const jobIsPlatformOnly =
      job.some((line) => literalPlatformRunner.test(line)) || (oses.length > 0 && oses.every((os) => /macos|windows/.test(os)))
    return splitBlocks(job, stepStart)
      .filter((step) => stepStart.test(step[0] ?? ""))
      .filter((step) => jobIsPlatformOnly || step.some((line) => /^\s+if:/.test(line) && platformCondition.test(line)))
      .map((step) => step.join("\n"))
  })
}

function coverageOf(token) {
  const basename = token.slice(token.lastIndexOf("/") + 1)
  const test = testFile.exec(basename)
  if (test?.[1] !== undefined) return { kind: "stem", value: token.slice(0, token.length - basename.length) + test[1] }
  if (basename.includes(".")) return { kind: "exact", value: token }
  if (suitePartition.test(token)) return null
  return { kind: "prefix", value: `${token}/` }
}

function namedPaths(text) {
  return [...text.matchAll(pathToken)].map((match) => match[1])
}

export function platformInvocationCoverage(workflowText, readScript = () => "") {
  const stepTokens = platformOnlyStepTexts(workflowText).flatMap(namedPaths)
  const scriptTokens = stepTokens.filter((token) => ciScript.test(token)).flatMap((script) => namedPaths(readScript(script)))
  return [...new Set([...stepTokens, ...scriptTokens])].flatMap((token) => {
    const coverage = coverageOf(token)
    return coverage === null ? [] : [coverage]
  })
}

export function coveredByInvocation(path, coverage) {
  return coverage.some((entry) => {
    switch (entry.kind) {
      case "exact":
        return path === entry.value
      case "prefix":
        return path.startsWith(entry.value)
      case "stem":
        return path.startsWith(entry.value) && /^(?:[._-]|$)/.test(path.slice(entry.value.length))
    }
    throw new Error(`unknown coverage kind ${entry.kind}`)
  })
}

export function readCiInvocationCoverage() {
  const readRepoFile = (path) => {
    try {
      return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    } catch (error) {
      throw new Error(`ci.yml names ${path} in a macOS/Windows-only step, but it cannot be read`, { cause: error })
    }
  }
  return platformInvocationCoverage(readRepoFile(".github/workflows/ci.yml"), readRepoFile)
}
