/// <reference types="bun-types" />

import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import {
  DESKTOP_ENGINE_RELEASE_HOSTS,
  desktopEngineReleaseAssetName,
} from "../packages/senpi-desktop-engine/src/release-assets"
import { writeDesktopEngineChecksums } from "./desktop-engine-release"
import { writeFixture } from "./fixtures/operator-darwin-artifacts"

/**
 * Release asset contract (#13921): with operator_darwin_artifacts set, release v<ver> still carries
 * senpi-desktop-engine-checksums.txt with all six engines (the desktop fetch refuses a file missing any host),
 * and its darwin lines are the verified operator engines. Replays the operator-darwin staging step and its
 * upload-artifact steps from the parsed publish-platform.yml, the release job's `desktop-engine-*` download
 * from publish.yml, and the release's own checksum writer.
 */

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, string> }
type Workflow = { jobs: Record<string, { steps?: Step[] }> }
const load = (file: string): Workflow =>
  Bun.YAML.parse(
    readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"),
  ) as Workflow
const steps = (workflow: Workflow, job: string): Step[] => workflow.jobs[job]?.steps ?? []

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test("operator mode publishes senpi-desktop-engine-checksums.txt with the verified darwin engines and the hosted ones", () => {
  const fixture = writeFixture()
  const root = mkdtempSync(join(tmpdir(), "operator-darwin-release-"))
  scratch.push(fixture.dir, root)

  // operator-darwin: stage the verified files under the hosted artifact layout, then "upload" each artifact.
  const operator = steps(load("publish-platform.yml"), "operator-darwin")
  const stage =
    operator.find((step) => step.name === "Stage verified artifacts under the hosted artifact layout")?.run ?? ""
  const staged = spawnSync("bash", ["-c", stage], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", OPERATOR_DARWIN_DIR: fixture.dir },
    encoding: "utf8",
  })
  expect(staged.status).toBe(0)
  const artifacts = join(root, "artifacts")
  for (const upload of operator.filter((step) => step.uses?.startsWith("actions/upload-artifact"))) {
    const name = upload.with?.name ?? ""
    const path = join(root, upload.with?.path ?? "")
    mkdirSync(join(artifacts, name), { recursive: true })
    if ((upload.with?.path ?? "").endsWith("/")) cpSync(path, join(artifacts, name), { recursive: true })
    else cpSync(path, join(artifacts, name, basename(path)))
  }
  // The hosted desktop-engine legs that still run in operator mode.
  for (const host of DESKTOP_ENGINE_RELEASE_HOSTS.filter((h) => !h.startsWith("darwin-"))) {
    const asset = desktopEngineReleaseAssetName(host) ?? ""
    mkdirSync(join(artifacts, `desktop-engine-${host}`), { recursive: true })
    writeFileSync(join(artifacts, `desktop-engine-${host}`, asset), `hosted ${host}`)
  }

  // release: download every artifact matching the desktop-engine pattern, merged, then write the checksums.
  const download = steps(load("publish.yml"), "release").find(
    (step) => step.name === "Download desktop-engine artifacts",
  )
  expect(download?.with).toMatchObject({ pattern: "desktop-engine-*", "merge-multiple": true })
  const pattern = new Bun.Glob(download?.with?.pattern ?? "")
  const release = join(root, "release-binaries")
  mkdirSync(release)
  for (const name of readdirSync(artifacts).filter((n) => pattern.match(n)))
    cpSync(join(artifacts, name), release, { recursive: true })
  const lines = readFileSync(writeDesktopEngineChecksums(release), "utf8").trimEnd().split("\n")

  const digests = new Map<string, string>()
  for (const line of lines) {
    const [digest = "", asset = ""] = line.split("  ")
    digests.set(asset, digest)
  }
  expect([...digests.keys()].sort()).toEqual(
    DESKTOP_ENGINE_RELEASE_HOSTS.map((h) => desktopEngineReleaseAssetName(h) ?? "").sort(),
  )
  const manifest = JSON.parse(readFileSync(join(fixture.dir, "operator-darwin-manifest.json"), "utf8")) as {
    sha256: Record<string, string>
  }
  for (const asset of ["senpi-desktop-engine-darwin-arm64", "senpi-desktop-engine-darwin-x64"]) {
    expect({ asset, digest: digests.get(asset) }).toEqual({ asset, digest: manifest.sha256[asset] })
  }
})
