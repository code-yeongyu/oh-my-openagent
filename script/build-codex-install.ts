import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { builtinModules } from "node:module"
import { basename, dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const generatedEntrypoint = join(repositoryRoot, "packages", "omo-codex", "scripts", "install-dist", "install-local.mjs")
const installerSourceRoot = join(repositoryRoot, "packages", "omo-codex", "src", "install")
const builtinModuleNames = new Set(builtinModules.filter((moduleName) => !moduleName.startsWith("node:")))

export const generatedCodexInstallerPath = generatedEntrypoint

// The freshness marker records a digest of the installer SOURCES, never of the bundled output.
// Output bytes shift with the bundler version (CI pins a different Bun than a dev box), so a
// byte comparison would fail on a perfectly current bundle. Source bytes do not shift, so this
// flips only when someone edits installer source without regenerating the committed bundle.
// Same reasoning as `// omo-senpi-build:` in packages/omo-senpi/plugin/scripts/build-extension.mjs.
export const CODEX_INSTALL_BUILD_MARKER_PREFIX = "// omo-codex-install:"

const BUILD_SETTINGS = JSON.stringify({ target: "node", format: "esm", minify: false, packages: "bundle" })

function normalizeLineEndings(source: string): string {
  return source.replaceAll("\r\n", "\n")
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function toPortableBuildPath(path: string): string {
  return path.replaceAll("\\", "/")
}

async function installerSourceFiles(): Promise<readonly string[]> {
  const entries = await readdir(installerSourceRoot, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

// Digested over normalized text so a CRLF checkout on Windows and an LF checkout in CI agree.
export async function digestCodexInstallerSources(): Promise<string> {
  const hash = createHash("sha256").update(BUILD_SETTINGS)
  hash.update(normalizeLineEndings(await readFile(fileURLToPath(import.meta.url), "utf8")))
  for (const sourcePath of await installerSourceFiles()) {
    hash.update(toPortableBuildPath(relative(repositoryRoot, sourcePath)))
    hash.update(normalizeLineEndings(await readFile(sourcePath, "utf8")))
  }
  return hash.digest("hex")
}

export function parseCodexInstallerArtifact(
  text: string,
): { readonly sourceDigest: string; readonly bodyDigest: string; readonly body: string } | undefined {
  const lines = normalizeLineEndings(text).split("\n")
  const markerLine = lines[1]
  if (markerLine === undefined) return undefined
  const match = /^\/\/ omo-codex-install:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(markerLine)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return { sourceDigest: match[1], bodyDigest: match[2], body: lines.slice(2).join("\n") }
}

// The output path is a parameter so the freshness guard can build a throwaway copy and compare it
// against the committed bundle without clobbering the working tree.
export async function buildCodexInstaller(options: { readonly outputPath?: string } = {}): Promise<string> {
  const outputPath = options.outputPath ?? generatedEntrypoint
  await mkdir(dirname(outputPath), { recursive: true })

  const buildResult = await Bun.build({
    entrypoints: [join(repositoryRoot, "packages", "omo-codex", "src", "install", "install-local-cli.ts")],
    outdir: dirname(outputPath),
    target: "node",
    format: "esm",
    splitting: false,
    minify: false,
    sourcemap: "none",
    naming: basename(outputPath),
    packages: "bundle",
  })

  if (!buildResult.success) {
    for (const log of buildResult.logs) {
      console.error(log.message)
    }
    throw new Error("bun run build:codex-install failed")
  }

  const generatedSource = await readFile(outputPath, "utf8")
  const nodeBuiltinSource = rewriteBareBuiltinSpecifiers(generatedSource)
  const body = nodeBuiltinSource.startsWith("#!/usr/bin/env node")
    ? nodeBuiltinSource.slice(nodeBuiltinSource.indexOf("\n") + 1)
    : nodeBuiltinSource
  const marker = `${CODEX_INSTALL_BUILD_MARKER_PREFIX}${await digestCodexInstallerSources()}:${digestText(body)}`
  await writeFile(outputPath, `#!/usr/bin/env node\n${marker}\n${body}`)
  await chmod(outputPath, 0o755)
  return outputPath
}

if (import.meta.main) {
  try {
    await buildCodexInstaller()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

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
