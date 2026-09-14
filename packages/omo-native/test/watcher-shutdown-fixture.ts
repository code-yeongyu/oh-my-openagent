import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { patchWatcherShutdown } from "../bin/lib/watcher-shutdown.js"

const engineRoot = join(import.meta.dir, "../../../node_modules/@code-yeongyu/senpi")
const configPath = "dist/core/extensions/builtin/config-reload"
const moduleNames = ["watch-event-source.js", "watch-engine.js", "index.js"] as const

/** Isolate installed-engine modules without mocking their lifecycle implementation. */
export async function watcherFixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-watch-shutdown-"))
  const target = join(root, configPath)
  await mkdir(target, { recursive: true })
  try {
    for (const name of moduleNames) {
      const original = join(engineRoot, configPath, name)
      const source = (await readFile(original, "utf8"))
        .replace(/from "([^"]+)"/g, (_match, specifier: string) => {
          const local = moduleNames.find((entry) => specifier === `./${entry}`)
          const resolved = local ? pathToFileURL(join(target, local)).href : import.meta.resolve(specifier, original)
          return `from ${JSON.stringify(resolved)}`
        })
        .replace("const RECURSIVE_WATCH_WORKER_SOURCE", "export const RECURSIVE_WATCH_WORKER_SOURCE")
      await writeFile(join(target, name), source)
    }
    patchWatcherShutdown(root)
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    const [events, engine, extension] = await Promise.all(moduleNames.map((name) => import(pathToFileURL(join(target, name)).href)))
    return { root, events, engine, extension, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export function immediateTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
