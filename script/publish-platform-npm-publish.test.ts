import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Runs the publish job's own helper step exactly as shipped against a fake npm and checks what it does.

interface WorkflowStep {
  readonly name?: string
  readonly run?: string
  readonly "continue-on-error"?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function publishSteps(): WorkflowStep[] {
  const parsed: unknown = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8"),
  )
  const jobs = isRecord(parsed) ? parsed.jobs : undefined
  const publish = isRecord(jobs) ? jobs.publish : undefined
  return isRecord(publish) && Array.isArray(publish.steps) ? publish.steps.filter(isRecord) : []
}

function stepRun(name: string): string {
  const step = publishSteps().find((candidate) => candidate.name === name)
  if (step === undefined || typeof step.run !== "string") throw new Error(`publish job has no runnable step named ${name}`)
  return step.run
}

const TLOG_409 = [
  "npm http fetch POST https://rekor.sigstore.dev/api/v1/log/entries attempt 1 failed with 502",
  "npm http fetch POST https://rekor.sigstore.dev/api/v1/log/entries attempt 2 failed with 409",
  "npm error code TLOG_CREATE_ENTRY_ERROR",
  "npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log",
].join("\n")

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup(outcomes: readonly ("tlog" | "other" | "ok")[], registryHasVersion = false) {
  const root = mkdtempSync(join(tmpdir(), "npm-publish-helper-"))
  roots.push(root)
  const bin = join(root, "bin")
  const pkg = join(root, "pkg")
  spawnSync("mkdir", ["-p", bin, pkg])
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "oh-my-opencode-linux-x64-musl-baseline", version: "9.9.9" }))
  writeFileSync(join(root, "outcomes"), `${outcomes.join("\n")}\n`)
  const npm = join(bin, "npm")
  writeFileSync(
    npm,
    `#!/usr/bin/env bash
if [ "$1" = view ]; then ${registryHasVersion ? 'echo "9.9.9"' : "exit 1"}; exit 0; fi
echo "$* | provenance=\${NPM_CONFIG_PROVENANCE:-unset}" >> "${root}/calls"
outcome="$(head -n 1 "${root}/outcomes")"; sed -i.bak 1d "${root}/outcomes"
case "$outcome" in
  ok) echo "+ published"; exit 0;;
  tlog) printf '%s\\n' ${JSON.stringify(TLOG_409)}; exit 1;;
  *) echo "npm error code E403"; exit 1;;
esac
`,
  )
  chmodSync(npm, 0o755)
  const runnerTemp = join(root, "runner-temp")
  spawnSync("mkdir", ["-p", runnerTemp])
  const write = spawnSync("bash", ["-eo", "pipefail", "-c", stepRun("Write npm publish helper")], {
    env: { ...process.env, RUNNER_TEMP: runnerTemp },
    encoding: "utf8",
  })
  expect(write.status).toBe(0)
  const publish = (distTag: string) =>
    spawnSync("bash", [join(runnerTemp, "npm-publish.sh"), distTag], {
      cwd: pkg,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    })
  const calls = () => readFileSync(join(root, "calls"), "utf8").trim().split("\n")
  return { publish, calls }
}

describe("platform publish helper", () => {
  test("#given npm publishes #when the helper runs #then it publishes once with provenance and the dist tag", () => {
    const { publish, calls } = setup(["ok"])
    const result = publish("latest")
    expect(result.status).toBe(0)
    expect(calls()).toEqual(["publish --access public --loglevel verbose --tag latest --provenance | provenance=true"])
  })

  test("#given Sigstore refuses a re-sent entry (TLOG 409) once #when the helper runs #then it retries once WITH provenance (a fresh signature) and succeeds", () => {
    const { publish, calls } = setup(["tlog", "ok"])
    const result = publish("")
    expect(result.status).toBe(0)
    expect(calls()).toEqual([
      "publish --access public --loglevel verbose --provenance | provenance=true",
      "publish --access public --loglevel verbose --provenance | provenance=true",
    ])
  })

  test("#given the provenance retry also hits the TLOG 409 #when the helper runs #then the last resort publishes without provenance and warns", () => {
    const { publish, calls } = setup(["tlog", "tlog", "ok"])
    const result = publish("")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("without provenance")
    expect(calls()).toEqual([
      "publish --access public --loglevel verbose --provenance | provenance=true",
      "publish --access public --loglevel verbose --provenance | provenance=true",
      "publish --access public --loglevel verbose --provenance=false | provenance=false",
    ])
  })

  test("#given every attempt hits the TLOG 409 #when the helper runs #then it exits non-zero after exactly three attempts", () => {
    const { publish, calls } = setup(["tlog", "tlog", "tlog"])
    expect(publish("").status).not.toBe(0)
    expect(calls()).toHaveLength(3)
  })

  test("#given a TLOG 409 but the version already reached the registry #when the helper runs #then it succeeds without a second publish", () => {
    const { publish, calls } = setup(["tlog"], true)
    expect(publish("").status).toBe(0)
    expect(calls()).toHaveLength(1)
  })

  test("#given any other npm failure #when the helper runs #then it fails without retrying", () => {
    const { publish, calls } = setup(["other", "ok"])
    const result = publish("")
    expect(result.status).not.toBe(0)
    expect(calls()).toHaveLength(1)
  })

  test("#given the two publish steps #when the workflow is read #then neither may continue on error and both use the helper", () => {
    for (const name of ["Publish oh-my-opencode-${{ matrix.platform }}", "Publish oh-my-openagent-${{ matrix.platform }}"]) {
      const step = publishSteps().find((candidate) => candidate.name === name)
      expect(step?.["continue-on-error"]).toBeUndefined()
      expect(step?.run).toContain('bash "$RUNNER_TEMP/npm-publish.sh" "$DIST_TAG"')
      expect(step?.run).not.toContain("npm publish")
      expect(isRecord(step) ? step.env : undefined).not.toHaveProperty("NPM_CONFIG_PROVENANCE")
    }
  })
})
