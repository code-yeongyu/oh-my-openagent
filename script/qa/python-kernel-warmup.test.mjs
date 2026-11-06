import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { preludeImports, preludePath } from "./python-kernel-warmup.mjs"

const AST_IMPORTS = [
  "import ast, sys",
  "tree = ast.parse(open(sys.argv[1], encoding='utf-8').read())",
  "names = []",
  "for node in tree.body:",
  "    found = [alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module != '__future__' else []",
  "    names += [name for name in found if name not in names]",
  "print('\\n'.join(names))",
].join("\n")

function python() {
  for (const command of ["python3", "python"]) {
    if (spawnSync(command, ["--version"]).status === 0) return command
  }
  return undefined
}

describe("python kernel warm-up", () => {
  it("#given the installed engine #when the prelude is located #then it exists and imports the stdlib the kernel starts with", () => {
    const path = preludePath()
    expect(existsSync(path)).toBe(true)
    const modules = preludeImports(readFileSync(path, "utf8"))
    expect(modules).toEqual(expect.arrayContaining(["asyncio", "subprocess", "urllib.request", "concurrent.futures"]))
  })

  it("#given the real prelude #when its module-level imports are read #then they equal Python's own parse of the file", () => {
    const interpreter = python()
    if (interpreter === undefined) throw new Error("python is required to cross-check the prelude imports")
    const path = preludePath()
    const parsed = spawnSync(interpreter, ["-c", AST_IMPORTS, path], { encoding: "utf8" })
    expect(parsed.status).toBe(0)
    expect(preludeImports(readFileSync(path, "utf8"))).toEqual(parsed.stdout.trim().split(/\r?\n/u))
  })

  it("#given aliases, comments and nested imports #when imports are read #then only module-level module names remain", () => {
    const source = [
      "from __future__ import annotations",
      "import os, json as j  # noqa",
      "from concurrent.futures import ThreadPoolExecutor",
      "from . import sibling",
      "def f():",
      "    import ctypes",
      "import os",
    ].join("\n")
    expect(preludeImports(source)).toEqual(["os", "json", "concurrent.futures"])
  })
})
