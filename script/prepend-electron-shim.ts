#!/usr/bin/env bun
/**
 * Prepend the Electron/Node compat shim to dist/index.js.
 *
 * When bundled with --target bun, Bun inlines top-level
 *   var { spawn } = globalThis.Bun;
 * statements from its own internal modules. These crash on Node/Electron
 * because globalThis.Bun is undefined there.
 *
 * Since Bun's bundler does not guarantee that a side-effect import at the
 * top of src/index.ts will appear before all other module top-level code,
 * we post-process the bundle and manually prepend the shim.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIST_PATH = join(import.meta.dir, "..", "dist", "index.js")

const SHIM = `// [omo] Electron/Node compat shim — prepended by script/prepend-electron-shim.ts
// Populates globalThis.Bun before any top-level destructure fires.
if (!globalThis.Bun) {
  const _cp = await import("node:child_process");
  const _Readable = (await import("node:stream")).Readable;
  function _mkproc(p) {
    let c = null;
    const exited = new Promise(r => {
      p.on("exit", code => { c = code ?? 1; r(c); });
      p.on("error", () => { if (c === null) { c = 1; r(1); } });
    });
    return { get exitCode() { return c; }, exited,
      stdout: p.stdout ? _Readable.toWeb(p.stdout) : undefined,
      stderr: p.stderr ? _Readable.toWeb(p.stderr) : undefined,
      stdin: p.stdin, kill(s) { try { p.kill(s); } catch {} }, pid: p.pid };
  }
  function _spawn(cmdOrOpts, opts) {
    const isObj = !Array.isArray(cmdOrOpts);
    const cmd = isObj ? cmdOrOpts.cmd : cmdOrOpts;
    const o = isObj ? cmdOrOpts : (opts || {});
    const [bin, ...args] = cmd;
    return _mkproc(_cp.spawn(bin, args, { cwd: o.cwd, env: o.env,
      stdio: [o.stdin||"pipe", o.stdout||"pipe", o.stderr||"pipe"] }));
  }
  function _spawnSync(cmdOrOpts) {
    const isObj = !Array.isArray(cmdOrOpts);
    const cmd = isObj ? cmdOrOpts.cmd : cmdOrOpts;
    const o = isObj ? cmdOrOpts : {};
    const [bin, ...args] = cmd;
    const r = _cp.spawnSync(bin, args, { cwd: o.cwd, env: o.env, stdio: ["pipe","pipe","pipe"] });
    return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  }
  globalThis.Bun = { spawn: _spawn, spawnSync: _spawnSync, env: process.env, version: "0.0.0-node-shim" };
}
`

const original = readFileSync(DIST_PATH, "utf-8")

// Avoid double-prepend
if (original.includes("[omo] Electron/Node compat shim")) {
  console.log("Shim already present in dist/index.js, skipping.")
  process.exit(0)
}

writeFileSync(DIST_PATH, SHIM + original, "utf-8")
console.log(`✓ Prepended Electron/Node compat shim to dist/index.js`)
