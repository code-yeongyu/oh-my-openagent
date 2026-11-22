/// <reference types="bun-types" />

// A sparse checkout holds only the files it lists, so a listed script whose relative import is not listed dies with
// ERR_MODULE_NOT_FOUND on the runner. pr-platform-decision.yml shipped that way when ci-fast-path.mjs began importing
// release-state-paths.mjs, and every pull request's platform decision went red. Each listed script's whole relative
// import graph must be listed with it.

import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, normalize, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const workflowsDir = join(repoRoot, ".github/workflows")
const relativeSpecifier = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm

type Step = { readonly uses?: string; readonly with?: Record<string, unknown> }
type Workflow = { readonly jobs?: Record<string, { readonly steps?: readonly Step[] }> }

function sparseLists(): { readonly where: string; readonly paths: readonly string[] }[] {
  const lists: { where: string; paths: string[] }[] = []
  for (const file of readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = load(readFileSync(join(workflowsDir, file), "utf8")) as Workflow
    for (const [job, { steps = [] }] of Object.entries(workflow.jobs ?? {})) {
      for (const step of steps) {
        const sparse = step.with?.["sparse-checkout"]
        if (!step.uses?.startsWith("actions/checkout@") || typeof sparse !== "string") continue
        const paths = sparse.split("\n").map((line) => line.trim()).filter(Boolean)
        lists.push({ where: `${file} jobs.${job}`, paths })
      }
    }
  }
  return lists
}

function importClosure(entry: string): string[] {
  const seen = new Set<string>()
  const pending = [entry]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue
    seen.add(next)
    const source = readFileSync(join(repoRoot, next), "utf8")
    for (const match of source.matchAll(relativeSpecifier)) {
      const specifier = match[1]
      if (specifier !== undefined) pending.push(relative(repoRoot, normalize(join(repoRoot, dirname(next), specifier))))
    }
  }
  return [...seen]
}

test("#given every sparse workflow checkout #when its listed scripts are loaded #then each relative import they reach is listed too", () => {
  // given
  const lists = sparseLists()
  expect(lists.some(({ where }) => where.startsWith("pr-platform-decision.yml"))).toBe(true)

  // when
  const missing = lists.flatMap(({ where, paths }) =>
    paths
      .filter((path) => /\.[cm]?js$/.test(path))
      .flatMap((script) => importClosure(script).filter((reached) => !paths.includes(reached)))
      .map((reached) => `${where}: ${reached}`),
  )

  // then
  expect(missing).toEqual([])
})
