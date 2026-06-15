import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const generatedEntrypoint = join(repositoryRoot, "packages", "omo-codex", "scripts", "install-dist", "install-local.mjs")
const builtinModuleNames = new Set(builtinModules.filter((moduleName) => !moduleName.startsWith("node:")))

const buildResult = await Bun.build({
  entrypoints: [join(repositoryRoot, "packages", "omo-codex", "src", "install", "install-local-cli.ts")],
  outdir: dirname(generatedEntrypoint),
  target: "node",
  format: "esm",
  splitting: false,
  minify: false,
  sourcemap: "none",
  naming: "install-local.mjs",
  packages: "bundle",
})

if (!buildResult.success) {
  for (const log of buildResult.logs) {
    console.error(log.message)
  }
  process.exit(1)
}

await mkdir(dirname(generatedEntrypoint), { recursive: true })
const generatedSource = await readFile(generatedEntrypoint, "utf8")
const nodeBuiltinSource = rewriteBareBuiltinSpecifiers(generatedSource)
const executableSource = nodeBuiltinSource.startsWith("#!/usr/bin/env node")
  ? nodeBuiltinSource
  : `#!/usr/bin/env node\n${nodeBuiltinSource}`
await writeFile(generatedEntrypoint, executableSource)
await chmod(generatedEntrypoint, 0o755)

function rewriteBareBuiltinSpecifiers(source: string): string {
  return source.replaceAll(
    /(from\s+["']|import\s*\(\s*["']|require\s*\(\s*["'])([^"']+)(["'])/g,
    (match: string, prefix: string, specifier: string, suffix: string) => {
      if (specifier.startsWith("node:")) return match
      if (!builtinModuleNames.has(specifier)) return match
      return `${prefix}node:${specifier}${suffix}`
    },
  )
}
