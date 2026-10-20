import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { buildTelemetryArtifacts } from "./telemetry-artifact"
import { createOmoNativeResource } from "./telemetry-resource"

const created: string[] = []
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const MODULE = new URL("./telemetry-resource.ts", import.meta.url).pathname
const SCRIPT = `
const { createOmoNativeResource } = await import(${JSON.stringify(MODULE)})
const resource = createOmoNativeResource({ sdk: { name: "opentelemetry", version: "2.1.0" }, packageVersion: "5.1.33", stateDir: process.env.TC_STATE_DIR })
await Bun.sleep(150)
process.stdout.write(JSON.stringify(resource))
`

function matchesSpec(spec: { readonly values?: readonly string[]; readonly pattern?: string; readonly type: string }, value: unknown): boolean {
  if (spec.type === "boolean") return typeof value === "boolean"
  if (spec.type === "number") return typeof value === "number"
  if (spec.values !== undefined) return spec.values.includes(String(value))
  return spec.pattern !== undefined && new RegExp(spec.pattern, "u").test(String(value))
}

describe("OmO native OTLP Resource", () => {
  test("#given two concurrent processes on one install #then they share omo.install.hash and never share service.instance.id", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-resource-"))
    created.push(stateDir)
    const spawnOne = () =>
      Bun.spawn([process.execPath, "-e", SCRIPT], {
        env: { ...process.env, TC_STATE_DIR: stateDir, OMO_NATIVE_INSTALL_ID: "" },
        stdout: "pipe",
        stderr: "inherit",
      })
    const children = [spawnOne(), spawnOne()]
    const outputs = await Promise.all(children.map(async (child) => {
      const text = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      return JSON.parse(text) as Record<string, unknown>
    }))
    const [first, second] = outputs
    expect(first?.["service.instance.id"]).toMatch(/^[0-9a-f]{32}$/)
    expect(second?.["service.instance.id"]).toMatch(/^[0-9a-f]{32}$/)
    expect(first?.["service.instance.id"]).not.toBe(second?.["service.instance.id"])
    expect(first?.["omo.install.hash"]).toMatch(/^[0-9a-f]{64}$/)
    expect(first?.["omo.install.hash"]).toBe(second?.["omo.install.hash"])
  })

  test("#given package and SDK versions of every shape #then only the collector semver shape is sent, anything else is omitted", () => {
    const fakeOs = { platform: () => "linux", release: () => "6.8.0", arch: () => "x64" }
    const shapes: readonly [string, boolean][] = [
      ["1.2.3", true],
      ["5.1.33", true],
      ["1.2.3-beta.1", true],
      ["0.0.34-nightly.20261001.679", true],
      ["0.0.43-preview.20260928.2413", true],
      ["0.0.34-dfa.39", true],
      ["5.1.34-2", true],
      ["0.0.34-12", true],
      ["5.1.34-abc", false],
      ["5.1.34-1234567", false],
      ["1.2.3-yeongyu-macbook-pro.local", false],
      ["1.2.3+build.host", false],
      ["123456789012345678901234567890123456789012345678901234567890.2.3", false],
    ]
    for (const [version, ships] of shapes) {
      const resource = createOmoNativeResource({ product: "omo-cloud", sdk: { name: "opentelemetry", version }, packageVersion: version, env: {}, os: fakeOs })
      for (const key of ["service.version", "telemetry.sdk.version"]) {
        expect(`${version} ${key} ${resource[key] ?? "omitted"}`).toBe(`${version} ${key} ${ships ? version : "omitted"}`)
      }
    }
  })

  test("#given kernel releases of every shape #then os.version is the bare dotted release with any suffix stripped, and anything else is omitted", () => {
    const shapes: readonly [string, string | undefined][] = [
      ["26.4.1 (25E253)", "26.4.1"],
      ["6.8.0-45-generic", "6.8.0"],
      ["6.8.0+rpt-rpi-v8", "6.8.0"],
      ["25.3.0", "25.3.0"],
      ["10.0.22631", "10.0.22631"],
      ["5.15.153.1-microsoft-standard-WSL2", "5.15.153.1"],
      ["Darwin", undefined],
      ["", undefined],
      ["6", undefined],
      ["1234567.0.1", undefined],
      ["1.2.3.4.5", undefined],
      ["/srv/customer/alice/report.txt", undefined],
    ]
    for (const [release, expected] of shapes) {
      const fakeOs = { platform: () => "linux", release: () => release, arch: () => "x64" }
      const resource = createOmoNativeResource({ product: "omo-cloud", sdk: { name: "opentelemetry", version: "2.1.0" }, packageVersion: "5.1.33", env: {}, os: fakeOs })
      expect(`${release} -> ${resource["os.version"] ?? "omitted"}`).toBe(`${release} -> ${expected ?? "omitted"}`)
    }
  })

  test("#given this process #then every Resource attribute conforms to the omo-senpi artifact, and omo-cloud carries no install hash", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "omo-resource-"))
    created.push(stateDir)
    const [senpi, cloud] = buildTelemetryArtifacts()
    const fakeOs = { platform: () => "linux", release: () => "6.8.0-45-generic", arch: () => "x64" }
    const resource = createOmoNativeResource({ sdk: { name: "opentelemetry", version: "2.1.0" }, packageVersion: "5.1.33", stateDir, env: {}, os: fakeOs })
    for (const [key, spec] of Object.entries(senpi?.resource ?? {})) {
      if (spec.required) expect(resource).toHaveProperty([key])
      if (resource[key] !== undefined) expect(`${key} ${matchesSpec(spec, resource[key])}`).toBe(`${key} true`)
    }
    expect(resource["host.arch"]).toBe("amd64")
    expect(resource["os.version"]).toBe("6.8.0")
    const cloudResource = createOmoNativeResource({ product: "omo-cloud", sdk: { name: "opentelemetry", version: "2.1.0" }, packageVersion: "5.1.33", env: {}, os: fakeOs })
    expect(cloudResource).not.toHaveProperty(["omo.install.hash"])
    for (const [key, spec] of Object.entries(cloud?.resource ?? {})) {
      if (spec.required) expect(cloudResource).toHaveProperty([key])
      if (cloudResource[key] !== undefined) expect(matchesSpec(spec, cloudResource[key])).toBe(true)
    }
  })
})
