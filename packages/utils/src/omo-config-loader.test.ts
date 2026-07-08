import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { loadOmoConfig } from "./omo-config/loader"

function makeTempHome(): string {
  return Bun.fileURLToPath(new URL(`omo-config-loader-${crypto.randomUUID()}/`, `file://${tmpdir()}/`))
}

function writeConfig(path: string, content: string): void {
  mkdirSync(join(path, ".omo"), { recursive: true })
  writeFileSync(join(path, ".omo", "config.jsonc"), content)
}

describe("loadOmoConfig", () => {
  test("#given no SOT files #when loading codex config #then built-in defaults are returned without throwing", () => {
    // given
    const homeDir = makeTempHome()
    const cwd = join(homeDir, "repo")
    mkdirSync(cwd, { recursive: true })

    try {
      // when
      const result = loadOmoConfig({ harness: "codex", cwd, homeDir, env: {} })

      // then
      expect(result.config).toEqual({
        codegraph: {
          auto_provision: true,
          enabled: true,
          telemetry: false,
        },
      })
      expect(result.warnings).toEqual([])
      expect(result.sources).toContainEqual({
        exists: false,
        loaded: false,
        path: join(homeDir, ".omo", "config.jsonc"),
        scope: "global",
      })
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  test("#given global base and codex block #when loading codex config #then harness block deep-merges over base", () => {
    // given
    const homeDir = makeTempHome()
    const cwd = join(homeDir, "repo")
    mkdirSync(cwd, { recursive: true })
    writeConfig(
      homeDir,
      `{
        "codegraph": {
          "auto_provision": true,
          "enabled": true,
          "install_dir": "/base"
        },
        "[codex]": {
          "codegraph": {
            "enabled": false
          }
        }
      }`,
    )

    try {
      // when
      const result = loadOmoConfig({ harness: "codex", cwd, homeDir, env: {} })

      // then
      expect(result.config.codegraph).toEqual({
        auto_provision: true,
        enabled: false,
        install_dir: "/base",
        telemetry: false,
      })
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  test("#given global parent and child project config #when loading from child #then nearest project override wins", () => {
    // given
    const homeDir = makeTempHome()
    const parent = join(homeDir, "parent")
    const child = join(parent, "child")
    mkdirSync(child, { recursive: true })
    writeConfig(homeDir, `{"codegraph":{"enabled":true,"install_dir":"/global"}}`)
    writeConfig(parent, `{"codegraph":{"install_dir":"/parent"},"[codex]":{"codegraph":{"auto_provision":false}}}`)
    writeConfig(child, `{"codegraph":{"install_dir":"/child"}}`)

    try {
      // when
      const result = loadOmoConfig({ harness: "codex", cwd: child, homeDir, env: {} })

      // then
      expect(result.config.codegraph).toEqual({
        auto_provision: false,
        enabled: true,
        install_dir: "/child",
        telemetry: false,
      })
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  test("#given global and project excluded roots #when loading codex config #then roots are merged without duplicates", () => {
    // given
    const homeDir = makeTempHome()
    const cwd = join(homeDir, "repo")
    mkdirSync(cwd, { recursive: true })
    writeConfig(homeDir, `{"codegraph":{"excluded_roots":["/tmp/omo-a","/tmp/omo-b"]}}`)
    writeConfig(cwd, `{"[codex]":{"codegraph":{"excluded_roots":["/tmp/omo-b","/tmp/omo-c"]}}}`)

    try {
      // when
      const result = loadOmoConfig({ harness: "codex", cwd, homeDir, env: {} })

      // then
      expect(result.config.codegraph?.excluded_roots).toEqual(["/tmp/omo-a", "/tmp/omo-b", "/tmp/omo-c"])
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  test("#given SOT value and env override #when loading config #then env override has highest precedence", () => {
    // given
    const homeDir = makeTempHome()
    const cwd = join(homeDir, "repo")
    mkdirSync(cwd, { recursive: true })
    writeConfig(homeDir, `{"codegraph":{"enabled":true}}`)

    try {
      // when
      const result = loadOmoConfig({
        harness: "codex",
        cwd,
        homeDir,
        env: { CODEX_CODEGRAPH_ENABLED: "0" },
      })

      // then
      expect(result.config.codegraph?.enabled).toBe(false)
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  test("#given unsupported codex setting #when loading config #then applicability warning is returned", () => {
    // given
    const homeDir = makeTempHome()
    const cwd = join(homeDir, "repo")
    mkdirSync(cwd, { recursive: true })
    writeConfig(homeDir, `{"[codex]":{"codegraph":{"watch_debounce_ms":250}}}`)

    try {
      // when
      const result = loadOmoConfig({ harness: "codex", cwd, homeDir, env: {} })

      // then
      expect(result.warnings).toContain("codegraph.watch_debounce_ms is not supported for harness codex")
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  test("#given malformed and unknown settings #when loading config #then warnings are returned and valid settings still load", () => {
    // given
    const homeDir = makeTempHome()
    const cwd = join(homeDir, "repo")
    mkdirSync(cwd, { recursive: true })
    writeConfig(homeDir, `{"codegraph":{"enabled":false,"unknown":1}}`)
    writeConfig(cwd, `{"codegraph":`)

    try {
      // when
      const result = loadOmoConfig({ harness: "codex", cwd, homeDir, env: {} })

      // then
      expect(result.config.codegraph?.enabled).toBe(false)
      expect(result.warnings.some((warning) => warning.includes("unknown"))).toBe(true)
      expect(result.warnings.some((warning) => warning.includes("JSONC parse error"))).toBe(true)
      expect(result.sources).toContainEqual({
        exists: true,
        loaded: false,
        path: join(cwd, ".omo", "config.jsonc"),
        scope: "project",
      })
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })
})
