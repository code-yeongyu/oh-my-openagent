import { describe, expect, test } from "bun:test"

import { TEMP_MARK } from "./atomic"
import { itemPaths, landingPath, type ListDir, scanWorkingTree, type TreeEntry } from "./working-tree"

const file = (name: string): TreeEntry => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false })
const dir = (name: string): TreeEntry => ({ name, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false })
const link = (name: string): TreeEntry => ({ name, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true })

const NFD = "re\u0301sume\u0301.md"
const NFC = NFD.normalize("NFC")

function lister(tree: Readonly<Record<string, readonly TreeEntry[]>>): { list: ListDir; listed: string[] } {
  const listed: string[] = []
  const list: ListDir = async (relative) => {
    listed.push(relative)
    return tree[relative] ?? []
  }
  return { list, listed }
}

describe("scanWorkingTree", () => {
  test("lists regular files, reports symlinks without entering them, and skips repository metadata and temp files", async () => {
    const { list, listed } = lister({
      "": [file(".gitkeep"), dir(".git"), file("a.md"), dir("real"), link("alias"), link("gone"), link("f-link.md"), file(`x${TEMP_MARK}1`)],
      real: [file("x.md"), dir("deeper")],
      "real/deeper": [file(NFD)],
      alias: [file("never.md")],
    })
    const tree = await scanWorkingTree(list)
    expect([...tree.files].sort()).toEqual([".gitkeep", "a.md", `real/deeper/${NFD}`, "real/x.md"].sort())
    expect([...tree.symlinks].sort()).toEqual(["alias", "f-link.md", "gone"])
    expect(listed.sort()).toEqual(["", "real", "real/deeper"])
  })
})

describe("itemPaths and landingPath", () => {
  test("a key whose on-disk spelling is not NFC lands on that spelling; a new key lands on its own spelling", () => {
    const paths = itemPaths([NFD, "notes.md", `dir/${NFD}`])
    expect(paths.problems).toEqual([])
    expect(landingPath(paths, NFC)).toBe(NFD)
    expect(landingPath(paths, `dir/${NFC}`)).toBe(`dir/${NFD}`)
    expect(landingPath(paths, "notes.md")).toBe("notes.md")
    expect(landingPath(paths, "new.md")).toBe("new.md")
  })

  test("two on-disk spellings of one key make it ambiguous for capture and landing alike", () => {
    const paths = itemPaths([NFC, NFD])
    expect(landingPath(paths, NFC)).toBeNull()
    expect(paths.problems).toEqual([{ path: NFC, rule: "ambiguous-normalization" }])
  })

  test("an on-disk name the key grammar refuses is reported and never becomes an item", () => {
    const paths = itemPaths(["con.md", "ok.md"])
    expect(paths.problems).toEqual([{ path: "con.md", rule: "reserved-device-name" }])
    expect([...paths.byKey.keys()]).toEqual(["ok.md"])
  })
})
