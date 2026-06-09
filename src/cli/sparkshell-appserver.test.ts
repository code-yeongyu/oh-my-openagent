/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  runSparkShell,
  type SparkShellAppServerCommand,
  type SparkShellAppServerResult,
  type SparkShellSpawnResult,
} from "./sparkshell"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

const REPO_ROOT = __repoRootFrom(import.meta.dir)
const unixSocketTest = process.platform === "win32" ? test.skip : test

describe("sparkshell appserver routing", () => {
  unixSocketTest("#given appserver socket #when direct argv runs #then wire client initializes before command exec", async () => {
    // given
    const tempDir = await mkdtemp(join(tmpdir(), "omo-sparkshell-appserver-"))
    const socketPath = join(tempDir, "appserver.sock")
    const methods: string[] = []
    let initialized = false
    const server = Bun.serve({
      unix: socketPath,
      fetch(request, server) {
        if (server.upgrade(request)) return undefined
        return new Response("upgrade required", { status: 426 })
      },
      websocket: {
        message(socket, message) {
          const request = JSON.parse(typeof message === "string" ? message : Buffer.from(message).toString("utf8"))
          methods.push(request.method)
          if (request.method === "initialize") {
            socket.send(JSON.stringify({
              id: request.id,
              result: { userAgent: "fake-codex/0.0.0", codexHome: "/fake/codex", platformFamily: "unix", platformOs: "linux" },
            }))
            return
          }
          if (request.method === "initialized") {
            initialized = true
            return
          }
          if (request.method === "command/exec" && initialized) {
            socket.send(JSON.stringify({ id: request.id, result: { exitCode: 0, stdout: `${request.params.command.join(" ")}\n`, stderr: "" } }))
          }
        },
      },
    })
    const stdout: string[] = []

    try {
      // when
      const exitCode = await runSparkShell(["git", "status"], {
        env: { CODEX_APP_SERVER_SOCKET: socketPath },
        writeStdout: (value: string) => {
          stdout.push(value)
        },
        writeStderr: () => {},
      })

      // then
      expect(exitCode).toBe(0)
      expect(stdout.join("")).toBe("git status\n")
      expect(methods).toEqual(["initialize", "initialized", "command/exec"])
    } finally {
      server.stop(true)
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  unixSocketTest("#given unresponsive appserver socket #when direct argv runs #then raw fallback is bounded", async () => {
    // given
    const tempDir = await mkdtemp(join(tmpdir(), "omo-sparkshell-timeout-"))
    const socketPath = join(tempDir, "appserver.sock")
    const server = Bun.serve({
      unix: socketPath,
      fetch(request, server) {
        if (server.upgrade(request)) return undefined
        return new Response("upgrade required", { status: 426 })
      },
      websocket: {
        message() {},
      },
    })
    const spawnCalls: string[][] = []
    const stderr: string[] = []

    try {
      // when
      const exitCode = await runSparkShell(["printf", "ok"], {
        env: {
          CODEX_APP_SERVER_SOCKET: socketPath,
          OMO_SPARKSHELL_APP_SERVER_TIMEOUT_MS: "25",
        },
        writeStderr: (value: string) => {
          stderr.push(value)
        },
        spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
          spawnCalls.push([command, ...args])
          return { status: 0, stdout: "ok" }
        },
      })

      // then
      expect(exitCode).toBe(0)
      expect(spawnCalls).toEqual([["printf", "ok"]])
      expect(stderr.join("")).toContain("appserver unavailable")
    } finally {
      server.stop(true)
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("#given appserver client #when direct argv runs #then command executes through appserver without tmux detection", async () => {
    // given
    const appServerCommands: SparkShellAppServerCommand[] = []
    const commandChecks: string[] = []
    const spawnCalls: string[][] = []
    const stdout: string[] = []

    // when
    const exitCode = await runSparkShell(["git", "status"], {
      env: {},
      writeStdout: (value: string) => {
        stdout.push(value)
      },
      commandExists: (command: string) => {
        commandChecks.push(command)
        return false
      },
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        spawnCalls.push([command, ...args])
        return { status: 0 }
      },
      appServerClient: {
        async getPlatform(): Promise<NodeJS.Platform> {
          return "linux"
        },
        async exec(command: SparkShellAppServerCommand): Promise<SparkShellAppServerResult> {
          appServerCommands.push(command)
          return { exitCode: 0, stdout: "appserver ok\n", stderr: "" }
        },
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(appServerCommands).toEqual([{ argv: ["git", "status"], cwd: REPO_ROOT, env: {} }])
    expect(stdout.join("")).toBe("appserver ok\n")
    expect(commandChecks).toEqual([])
    expect(spawnCalls).toEqual([])
  })

  test("#given windows appserver target #when shell command runs #then shell argv is resolved for the target platform", async () => {
    // given
    const appServerCommands: SparkShellAppServerCommand[] = []

    // when
    const exitCode = await runSparkShell(["--shell", "Write-Output hello"], {
      cwd: "C:\\repo",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      writeStderr: () => {},
      appServerClient: {
        async getPlatform(): Promise<NodeJS.Platform> {
          return "win32"
        },
        async exec(command: SparkShellAppServerCommand): Promise<SparkShellAppServerResult> {
          appServerCommands.push(command)
          return { exitCode: 0, stdout: "", stderr: "" }
        },
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(appServerCommands).toEqual([
      {
        argv: ["powershell.exe", "-NoLogo", "-NoProfile", "-Command", "Write-Output hello"],
        cwd: "C:\\repo",
        env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      },
    ])
  })

  test("#given appserver client #when tmux pane mode runs #then pane capture uses tmux instead of appserver exec", async () => {
    // given
    const appServerCommands: SparkShellAppServerCommand[] = []
    const spawnCalls: string[][] = []

    // when
    const exitCode = await runSparkShell(["--tmux-pane", "%12", "--tail-lines", "400"], {
      env: {},
      writeStderr: () => {},
      commandExists: (command: string) => command === "tmux",
      spawn: (command: string, args: readonly string[]): SparkShellSpawnResult => {
        spawnCalls.push([command, ...args])
        return { status: 0 }
      },
      appServerClient: {
        async getPlatform(): Promise<NodeJS.Platform> {
          return "linux"
        },
        async exec(command: SparkShellAppServerCommand): Promise<SparkShellAppServerResult> {
          appServerCommands.push(command)
          return { exitCode: 0, stdout: "", stderr: "" }
        },
      },
    })

    // then
    expect(exitCode).toBe(0)
    expect(spawnCalls).toEqual([["tmux", "capture-pane", "-p", "-t", "%12", "-S", "-400"]])
    expect(appServerCommands).toEqual([])
  })
})
