/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Execute the actual release step: registry replies and elapsed time are the only stubs.
// This owns the 55-minute propagation regression (#9492) and all-main-package contract (#9778).
type Step = { name?: string; run?: string; env?: Record<string, string> }
const workflow = Bun.YAML.parse(readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")) as {
  jobs: Record<string, { outputs?: Record<string, string>; steps: Step[] }>
}
const readiness = workflow.jobs["post-publish-verify"].steps.find((step) => step.name?.endsWith("registry readiness"))!
const READINESS_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 15_000
const releaseSha = "1234567890abcdef1234567890abcdef12345678"
const names = ["omo-ai", "oh-my-opencode", "oh-my-openagent", "lazycodex-ai"] as const

type PackageName = typeof names[number]
type RegistryState = { version?: string; tagVersion?: string; gitHead?: string; metadataAfter?: number; tarballAfter?: number; status?: number }
type Scenario = {
  registry?: Partial<Record<PackageName, RegistryState>>
  skipped?: Partial<Record<PackageName, boolean>>
  lazycodexOnly?: boolean
  publishLazycodex?: boolean
  prerelease?: boolean
  rootTag?: string
  probeSeconds?: number
}

function runReadiness(scenario: Scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "publish-readiness-"))
  try {
    const version = scenario.prerelease ? `5.0.0-${scenario.rootTag ?? "beta"}.42` : "5.1.27"
    const omoVersion = scenario.prerelease ? `5.0.0-0.${scenario.rootTag ?? "beta"}.42` : "5.1.27"
    const tag = scenario.prerelease ? "beta" : "latest"
    const rootTag = scenario.rootTag ?? tag
    const source: Record<string, string> = {
      "inputs.lazycodex_only": String(scenario.lazycodexOnly ?? false),
      "inputs.publish_lazycodex": String(scenario.publishLazycodex ?? true),
      "needs.release-metadata.outputs.version": version,
      "needs.release-metadata.outputs.dist_tag": scenario.prerelease ? rootTag : "",
      "needs.release-metadata.outputs.omo_ai_version": omoVersion,
      "needs.release-metadata.outputs.omo_ai_dist_tag": tag,
      "needs.release-metadata.outputs.already_published": String(scenario.skipped?.["omo-ai"] ?? false),
      "needs.prepare-release-state.outputs.release_sha": releaseSha,
      "steps.check.outputs.skip": String(scenario.skipped?.["oh-my-opencode"] ?? scenario.lazycodexOnly ?? false),
      "steps.check-openagent.outputs.skip": String(scenario.skipped?.["oh-my-openagent"] ?? scenario.lazycodexOnly ?? false),
      "steps.check-lazycodex.outputs.skip": String(scenario.skipped?.["lazycodex-ai"] ?? false),
    }
    const resolve = (expression: string): string => {
      const key = expression.match(/^\$\{\{\s*(.*?)\s*\}\}$/)?.[1]
      if (!key || !(key in source)) throw new Error(`Unresolved workflow binding: ${expression}`)
      return source[key]
    }
    for (const [key, expression] of Object.entries(workflow.jobs["publish-main"].outputs ?? {})) {
      source[`needs.publish-main.outputs.${key}`] = resolve(expression)
    }
    const env = Object.fromEntries(Object.entries(readiness.env ?? {}).map(([key, expression]) => [key, resolve(expression)]))
    writeFileSync(join(root, "registry"), names.map((name) => {
      const state = scenario.registry?.[name] ?? {}
      const expected = name === "omo-ai" ? omoVersion : version
      return [name, state.version ?? expected, name === "omo-ai" ? tag : rootTag, state.tagVersion ?? expected, state.gitHead ?? releaseSha,
        state.metadataAfter ?? 0, state.tarballAfter ?? 0, state.status ?? 200].map((value) => value === "" ? "-" : value).join(" ")
    }).join("\n") + "\n")
    for (const name of ["clock", "slept"]) writeFileSync(join(root, name), "0")
    writeFileSync(join(root, "calls"), "")
    // Bash functions work on Git Bash too; executable PATH stubs do not support shebangs there.
    const stubs = String.raw`
clock() { local value; IFS= read -r value < "$FIXTURE/clock" || :; printf '%s' "$value"; }
advance() { printf '%s' "$(($(clock) + $1))" > "$FIXTURE/clock"; }
date() { clock; }
sleep() { local value; IFS= read -r value < "$FIXTURE/slept" || :; printf '%s' "$((value + $1))" > "$FIXTURE/slept"; advance "$1"; }
timeout() {
  local budget="$1"; shift
  if [ "$PROBE_SECONDS" -gt "$budget" ]; then advance "$budget"; return 124; fi
  "$@"
}
lookup() {
  while read -r name version tag tag_version git_head metadata_after tarball_after http_status; do
    [ "$name" = "$1" ] && return 0
  done < "$FIXTURE/registry"
  return 1
}
npm() {
  while [[ "$1" == view || "$1" == --* ]]; do shift; done
  local spec="$1" field="$2" name version tag tag_version git_head metadata_after tarball_after http_status
  printf 'npm %s %s\n' "$spec" "$field" >> "$FIXTURE/calls"
  advance "$PROBE_SECONDS"
  lookup "${"$"}{spec%%@*}" || return 1
  [ "$(clock)" -ge "$metadata_after" ] || return 0
  if [[ "$spec" == *@* && "${"$"}{spec#*@}" != "$version" ]]; then return 0; fi
  case "$field" in
    version) printf '%s\n' "$version" ;;
    gitHead) [ "$git_head" = - ] || printf '%s\n' "$git_head" ;;
    dist.tarball) printf 'https://registry.npmjs.org/%s/-/%s-%s.tgz\n' "$name" "$name" "$version" ;;
    "dist-tags.$tag") printf '%s\n' "$tag_version" ;;
  esac
  return 0
}
curl() {
  local url="${"$"}{@: -1}" name version tag tag_version git_head metadata_after tarball_after http_status
  local package="${"$"}{url#https://registry.npmjs.org/}"
  printf 'curl %s\n' "$url" >> "$FIXTURE/calls"
  lookup "${"$"}{package%%/*}" || return 1
  [ "$(clock)" -ge "$tarball_after" ] || http_status=404
  # Preserve --fail's transport outcome, including successful non-200 replies such as 204.
  if [[ "$*" == *--write-out* ]]; then printf '%s' "$http_status"; fi
  [ "$http_status" -lt 400 ]
}
export -f clock advance date sleep timeout lookup npm curl
`
    const script = join(root, "readiness.sh")
    writeFileSync(script, stubs + readiness.run)
    const result = spawnSync("bash", [script], {
      encoding: "utf8", timeout: READINESS_TEST_TIMEOUT_MS - 1_000,
      env: { ...process.env, ...env, FIXTURE: root, PROBE_SECONDS: String(scenario.probeSeconds ?? 0) },
    })
    if (result.error) throw result.error
    return {
      status: result.status ?? -1, output: result.stdout + result.stderr,
      calls: readFileSync(join(root, "calls"), "utf8").trim().split("\n").filter(Boolean),
      elapsed: Number(readFileSync(join(root, "clock"), "utf8")),
      slept: Number(readFileSync(join(root, "slept"), "utf8")),
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe("publish.yml post-publish-verify registry readiness", () => {
  test.each([false, true])("#given all packages served (prerelease=%s) #when verified #then each exact version, own channel and release gitHead is checked", (prerelease) => {
    const outcome = runReadiness({ prerelease })
    expect(outcome.status).toBe(0)
    for (const name of names) {
      const version = prerelease ? name === "omo-ai" ? "5.0.0-0.beta.42" : "5.0.0-beta.42" : "5.1.27"
      for (const field of ["version", "dist.tarball", "gitHead"]) expect(outcome.calls).toContain(`npm ${name}@${version} ${field}`)
      expect(outcome.calls).toContain(`npm ${name} dist-tags.${prerelease ? "beta" : "latest"}`)
      expect(outcome.calls).toContain(`curl https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`)
    }
  }, READINESS_TEST_TIMEOUT_MS)

  test("#given omo-ai ready but two siblings never served #when the common budget expires #then every missing package is named", () => {
    const outcome = runReadiness({ registry: { "oh-my-opencode": { metadataAfter: 999999 }, "oh-my-openagent": { metadataAfter: 999999 } } })
    expect(outcome.status).toBe(1)
    for (const name of ["oh-my-opencode", "oh-my-openagent"]) expect(outcome.output).toContain(`::error::${name}@5.1.27`)
    expect(outcome.slept).toBeGreaterThanOrEqual(55 * 60)
    expect(outcome.elapsed).toBeLessThanOrEqual(60 * 60)
    expect(outcome.calls.filter((call) => call === "npm omo-ai@5.1.27 version")).toHaveLength(1)
  }, READINESS_TEST_TIMEOUT_MS)

  test.each([300, 55 * 60])("#given delayed sibling metadata and tarball (%s s) #when readiness polls #then it waits for both", (delay) => {
    const outcome = runReadiness({ registry: { "oh-my-opencode": { metadataAfter: delay }, "lazycodex-ai": { tarballAfter: delay } } })
    expect(outcome.status).toBe(0)
    expect(outcome.slept).toBe(delay)
  }, READINESS_TEST_TIMEOUT_MS)

  test.each([...names])("#given %s has a different gitHead #when version and tarball are served #then verification fails", (name) => {
    const outcome = runReadiness({ registry: { [name]: { gitHead: "abcdef1234567890abcdef1234567890abcdef12" } } })
    expect(outcome.status).toBe(1)
    expect(outcome.output).toContain(`::error::${name}@5.1.27`)
    expect(outcome.output).toContain("gitHead")
  }, READINESS_TEST_TIMEOUT_MS)

  test.each([
    ["missing gitHead", { gitHead: "" }], ["wrong dist-tag", { tagVersion: "5.1.26" }],
    ["wrong exact version", { version: "5.1.26" }], ["missing tarball", { status: 404 }], ["non-200 tarball", { status: 204 }],
  ] as const)("#given a sibling has %s #when verified #then it cannot turn the release green", (_, state) => {
    const outcome = runReadiness({ registry: { "oh-my-openagent": state } })
    expect(outcome.status).toBe(1)
    expect(outcome.output).toContain("::error::oh-my-openagent@5.1.27")
  }, READINESS_TEST_TIMEOUT_MS)

  test("#given already-published packages and disabled LazyCodex #when rerun #then only immutable enabled packages are checked", () => {
    const outcome = runReadiness({ publishLazycodex: false, skipped: { "omo-ai": true, "oh-my-opencode": true, "oh-my-openagent": true }, registry: { "omo-ai": { tagVersion: "5.1.29" } } })
    expect(outcome.status).toBe(0)
    expect(outcome.calls.filter((call) => call.startsWith("npm "))).toEqual(
      names.filter((name) => name !== "lazycodex-ai").flatMap((name) =>
        ["version", "dist.tarball", "gitHead"].map((field) => `npm ${name}@5.1.27 ${field}`)),
    )
  }, READINESS_TEST_TIMEOUT_MS)

  test.each([false, true])("#given LazyCodex-only (skipped=%s) #when verified #then unrelated packages are not probed", (skipped) => {
    const outcome = runReadiness({ lazycodexOnly: true, skipped: { "lazycodex-ai": skipped } })
    expect(outcome.status).toBe(0)
    expect(outcome.calls.every((call) => call.includes("lazycodex-ai"))).toBe(true)
    expect(outcome.calls.length).toBe(skipped ? 4 : 5)
  }, READINESS_TEST_TIMEOUT_MS)


  test("#given already-published sibling metadata but a missing tarball #when rerun #then immutable readiness still fails", () => {
    const outcome = runReadiness({ skipped: { "oh-my-openagent": true }, registry: { "oh-my-openagent": { tagVersion: "5.1.29", status: 404 } } })
    expect(outcome.status).toBe(1)
    expect(outcome.output).toContain("::error::oh-my-openagent@5.1.27")
    expect(outcome.calls).not.toContain("npm oh-my-openagent dist-tags.latest")
  }, READINESS_TEST_TIMEOUT_MS)

  test("#given a root next channel and mapped omo-ai beta #when readiness runs #then each published channel is checked", () => {
    const outcome = runReadiness({ prerelease: true, rootTag: "next" })
    expect(outcome.status).toBe(0)
    expect(outcome.calls).toContain("npm omo-ai dist-tags.beta")
    for (const name of names.filter((name) => name !== "omo-ai")) expect(outcome.calls).toContain(`npm ${name} dist-tags.next`)
  }, READINESS_TEST_TIMEOUT_MS)

  test("#given slow probes and a source mismatch #when the final sleep reaches the deadline #then diagnostics retain the observed gitHead", () => {
    const wrongHead = "abcdef1234567890abcdef1234567890abcdef12"
    const outcome = runReadiness({ probeSeconds: 10, registry: { "oh-my-openagent": { gitHead: wrongHead } } })
    expect(outcome.status).toBe(1)
    expect(outcome.output).toContain(`gitHead=${wrongHead} (expected ${releaseSha})`)
  }, READINESS_TEST_TIMEOUT_MS)

  test("#given registry requests consume time #when a sibling stays missing #then probes and sleeps share one hour", () => {
    const outcome = runReadiness({ probeSeconds: 10, registry: { "oh-my-openagent": { metadataAfter: 999999 } } })
    expect(outcome.status).toBe(1)
    expect(outcome.elapsed).toBeGreaterThanOrEqual(55 * 60)
    expect(outcome.elapsed).toBeLessThanOrEqual(60 * 60)
  }, READINESS_TEST_TIMEOUT_MS)
})
