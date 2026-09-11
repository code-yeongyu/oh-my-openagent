import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/**
 * Inlines the css-tree data that a compiled binary cannot resolve.
 *
 * css-tree loads `data/patch.json`, the three mdn-data dictionaries and its own
 * `package.json` through `createRequire(import.meta.url)` at module scope. Bun's
 * compiled filesystem serves no dynamic require, so every one of them throws
 * from inside `/$bunfs/root/<binary>` (verified: relative JSON, bare mdn-data
 * JSON and relative package.json all fail there). jsdom pulls css-tree in, so
 * the first webfetch HTML conversion dies with
 * `Cannot find module '../data/patch.json'` before any content is converted.
 *
 * Senpi inlines the same data before its own `build:binary`
 * (scripts/prepare-bun-compile-assets.mjs), but that script is not part of the
 * published package, so the installed engine is prepared here: the one hook both
 * the release-binary build (omo-native postinstall) and the omob dev build
 * (script/build-omob.ts swapSenpi) already run against the engine tree they are
 * about to compile. jsdom's own `__dirname` reads survive bun compile and are
 * deliberately left untouched.
 */
export function prepareCompileSafeEngine(senpiRoot) {
  const cssTreeRoot = resolvePackageRoot(senpiRoot, "css-tree")
  if (cssTreeRoot === undefined) return
  inlineDataPatch(cssTreeRoot)
  inlineMdnData(cssTreeRoot)
  inlineVersion(cssTreeRoot)
}

function resolvePackageRoot(fromRoot, packageName) {
  const nested = join(fromRoot, "node_modules", packageName)
  if (existsSync(join(nested, "package.json"))) return nested
  try {
    return dirname(createRequire(join(fromRoot, "package.json")).resolve(`${packageName}/package.json`))
  } catch {
    return undefined
  }
}

function serializeJsonFile(path) {
  return JSON.stringify(JSON.parse(readFileSync(path, "utf8")), null, "\t")
}

function writeIfChanged(path, contents) {
  if (!existsSync(path)) return
  if (readFileSync(path, "utf8") === contents) return
  writeFileSync(path, contents)
}

/**
 * A file that matches neither the upstream source shape nor the already-inlined
 * form is css-tree drift: failing here beats shipping a binary that only breaks
 * once a user fetches a page.
 */
function inlineOnce(path, pattern, replacement, inlinedMarker, relativeName) {
  if (!existsSync(path)) return
  const source = readFileSync(path, "utf8")
  const inlined = source.replace(pattern, () => replacement)
  if (inlined !== source) {
    writeFileSync(path, inlined)
    return
  }
  if (!source.includes(inlinedMarker)) throw new Error(`omo-ai: unsupported Senpi ${relativeName}`)
}

function inlineDataPatch(cssTreeRoot) {
  const patchJsonPath = join(cssTreeRoot, "data", "patch.json")
  if (!existsSync(patchJsonPath)) return
  const patch = `${serializeJsonFile(patchJsonPath)}\n`
  writeIfChanged(join(cssTreeRoot, "lib", "data-patch.js"), `const patch = ${patch}\nexport default patch;\n`)
  writeIfChanged(join(cssTreeRoot, "cjs", "data-patch.cjs"), `'use strict';\n\nmodule.exports = ${patch}`)
}

const CJS_MDN_REQUIRES =
  "const mdnAtrules = require('mdn-data/css/at-rules.json');\nconst mdnProperties = require('mdn-data/css/properties.json');\nconst mdnSyntaxes = require('mdn-data/css/syntaxes.json');"
const ESM_MDN_REQUIRES = `const require = createRequire(import.meta.url);\n${CJS_MDN_REQUIRES}`
const MDN_INLINED_MARKER = "const mdnAtrules = {"

function inlineMdnData(cssTreeRoot) {
  const mdnCssRoot = resolveMdnCssRoot(cssTreeRoot)
  if (mdnCssRoot === undefined) return
  const constants = [
    `const mdnAtrules = ${serializeJsonFile(join(mdnCssRoot, "at-rules.json"))};`,
    `const mdnProperties = ${serializeJsonFile(join(mdnCssRoot, "properties.json"))};`,
    `const mdnSyntaxes = ${serializeJsonFile(join(mdnCssRoot, "syntaxes.json"))};`,
  ].join("\n")
  inlineOnce(join(cssTreeRoot, "lib", "data.js"), ESM_MDN_REQUIRES, constants, MDN_INLINED_MARKER, "css-tree/lib/data.js")
  inlineOnce(join(cssTreeRoot, "cjs", "data.cjs"), CJS_MDN_REQUIRES, constants, MDN_INLINED_MARKER, "css-tree/cjs/data.cjs")
}

function resolveMdnCssRoot(cssTreeRoot) {
  const sibling = join(cssTreeRoot, "..", "mdn-data", "css")
  if (existsSync(join(sibling, "at-rules.json"))) return sibling
  try {
    return dirname(createRequire(join(cssTreeRoot, "package.json")).resolve("mdn-data/css/at-rules.json"))
  } catch {
    return undefined
  }
}

function inlineVersion(cssTreeRoot) {
  const packageJsonPath = join(cssTreeRoot, "package.json")
  if (!existsSync(packageJsonPath)) return
  const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  writeIfChanged(join(cssTreeRoot, "lib", "version.js"), `export const version = ${JSON.stringify(version)};\n`)
  writeIfChanged(
    join(cssTreeRoot, "cjs", "version.cjs"),
    `'use strict';\n\nmodule.exports.version = ${JSON.stringify(version)};\n`,
  )
}
