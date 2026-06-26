import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  createCodegraphMcpCliEnv,
  resolveOrProvisionCommand,
  type CodegraphCliEnv,
} from "./cli.js"

describe("CodeGraph MCP CLI environment", () => {
  test("#given a missing argv entry path #when CLI module is imported #then import does not throw", async () => {
    const moduleUrl = new URL("./cli.ts", import.meta.url).href
    const script = `process.argv[1] = "/missing/codegraph-cli-entry"; await import(${JSON.stringify(moduleUrl)})`

    const child = Bun.spawn([process.execPath, "-e", script], {
      stderr: "pipe",
      stdout: "pipe",
      timeout: 5_000,
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
  })

  test("#given OpenCode configured CODEGRAPH_INSTALL_DIR #when CLI env is built #then custom install dir survives safe defaults", () => {
    const homeDir = "/home/alice"
    const installDir = "/workspace/.cache/codegraph"

    const env = createCodegraphMcpCliEnv({
      input: {
        CODEGRAPH_INSTALL_DIR: installDir,
        CODEGRAPH_NO_DOWNLOAD: "0",
        CODEGRAPH_TELEMETRY: "1",
        DO_NOT_TRACK: "0",
      },
      homeDir,
    })

    expect(env["CODEGRAPH_INSTALL_DIR"]).toBe(installDir)
    expect(env["CODEGRAPH_NO_DOWNLOAD"]).toBe("1")
    expect(env["CODEGRAPH_TELEMETRY"]).toBe("0")
    expect(env["DO_NOT_TRACK"]).toBe("1")
  })

  test("#given no configured CODEGRAPH_INSTALL_DIR #when CLI env is built #then default install dir is scoped under home", () => {
    const homeDir = "/home/alice"

    const env = createCodegraphMcpCliEnv({ input: {}, homeDir })

    expect(env["CODEGRAPH_INSTALL_DIR"]).toBe(join(homeDir, ".omo", "codegraph"))
  })

  test("#given custom CODEGRAPH_INSTALL_DIR exists #when command resolves #then provisioned candidate uses the custom install dir", async () => {
    const installDir = "/workspace/.cache/codegraph"
    const binaryPath = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
    const env: CodegraphCliEnv = { CODEGRAPH_INSTALL_DIR: installDir }

    const command = await resolveOrProvisionCommand("/home/alice", env, {
      fileExists: (filePath) => filePath === binaryPath,
      resolveCommand: (options) => {
        if (options === undefined) throw new Error("expected resolver options")
        const provisioned = options.provisioned?.()
        return {
          argsPrefix: [],
          command: provisioned ?? "codegraph",
          exists: provisioned === binaryPath,
          source: provisioned === binaryPath ? "provisioned" : "path",
        }
      },
    })

    expect(command).toMatchObject({ argsPrefix: [], command: binaryPath })
  })

  test("#given custom CODEGRAPH_INSTALL_DIR is missing #when command provisions #then install and lock dirs use the custom install dir", async () => {
    const installDir = "/workspace/.cache/codegraph"
    const binaryPath = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
    const env: CodegraphCliEnv = { CODEGRAPH_INSTALL_DIR: installDir }
    const provisions: Array<{ readonly installDir: string; readonly lockDir: string }> = []

    const command = await resolveOrProvisionCommand("/home/alice", env, {
      ensureProvisioned: (options) => {
        if (options === undefined) throw new Error("expected provision options")
        if (options.installDir === undefined) throw new Error("expected install dir")
        if (options.lockDir === undefined) throw new Error("expected lock dir")
        provisions.push({ installDir: options.installDir, lockDir: options.lockDir })
        return Promise.resolve({ binPath: binaryPath, provisioned: true })
      },
      fileExists: () => false,
      resolveCommand: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
    })

    expect(command).toEqual({ argsPrefix: [], command: binaryPath })
    expect(provisions).toEqual([{ installDir, lockDir: join(installDir, ".locks") }])
  })
})
