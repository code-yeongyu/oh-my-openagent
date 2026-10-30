#!/usr/bin/env bun
// Warms the Python stdlib the codemode Python kernel imports at startup, read from the installed kernel prelude, so
// the packaged eval smoke's first Python cell measures the kernel instead of a cold tool-cache read (#10904).
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

/** The prelude.py the engine embeds: senpi-codemode as resolved from the installed senpi engine package. */
export function preludePath(root = repoRoot) {
  const senpi = realpathSync(join(root, "node_modules", "@code-yeongyu", "senpi"))
  let directory = dirname(createRequire(join(senpi, "package.json")).resolve("@code-yeongyu/senpi-codemode"))
  while (!existsSync(join(directory, "package.json"))) directory = dirname(directory)
  return join(directory, "src", "kernels", "py", "prelude.py")
}

/** Module names of the prelude's module-level `import` / `from ... import` statements, in order, deduplicated. */
export function preludeImports(source) {
  const modules = []
  for (const line of source.split(/\r?\n/u)) {
    const plain = line.replace(/#.*$/u, "").trimEnd()
    const from = plain.match(/^from\s+([A-Za-z_][\w.]*)\s+import\b/u)
    const names = from ? [from[1]] : plain.match(/^import\s+(.+)$/u)?.[1].split(",").map((part) => part.trim().split(/\s+/u)[0]) ?? []
    for (const name of names) {
      if (name && name !== "__future__" && !modules.includes(name)) modules.push(name)
    }
  }
  return modules
}

if (import.meta.main) {
  const modules = preludeImports(readFileSync(preludePath(), "utf8"))
  if (modules.length === 0) throw new Error("the kernel prelude declares no module-level imports; is the path stale?")
  const started = performance.now()
  const result = spawnSync("python", ["-c", `import ${modules.join(", ")}`], { stdio: "inherit" })
  if (result.status !== 0) throw new Error(`python could not import the kernel prelude modules (exit ${result.status})`)
  process.stdout.write(`WARMUP python modules=${modules.length} ms=${Math.round(performance.now() - started)}\n`)
}
