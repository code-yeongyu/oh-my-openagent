/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveCodegraphCommandInvocation, runCodegraphCommand } from "./command-runner"

describe("CodeGraph command runner", () => {
  test("#given Windows codegraph.cmd #when command runner builds invocation #then it runs through cmd.exe", () => {
    // given
    const command = "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cmd"

    // when
    const invocation = resolveCodegraphCommandInvocation(command, ["status", "--json"], "win32")

    // then
    expect(invocation).toEqual({
      args: ["/d", "/s", "/c", command, "status", "--json"],
      command: "cmd.exe",
    })
  })

  test("#given Windows CodeGraph resolves to a Node script #when command runner builds invocation #then Node executes it", () => {
    // given
    const command = "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.mjs"

    // when
    const invocation = resolveCodegraphCommandInvocation(command, ["status", "--json"], "win32")

    // then
    expect(invocation).toEqual({
      args: [command, "status", "--json"],
      command: process.execPath,
    })
  })

  test("#given ambient provider tokens #when command runner spawns CodeGraph #then child env only gets safe and controlled variables", async () => {
    // given
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-env-"))
    const originalOpenAiKey = process.env["OPENAI_API_KEY"]
    process.env["OPENAI_API_KEY"] = "sk-test-secret"

    try {
      // when
      const result = await runCodegraphCommand(
        workspace,
        "node",
        [
          "-e",
          "process.stdout.write(JSON.stringify({codegraphInstallDir:process.env.CODEGRAPH_INSTALL_DIR,home:process.env.HOME,openai:process.env.OPENAI_API_KEY}))",
        ],
        { env: { CODEGRAPH_INSTALL_DIR: "/safe/codegraph" }, timeoutMs: 5_000 },
      )

      // then
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        codegraphInstallDir: "/safe/codegraph",
        home: process.env["HOME"],
      })
    } finally {
      if (originalOpenAiKey === undefined) delete process.env["OPENAI_API_KEY"]
      else process.env["OPENAI_API_KEY"] = originalOpenAiKey
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("#given the command spawns a hanging descendant #when the timeout expires #then the process tree is reaped", async () => {
    // given
    const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-opencode-timeout-"))
    const timeoutController = new AbortController()
    const descendantReady = Promise.withResolvers<void>()
    const readinessServer = createServer((socket) => {
      socket.end()
      descendantReady.resolve()
    })
    await new Promise<void>((resolve, reject) => {
      readinessServer.once("error", reject)
      readinessServer.listen(0, "127.0.0.1", resolve)
    })
    const address = readinessServer.address()
    if (address === null || typeof address === "string") throw new Error("readiness server has no TCP port")
    let descendantPid: number | undefined

    try {
      // when
      const resultPromise = runCodegraphCommand(
        workspace,
        "node",
        [
          "-e",
          "const{spawn}=require('node:child_process');const{writeFileSync}=require('node:fs');const{connect}=require('node:net');const{join}=require('node:path');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(join(process.env.HOME,'survivor.pid'),String(child.pid));connect(Number(process.env.CODEGRAPH_READY_PORT),'127.0.0.1').end();setInterval(()=>{},1000)",
        ],
        {
          env: { CODEGRAPH_READY_PORT: String(address.port), HOME: workspace },
          timeoutMs: 10_000,
          timeoutSignal: timeoutController.signal,
        },
      )
      await withTimeout(descendantReady.promise, 5_000, "descendant did not signal readiness")
      timeoutController.abort()
      const result = await withTimeout(resultPromise, 5_000, "command did not stop after the timeout signal")
      descendantPid = Number.parseInt(readFileSync(join(workspace, "survivor.pid"), "utf8").trim(), 10)

      // then
      expect(result.timedOut).toBeTrue()
      expect(isProcessAlive(descendantPid)).toBeFalse()
    } finally {
      readinessServer.close()
      if (descendantPid !== undefined && isProcessAlive(descendantPid)) process.kill(descendantPid, "SIGKILL")
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("#given non-Windows codegraph command #when command runner builds invocation #then it executes directly", () => {
    // given
    const command = "/home/test/.omo/codegraph/bin/codegraph"

    // when
    const invocation = resolveCodegraphCommandInvocation(command, ["sync"], "linux")

    // then
    expect(invocation).toEqual({ args: ["sync"], command })
  })
})

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
