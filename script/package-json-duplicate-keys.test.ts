import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { visit } from "jsonc-parser"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))

// JSON.parse keeps the last of two equal keys, so a merge that adds a second "lint" script silently
// drops the first. Bun also warns "Duplicate key" on stderr for the root package.json on every start,
// which breaks every test that asserts a child's stderr is empty (#11106).
function findDuplicateKeys(text: string): string[] {
  const duplicates: string[] = []
  const objects: { path: string; keys: Set<string> }[] = []
  let pendingPath = ""

  visit(text, {
    onObjectBegin: () => {
      objects.push({ path: pendingPath, keys: new Set() })
    },
    onObjectEnd: () => {
      objects.pop()
    },
    onObjectProperty: (property) => {
      const current = objects.at(-1)
      if (!current) return
      const propertyPath = current.path ? `${current.path}.${property}` : property
      if (current.keys.has(property)) duplicates.push(propertyPath)
      current.keys.add(property)
      pendingPath = propertyPath
    },
    onArrayBegin: () => {
      pendingPath = ""
    },
  })

  return duplicates
}

function trackedPackageJsonPaths(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "package.json", "**/package.json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((path) => path.length > 0)
}

describe("package.json duplicate keys", () => {
  test("#given the duplicate finder #when an object repeats a key #then it names the repeated path", () => {
    expect(findDuplicateKeys('{"scripts":{"lint":"a","test":"b","lint":"c"},"lint":{}}')).toEqual(["scripts.lint"])
    expect(findDuplicateKeys('{"a":{"x":1},"b":{"x":1},"c":[{"x":1},{"x":1}]}')).toEqual([])
  })

  test("#given every tracked package.json #when parsed #then no object repeats a key", () => {
    const paths = trackedPackageJsonPaths()
    expect(paths).toContain("package.json")

    const duplicates = paths.flatMap((path) =>
      findDuplicateKeys(readFileSync(join(repositoryRoot, path), "utf8")).map((key) => `${path}: ${key}`),
    )

    expect(duplicates).toEqual([])
  })
})
