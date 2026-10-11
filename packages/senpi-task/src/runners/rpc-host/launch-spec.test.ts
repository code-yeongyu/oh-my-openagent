import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { MEMBER_EXTENSION_BUNDLE_NAME } from "../../team/member-extension/identity"
import {
  DaemonLaunchSpecError,
  readDaemonLaunchSpec,
  resolveDaemonLaunchSpecPath,
} from "./launch-spec"

const pluginRoot = join(import.meta.dir, "../../../../omo-senpi/plugin")
const scratchRoots: string[] = []

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function scratchDir(): string {
  const root = mkdtempSync(join(tmpdir(), "launch-spec-"))
  scratchRoots.push(root)
  return root
}

function validSpec(overrides: Record<string, unknown> = {}) {
  return {
    spec_version: 1,
    core: {
      session_runtime: "in-process",
      multi_session: true,
      extensions: [".", `./extensions/${MEMBER_EXTENSION_BUNDLE_NAME}`],
    },
    tunables: { idleExitMs: 900_000, coldStart: "transient" },
    env: { OMO_NATIVE: "1" },
    ...overrides,
  }
}

function writeSpec(dir: string, spec: unknown, mode = 0o644): string {
  mkdirSync(join(dir, "extensions"), { recursive: true })
  writeFileSync(join(dir, "extensions", MEMBER_EXTENSION_BUNDLE_NAME), "export {}\n")
  const path = join(dir, "daemon-launch-spec.json")
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`)
  chmodSync(path, mode)
  return path
}

describe("resolveDaemonLaunchSpecPath", () => {
  test("#given a plugin root #when resolving #then the spec sits next to the plugin manifest", () => {
    // given
    const root = "/tmp/plugin-root"

    // when
    const path = resolveDaemonLaunchSpecPath(root)

    // then
    expect(path).toBe(join(root, "daemon-launch-spec.json"))
  })
})

describe("readDaemonLaunchSpec", () => {
  test("#given the built plugin spec #when reading #then it parses as spec_version 1 in-process", () => {
    // given
    const path = resolveDaemonLaunchSpecPath(pluginRoot)

    // when
    const spec = readDaemonLaunchSpec(path)

    // then
    expect(spec.spec_version).toBe(1)
    expect(spec.core.session_runtime).toBe("in-process")
    expect(spec.core.multi_session).toBe(true)
    expect(spec.core.extensions).toEqual([".", `./extensions/${MEMBER_EXTENSION_BUNDLE_NAME}`])
    expect(spec.tunables.idleExitMs).toBe(900_000)
    expect(spec.tunables.coldStart).toBe("transient")
    expect(spec.env).toEqual({ OMO_NATIVE: "1" })
  })

  test("#given the built plugin spec #when resolving extensions #then each path exists under the plugin root", () => {
    // given
    const path = resolveDaemonLaunchSpecPath(pluginRoot)
    const specDir = dirname(path)

    // when
    const spec = readDaemonLaunchSpec(path)

    // then
    expect(spec.core.extensions.length).toBeGreaterThan(0)
    for (const extension of spec.core.extensions) {
      expect(isAbsolute(extension)).toBe(false)
      expect(extension.split("/").includes("..")).toBe(false)
      const resolved = resolve(specDir, extension)
      const rel = relative(pluginRoot, resolved)
      expect(rel.startsWith("..")).toBe(false)
      expect(isAbsolute(rel)).toBe(false)
      expect(existsSync(resolved)).toBe(true)
    }
  })

  test("#given a spec whose extension escapes with .. #when reading #then it is rejected as launch_spec_path_escape", () => {
    // given
    const dir = scratchDir()
    const path = writeSpec(dir, validSpec({
      core: {
        session_runtime: "in-process",
        multi_session: true,
        extensions: ["../x"],
      },
    }))

    // when / then
    try {
      readDaemonLaunchSpec(path)
      throw new Error("expected readDaemonLaunchSpec to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonLaunchSpecError)
      if (!(error instanceof DaemonLaunchSpecError)) throw error
      expect(error.code).toBe("launch_spec_path_escape")
    }
  })

  test.skipIf(process.platform === "win32")("#given a 0666 spec #when reading #then it is rejected as launch_spec_insecure", () => {
    // given
    const dir = scratchDir()
    const path = writeSpec(dir, validSpec(), 0o666)

    // when / then
    try {
      readDaemonLaunchSpec(path)
      throw new Error("expected readDaemonLaunchSpec to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonLaunchSpecError)
      if (!(error instanceof DaemonLaunchSpecError)) throw error
      expect(error.code).toBe("launch_spec_insecure")
    }
  })

  test("#given a spec whose extension is an absolute path #when reading #then it is rejected as launch_spec_path_escape", () => {
    // given
    const dir = scratchDir()
    const path = writeSpec(dir, validSpec({
      core: {
        session_runtime: "in-process",
        multi_session: true,
        extensions: ["/tmp/outside.js"],
      },
    }))

    // when / then
    try {
      readDaemonLaunchSpec(path)
      throw new Error("expected readDaemonLaunchSpec to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonLaunchSpecError)
      if (!(error instanceof DaemonLaunchSpecError)) throw error
      expect(error.code).toBe("launch_spec_path_escape")
    }
  })

  test("#given a spec env key PATH #when reading #then it is rejected as launch_spec_env_denied", () => {
    // given
    const dir = scratchDir()
    const path = writeSpec(dir, validSpec({ env: { PATH: "/usr/bin", OMO_NATIVE: "1" } }))

    // when / then
    try {
      readDaemonLaunchSpec(path)
      throw new Error("expected readDaemonLaunchSpec to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonLaunchSpecError)
      if (!(error instanceof DaemonLaunchSpecError)) throw error
      expect(error.code).toBe("launch_spec_env_denied")
    }
  })
})
