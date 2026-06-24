import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  bunFile,
  bunWhich,
  bunWrite,
  createNodeSpawnOptions,
  createNodeSpawnSyncOptions,
  spawn,
  spawnSync,
} from "@oh-my-opencode/utils/runtime"

async function readProcessStream(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return ""

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        return Buffer.concat(chunks).toString("utf8")
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
}

describe("runtime shims", () => {
  test("#given array spawn command #when stdout and stderr are piped #then streams and exit code are preserved", async () => {
    const proc = spawn(["bun", "--eval", "console.log('out-ok'); console.error('err-ok')"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      readProcessStream(proc.stdout),
      readProcessStream(proc.stderr),
    ])

    expect(exitCode).toBe(0)
    expect(proc.exitCode).toBe(0)
    expect(stdout.trim()).toBe("out-ok")
    expect(stderr.trim()).toBe("err-ok")
  })

  test("#given object spawn command with ignored stdio #when streams are read #then empty streams are safe", async () => {
    const proc = spawn({
      cmd: ["bun", "--eval", "console.log('ignored')"],
      stdio: ["ignore", "ignore", "ignore"],
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      readProcessStream(proc.stdout),
      readProcessStream(proc.stderr),
    ])

    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toBe("")
  })

  test("#given spawnSync command #when process exits nonzero #then stderr and exit code are preserved", () => {
    const result = spawnSync(["bun", "--eval", "console.error('sync-err'); process.exit(7)"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode).toBe(7)
    expect(result.success).toBe(false)
    expect(result.stderr?.toString().trim()).toBe("sync-err")
    expect(result.pid).toBeGreaterThan(0)
  })

  test("#given Bun global is unavailable #when spawning async and sync commands #then Node fallback preserves process output", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "runtime-node-fallback-"))
    const modulePath = join(temporaryDirectory, "spawn.mjs")
    const source = await readFile(join(process.cwd(), "packages/utils/src/runtime/spawn.ts"), "utf8")
    const transpiled = new Bun.Transpiler({ loader: "ts" }).transformSync(source)
    const nodePath = bunWhich("node")
    const script = String.raw`
      const modulePath = process.env.OMO_RUNTIME_SHIM_MODULE;
      if (!modulePath) throw new Error("missing OMO_RUNTIME_SHIM_MODULE");
      const { pathToFileURL } = await import("node:url");
      const { spawn, spawnSync } = await import(pathToFileURL(modulePath).href);
      async function readProcessStream(stream) {
        if (!stream) return "";
        const reader = stream.getReader();
        const chunks = [];
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) return Buffer.concat(chunks).toString("utf8");
            chunks.push(result.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const proc = spawn(["bun", "--print", "'node-fallback-ok'"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        readProcessStream(proc.stdout),
        readProcessStream(proc.stderr),
      ]);
      const syncResult = spawnSync(["bun", "--print", "'node-sync-ok'"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      console.log(JSON.stringify({
        exitCode,
        runtimeExitCode: proc.exitCode,
        stdout: stdout.trim(),
        stderr,
        syncExitCode: syncResult.exitCode,
        syncStdout: syncResult.stdout?.toString().trim(),
        success: syncResult.success,
        pidPositive: syncResult.pid > 0,
      }));
    `

    try {
      await writeFile(modulePath, transpiled)

      expect(nodePath).not.toBeNull()
      const result = spawnSync([nodePath ?? "node", "--input-type=module", "--eval", script, modulePath], {
        env: { ...process.env, OMO_RUNTIME_SHIM_MODULE: modulePath },
        stdout: "pipe",
        stderr: "pipe",
      })

      expect(result.exitCode).toBe(0)
      expect(result.stderr?.toString()).toBe("")
      const payload: unknown = JSON.parse(result.stdout?.toString() ?? "{}")
      expect(payload).toEqual({
        exitCode: 0,
        runtimeExitCode: 0,
        stdout: "node-fallback-ok",
        stderr: "",
        syncExitCode: 0,
        syncStdout: "node-sync-ok",
        success: true,
        pidPositive: true,
      })
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })

  test("#given Windows platform #when Node spawn options are built #then shell stays false and child windows hide", () => {
    const signal = AbortSignal.timeout(30_000)
    const options = createNodeSpawnOptions(
      {
        cwd: process.cwd(),
        detached: true,
        env: { ...process.env, RUNTIME_SHIM_TEST: "1" },
        signal,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
      "win32",
    )

    expect(options.cwd).toBe(process.cwd())
    expect(options.detached).toBe(true)
    expect(options.env?.RUNTIME_SHIM_TEST).toBe("1")
    expect(options.signal).toBe(signal)
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"])
    expect(options.shell).toBe(false)
    expect(options.windowsHide).toBe(true)
  })

  test("#given Windows platform #when Node spawnSync options are built #then shell stays false and child windows hide", () => {
    const options = createNodeSpawnSyncOptions({ stdout: "pipe", stderr: "pipe" }, "win32")

    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"])
    expect(options.shell).toBe(false)
    expect(options.windowsHide).toBe(true)
  })

  test("#given command lookup #when resolving safe and unsafe names #then PATH lookup is constrained", () => {
    expect(bunWhich("node")?.toLowerCase()).toMatch(/node(?:\.exe)?$/)
    expect(bunWhich("../node")).toBeNull()
    expect(bunWhich("node\0evil")).toBeNull()
  })

  test("#given file shim #when writing and reading data #then bytes and file state round trip", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "runtime-file-shim-"))
    const filePath = join(temporaryDirectory, "content.txt")

    try {
      const bytesWritten = await bunWrite(filePath, "hello runtime")

      expect(bytesWritten).toBe(Buffer.byteLength("hello runtime", "utf8"))
      expect(await bunFile(filePath).exists()).toBe(true)
      expect(await bunFile(filePath).text()).toBe("hello runtime")
      expect(await readFile(filePath, "utf8")).toBe("hello runtime")

      await bunFile(filePath).delete()

      expect(await bunFile(filePath).exists()).toBe(false)
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })
})
