import { createHash } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MAX_SHARD_BIND_PATH } from "./shard-socket"

// A test that hands a spawned senpi engine a socket path under the runner's TMPDIR must keep that path within the
// engine's MAX_SOCKET_PATH_BYTES (mirrored here as MAX_SHARD_BIND_PATH), or the engine exits 1 before it binds. The
// root suite's preload nests TMPDIR one level deeper than a package run (`<TMPDIR>/omo-test-run-XXXXXX`), so a long
// runner TMPDIR broke such tests only in the whole-suite run (#12557). Every such test takes its socket from here:
// a short parent (the runner's TMPDIR when the path fits, else /tmp) plus a short hashed, unique leaf.

// not exported: only this module (and shortSocketParent's default) uses it; knip flags an unused export
function fitsEngineBind(path: string): boolean {
  return Buffer.byteLength(path) <= MAX_SHARD_BIND_PATH
}

/** The parent for `<parent>/<tail>`: the runner's TMPDIR when that path fits, else /tmp. win32 binds named pipes. */
export function shortSocketParent(
  tail: string,
  base: string = tmpdir(),
  fits: (path: string) => boolean = fitsEngineBind,
): string {
  if (process.platform === "win32") return base
  return fits(join(base, tail)) ? base : "/tmp"
}

/** A fresh `<parent>/s<hash4>-XXXXXX/<socketName>` for one engine socket; the caller removes `dir`. */
export function shortSocketDir(
  label: string,
  socketName: string,
  base: string = tmpdir(),
): { readonly dir: string; readonly socket: string } {
  const prefix = `s${createHash("sha256").update(label).digest("hex").slice(0, 4)}-`
  const tail = join(`${prefix}XXXXXX`, socketName)
  const parent = shortSocketParent(tail, base)
  const planned = join(parent, tail)
  if (process.platform !== "win32" && !fitsEngineBind(planned)) {
    throw new Error(
      `${planned}: socket path is ${Buffer.byteLength(planned)} bytes, over the ${MAX_SHARD_BIND_PATH}-byte engine limit`,
    )
  }
  const dir = mkdtempSync(join(parent, prefix))
  return { dir, socket: join(dir, socketName) }
}
