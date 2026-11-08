import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export function markChildStage(stage: string): void {
  const modules = Object.keys(require.cache).map(path => path.replaceAll("\\", "/"))
  const relevant = modules.filter(path => /\/(workpool|member-extension)\/|\/spawn-policy\./.test(path))
    .map(path => path.slice(path.lastIndexOf("/src/") + 5))
  const module_paths = process.env.OMO_QA_MEMBER_BOOT_MODULES === "1" ? modules.map(path => {
    if (/\/omp-item9-real-[^/]+\/provider\.ts$/.test(path)) return "<fixture>/provider.ts"
    const dependency = path.indexOf("/node_modules/")
    if (dependency >= 0) return path.slice(dependency + 1)
    const workspace = path.indexOf("/packages/")
    return workspace >= 0 ? path.slice(workspace + 1) : path
  }).sort() : undefined
  console.error(`COLD_REVIVE_CHILD ${JSON.stringify({ stage, elapsed_ms: performance.now(), cpu: process.cpuUsage(), modules: modules.length, relevant, module_paths })}`)
}

markChildStage("bootstrap")
