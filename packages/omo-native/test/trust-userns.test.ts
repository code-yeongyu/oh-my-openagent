import { expect, test } from "bun:test"
import { lstatSync } from "node:fs"
import { attestUsernsRoots, attestedOverflowRoot, readUsernsView, USERNS_ROOTS_ENV } from "../trust-userns"

const NAMESPACED_MAP = "      1000       1000          1\n"
const INITIAL_MAP = "         0          0 4294967295\n"
const proc = (files: Record<string, string>) => (path: string) => {
  const text = files[path]
  if (text === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" })
  return text
}
const sandboxed = proc({ "/proc/self/uid_map": NAMESPACED_MAP, "/proc/sys/kernel/overflowuid": "65534\n" })
const rootInode = { uid: 65534, dev: 64769n, ino: 2n }

// Security contract (senpi#5334): an overflow-owned ancestor is root only with all three facts; every other row stays refused.
test.each([
  ["namespaced, overflow uid, attested inode", sandboxed, "64769:2", rootInode, true],
  ["another user's directory (never attested)", sandboxed, "64769:2", { ...rootInode, ino: 3n }, false],
  ["same inode number on another device", sandboxed, "64769:2", { ...rootInode, dev: 46n }, false],
  ["a mapped uid that is not the overflow uid", sandboxed, "64769:2", { ...rootInode, uid: 1001 }, false],
  ["the initial namespace", proc({ "/proc/self/uid_map": INITIAL_MAP, "/proc/sys/kernel/overflowuid": "65534" }), "64769:2", rootInode, false],
  ["an unreadable uid map", proc({ "/proc/sys/kernel/overflowuid": "65534" }), "64769:2", rootInode, false],
  ["an unreadable overflow uid", proc({ "/proc/self/uid_map": NAMESPACED_MAP }), "64769:2", rootInode, false],
  ["a malformed attestation", sandboxed, "64769:2x,root", rootInode, false],
  ["no attestation", sandboxed, undefined, rootInode, false],
] as const)("#given %s #when the ancestor is judged #then root equivalence matches the table", (_name, read, roots, stat, expected) => {
  const view = readUsernsView(roots === undefined ? {} : { [USERNS_ROOTS_ENV]: roots }, read)
  expect(attestedOverflowRoot(view, stat)).toBe(expected)
})

test.skipIf(process.platform !== "linux")("#given the launcher in the initial namespace #when it attests a path #then it lists the root-owned root inode and nothing user-owned", () => {
  const root = lstatSync("/", { bigint: true })
  const home = lstatSync(process.env.HOME ?? "/", { bigint: true })
  const attested = attestUsernsRoots([`${process.env.HOME}/.omo/engine-trust`], proc({ "/proc/self/uid_map": INITIAL_MAP }))?.split(",") ?? []
  expect(attested).toContain(`${root.dev}:${root.ino}`)
  if (home.uid !== 0n) expect(attested).not.toContain(`${home.dev}:${home.ino}`)
})

test("#given a launcher that is itself in a user namespace #when it attests #then it attests nothing", () => {
  expect(attestUsernsRoots(["/"], sandboxed)).toBeUndefined()
})
