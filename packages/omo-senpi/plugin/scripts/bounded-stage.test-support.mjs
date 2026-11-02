import { spawn, spawnSync } from "node:child_process"
import { realpathSync, statSync } from "node:fs"
import { join, parse, posix, win32 } from "node:path"
import { windowsTreeKillArgs } from "../../../memory-core/src/concurrency/windows-process-tree.mjs"

// One external stage of a packaging test, run without blocking the test process (#10911): it either
// settles with its output or, past `capMs`, has its whole process tree killed and awaited, and fails
// naming the stage. A `spawnSync` stage that stalls gives no clue which step hung, and a shell-launched
// child of a killed `cmd.exe` keeps files open so the scratch directory cannot be removed. The last argument swaps
// the process seams so a test can play out the Windows kill path on any OS.
export function runBoundedStage(stage, command, args, options, capMs, {
  platform = process.platform,
  spawnChild = spawn,
  treeKillArgs = windowsTreeKillArgs,
  runSync = spawnSync,
} = {}) {
  return new Promise((resolve, reject) => {
    // FILETIME lower bound captured before spawn, including when a short-lived launcher exits.
    const rootStartedAt = BigInt(Date.now()) * 10_000n + 116_444_736_000_000_000n
    const child = spawnChild(command, args, { ...options, windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
    child.stderr?.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
    let stalled = false
    const cap = setTimeout(() => {
      stalled = true
      if (platform === "win32" && child.pid !== undefined) {
        const args = treeKillArgs(child.pid, undefined, process.pid, rootStartedAt)
        if (args.length > 0) runSync("taskkill", args, { windowsHide: true })
      } else {
        child.kill("SIGKILL")
      }
      // A process outside the killed tree may still hold the pipes; without them `close` can still fire.
      child.stdout?.destroy()
      child.stderr?.destroy()
    }, capMs)
    child.once("error", (error) => {
      clearTimeout(cap)
      reject(new Error(`${stage} could not start: ${error.message}`))
    })
    child.once("close", (status) => {
      clearTimeout(cap)
      if (stalled) {
        reject(new Error(`${stage} did not finish within ${capMs} ms; stdout: ${stdout.slice(-500)} stderr: ${stderr.slice(-500)}`))
        return
      }
      resolve({ status, stdout, stderr })
    })
  })
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// npm's JavaScript entry and the node that owns it, or null when neither step finds one:
// 1. the npm on PATH, when it is npm's JavaScript entry: on Windows the npm-cli.js beside the first npm.cmd, run by the
//    node.exe beside it as npm.cmd would; elsewhere the real path of the first npm, run by the node of that install
//    (or, without one, the node on PATH, which npm's shebang would pick);
// 2. otherwise (a version-manager shim or wrapper script) the npm bundled with the node on PATH, run by that node.
export function resolveNpm({ platform = process.platform, pathValue = process.env.PATH ?? process.env.Path ?? "", isFile: exists = isFile, realpath = realpathSync } = {}) {
  const path = platform === "win32" ? win32 : posix
  const dirs = pathValue.split(path.delimiter).filter(Boolean)
  const onPath = (name) => dirs.map((dir) => path.join(dir, name)).find((candidate) => exists(candidate))
  const node = onPath(platform === "win32" ? "node.exe" : "node")
  const owner = (beside) => exists(beside) ? beside : node ?? "node"
  const npm = onPath(platform === "win32" ? "npm.cmd" : "npm")
  if (npm !== undefined && platform === "win32") {
    const cli = path.join(path.dirname(npm), "node_modules", "npm", "bin", "npm-cli.js")
    if (exists(cli)) return { node: owner(path.join(path.dirname(npm), "node.exe")), cli }
  } else if (npm !== undefined) {
    const cli = realpath(npm)
    if (/\.[cm]?js$/.test(cli)) return { node: owner(path.join(path.dirname(cli), "..", "..", "..", "..", "bin", "node")), cli }
  }
  if (node === undefined) return null
  const realNode = realpath(node)
  const bundled = platform === "win32"
    ? path.join(path.dirname(realNode), "node_modules", "npm", "bin", "npm-cli.js")
    : path.join(path.dirname(realNode), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  return exists(bundled) ? { node: realNode, cli: bundled } : null
}

// npm 11 ends every command with process.exit(). On Node 24 that call joins V8's platform workers while one can be
// parked waiting for a GC that only the main thread runs, so npm can hang after printing its result
// (nodejs/node#64274, fix pending in nodejs/node#66171): the npm pack stall of #10911. --single-threaded turns V8's
// background tasks off; NODE_OPTIONS refuses it, so npm's JavaScript entry runs under node directly. Started that
// way npm pack is one process, not cmd.exe -> npm.cmd -> node, so the stage's tree kill always reaches it. When no
// JavaScript entry is found, npm is started by name as before (through cmd.exe on Windows, where npm.cmd needs it).
// Either way it runs from the filesystem root: Windows cannot remove a directory that is a live process's current
// directory.
export function npmPackStage(pkg, destination, {
  platform = process.platform,
  npm = resolveNpm({ platform }),
  cwd = parse(process.cwd()).root,
} = {}) {
  const pack = ["pack", pkg, "--silent", "--pack-destination", destination]
  if (npm === null) return { command: "npm", args: pack, options: { cwd, ...(platform === "win32" && { shell: true }) } }
  return { command: npm.node, args: ["--single-threaded", npm.cli, ...pack], options: { cwd } }
}

// The Windows `tar`, independent of PATH: under Git Bash's PATH `tar` is GNU tar, which reads `C:\...`
// as a remote host and fails.
export function systemTar() {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
}
