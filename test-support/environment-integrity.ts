import { readFile } from "node:fs/promises"
import { extname } from "node:path"

export function restoreEnvironment(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(snapshot, key)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const fileBaselines = new Map<string, NodeJS.ProcessEnv>()

export function checkFileEnvironment(path: string): void {
  const baseline = fileBaselines.get(path)
  if (!baseline) throw new Error(`Missing test environment snapshot for ${path}`)
  fileBaselines.delete(path)
  const added = Object.keys(process.env).filter((key) => !Object.hasOwn(baseline, key)).sort()
  const removed = Object.keys(baseline).filter((key) => !Object.hasOwn(process.env, key)).sort()
  const changed = Object.keys(baseline).filter((key) => Object.hasOwn(process.env, key) && process.env[key] !== baseline[key]).sort()
  restoreEnvironment(baseline)
  if (added.length || removed.length || changed.length) {
    throw new Error(`Test file ${path} leaked process.env: added [${added.join(", ")}]; removed [${removed.join(", ")}]; changed [${changed.join(", ")}]`)
  }
}

export function installEnvironmentIntegrityCheck(): void {
  Bun.plugin({
    name: "test-file-environment-integrity",
    setup(build) {
      build.onLoad({ filter: /\.(test|spec)\.[cm]?[jt]sx?$/ }, async ({ path }) => {
        const contents = await readFile(path, "utf8")
        fileBaselines.set(path, { ...process.env })
        const suffix = `\nimport { afterAll as __omoEnvAfterAll } from "bun:test";\nimport { checkFileEnvironment as __omoCheckFileEnv } from ${JSON.stringify(import.meta.path)};\n__omoEnvAfterAll(() => __omoCheckFileEnv(${JSON.stringify(path)}));\n`
        const extension = extname(path)
        const loader = extension === ".tsx" ? "tsx" : extension === ".jsx" ? "jsx" : extension.endsWith("ts") ? "ts" : "js"
        return { contents: contents + suffix, loader }
      })
    },
  })
}
