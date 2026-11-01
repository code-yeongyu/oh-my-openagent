/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DESKTOP_ENGINE_RELEASE_HOSTS, desktopEngineReleaseAssetName } from "../packages/senpi-desktop-engine/src/release-assets"
import { PLATFORMS } from "./build-binaries"
import { KEYCHAIN_HELPER_RELEASE_ASSET } from "./release-keychain-helper-target"
import { runBlock } from "./release-workflow-test-steps"

const CAPABILITIES = "omo-runtime-capabilities.json"
const CAPABILITIES_BYTES = '{"keychainHandoff":1}\n'
const SPAWN_TIMEOUT_MS = 20_000
const TEST_TIMEOUT_MS = 30_000
const REAL_CAPABILITIES_MODULE = new URL("../packages/omo-opencode/src/cli/service-auth/keychain-helper/runtime-capabilities.ts", import.meta.url)

const publishWorkflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const verifyStep = runBlock(publishWorkflow, "      - name: Verify uploaded assets\n", "      - name: Delete draft release\n")
const uploadStep = runBlock(publishWorkflow, "      - name: Upload release assets\n", "      - name: Verify uploaded assets\n")
const restoreStep = uploadStep.slice(0, uploadStep.indexOf("ls -la .omo/release-binaries/"))

const LAUNCHERS = [
  ...PLATFORMS.map(({ platform }) => `omo-${platform}${platform.startsWith("windows-") ? ".exe" : ""}`),
  KEYCHAIN_HELPER_RELEASE_ASSET,
]
const ENGINES = DESKTOP_ENGINE_RELEASE_HOSTS.map((host) => desktopEngineReleaseAssetName(host) ?? "")

type Files = Record<string, string>

function checksums(files: Files, names: readonly string[]): string {
  return `${names.map((name) => `${createHash("sha256").update(files[name] ?? "").digest("hex")}  ${name}`).join("\n")}\n`
}

function release(extra: Files = {}): Files {
  const files: Files = {}
  for (const name of [...LAUNCHERS, ...ENGINES]) files[name] = `bytes of ${name}\n`
  Object.assign(files, extra)
  files.SHA256SUMS = checksums(files, Object.keys(files).filter((name) => name.startsWith("omo-")).sort())
  files["senpi-desktop-engine-checksums.txt"] = checksums(files, ENGINES)
  return files
}

function fakeGh(bin: string): void {
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "gh"), [
    "#!/bin/bash",
    '[ "$1" = release ] && [ "$2" = download ] || exit 1',
    'shift 3; dir=""; pattern=""',
    'while [ "$#" -gt 0 ]; do case "$1" in --pattern) pattern="$2"; shift 2 ;; --dir) dir="$2"; shift 2 ;; *) exit 2 ;; esac; done',
    'if [ -z "$pattern" ]; then cp "$RELEASE_DIR"/* "$dir/"; exit 0; fi',
    '[ -f "$RELEASE_DIR/$pattern" ] || exit 1',
    'cp "$RELEASE_DIR/$pattern" "$dir/"',
    "",
  ].join("\n"))
  chmodSync(join(bin, "gh"), 0o755)
  if (spawnSync("bash", ["-c", "command -v shasum"], { timeout: SPAWN_TIMEOUT_MS }).status !== 0) {
    writeFileSync(join(bin, "shasum"), '#!/bin/bash\n[ "$1" = -a ] && [ "$2" = 256 ] || exit 2\nshift 2\nexec sha256sum "$@"\n')
    chmodSync(join(bin, "shasum"), 0o755)
  }
}

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly built: readonly string[] }

/** Runs a real step with `released` as the GitHub release and `built` as this run's .omo/release-binaries (null: skip_platform). */
function runStep(step: string, released: Files, built: Files | null, payloadDirs: readonly string[] = []): Run {
  const root = mkdtempSync(join(tmpdir(), "omo-release-assets-"))
  try {
    const releaseDir = join(root, "release")
    mkdirSync(releaseDir)
    for (const [name, bytes] of Object.entries(released)) writeFileSync(join(releaseDir, name), bytes)
    const checkout = join(root, "checkout")
    mkdirSync(checkout)
    if (built !== null) {
      mkdirSync(join(checkout, ".omo", "release-binaries"), { recursive: true })
      for (const [name, bytes] of Object.entries(built)) writeFileSync(join(checkout, ".omo", "release-binaries", name), bytes)
      for (const dir of payloadDirs) {
        mkdirSync(join(checkout, ".omo", "release-binaries", dir))
        writeFileSync(join(checkout, ".omo", "release-binaries", dir, "omo-engine-trust-helper"), "payload\n")
      }
    }
    const stepTemp = join(root, "tmp")
    mkdirSync(stepTemp)
    fakeGh(join(root, "bin"))
    const result = spawnSync("bash", ["-e", "-c", `umask 077\n${step}`], {
      cwd: checkout,
      env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`, RELEASE_DIR: releaseDir, VERSION: "5.0.0", TMPDIR: stepTemp },
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
    })
    const builtDir = join(checkout, ".omo", "release-binaries")
    expect(readdirSync(stepTemp)).toEqual([])
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, built: existsSync(builtDir) ? readdirSync(builtDir).sort() : [] }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const withCapabilities = (bytes: string = CAPABILITIES_BYTES): Files => release({ [CAPABILITIES]: bytes })

describe("Verify uploaded assets compares the release with what the run built (RULING-77)", () => {
  test("a complete release passes with and without the capability file", () => {
    for (const files of [release(), withCapabilities()]) {
      const run = runStep(verifyStep, files, files)
      expect(run.status, run.stderr).toBe(0)
      expect(run.stdout).toContain(`Verified ${Object.keys(files).length} release assets`)
    }
  }, TEST_TIMEOUT_MS)

  test("payload directories the desktop-engine artifact carries are not release assets (#12018)", () => {
    const files = withCapabilities()
    const helpers = ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"].map((host) => `engine-trust-helper-${host}`)
    const run = runStep(verifyStep, files, files, helpers)
    expect(run.status, run.stderr).toBe(0)
    expect(runStep(verifyStep, files, withCapabilities('{"keychainHandoff":1}\n'), helpers).status).toBe(0)
    expect(runStep(verifyStep, release(), files, helpers).status).not.toBe(0)
  }, TEST_TIMEOUT_MS)

  const divergent: ReadonlyArray<readonly [string, Files, Files]> = [
    ["a built file that was not uploaded", release(), withCapabilities()],
    ["an uploaded file the run did not build", withCapabilities(), release()],
    ["a file SHA256SUMS does not list", { ...release(), [CAPABILITIES]: CAPABILITIES_BYTES }, { ...release(), [CAPABILITIES]: CAPABILITIES_BYTES }],
    ["a wrong digest", { ...withCapabilities(), [CAPABILITIES]: '{"keychainHandoff":9}\n' }, withCapabilities()],
    ["wrong capability bytes", withCapabilities('{"keychainHandoff":2}\n'), withCapabilities('{"keychainHandoff":2}\n')],
  ]
  for (const [label, released, built] of divergent) {
    test(`refuses ${label}`, () => {
      expect(runStep(verifyStep, released, built).status).not.toBe(0)
    }, TEST_TIMEOUT_MS)
  }

  test("a skip_platform rerun (nothing built) is held to the floor and the checksum coverage", () => {
    expect(runStep(verifyStep, withCapabilities(), null).status).toBe(0)
    const noEngine = release()
    delete noEngine[ENGINES[0] ?? ""]
    expect(runStep(verifyStep, noEngine, null).status).not.toBe(0)
    expect(runStep(verifyStep, { ...release(), [CAPABILITIES]: CAPABILITIES_BYTES }, null).status).not.toBe(0)
  }, TEST_TIMEOUT_MS)

  test.skipIf(!existsSync(REAL_CAPABILITIES_MODULE))("the file build-omo-binary really writes is required once built", async () => {
    const real: unknown = await import(REAL_CAPABILITIES_MODULE.href)
    const name = Reflect.get(Object(real), "RUNTIME_CAPABILITIES_FILE")
    const text = Reflect.get(Object(real), "runtimeCapabilitiesText")
    if (typeof name !== "string" || typeof text !== "function") throw new Error("runtime-capabilities exports changed")
    const bytes = String(text())
    const built = release({ [name]: bytes })
    expect(runStep(verifyStep, built, built).status).toBe(0)
    expect(runStep(verifyStep, release(), built).status).not.toBe(0)
  }, TEST_TIMEOUT_MS)
})

describe("partial-rerun restore uses what the earlier run published", () => {
  test("restores every SHA256SUMS entry this run did not build, the capability file included", () => {
    const published = withCapabilities()
    const built: Files = { ...published }
    delete built[CAPABILITIES]
    delete built["omo-linux-x64"]
    delete built.SHA256SUMS
    const run = runStep(restoreStep, published, built)
    expect(run.status, run.stderr).toBe(0)
    expect(run.built).toContain(CAPABILITIES)
    expect(run.built).toContain("omo-linux-x64")
  }, TEST_TIMEOUT_MS)

  test("a first run (no SHA256SUMS on the release yet) restores only canonical assets", () => {
    const published = release()
    delete published.SHA256SUMS
    const built: Files = { ...published }
    delete built["omo-linux-x64"]
    const run = runStep(restoreStep, published, built)
    expect(run.status, run.stderr).toBe(0)
    expect(run.built).toContain("omo-linux-x64")
    expect(run.built).not.toContain(CAPABILITIES)
  }, TEST_TIMEOUT_MS)
})

test("no step infers the release contents from source text", () => {
  expect(publishWorkflow).not.toContain("script/build-omo-binary.ts;")
  expect(publishWorkflow).not.toMatch(/grep -qF[^\n]*build-omo-binary/)
})
