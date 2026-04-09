import * as fs from "node:fs"
import * as path from "node:path"
import {
  ALIAS_BINARY_NAME,
  ALIAS_PACKAGE_NAME,
  ALIAS_SCHEMA_FILE,
  CANONICAL_BINARY_NAME,
  CANONICAL_PACKAGE_NAME,
  CANONICAL_SCHEMA_FILE,
  renameOptionalDependencyKeys,
} from "./identity"

interface PackageJson {
  name: string
  version: string
  description?: string
  bin?: Record<string, string>
  exports?: Record<string, unknown>
  optionalDependencies?: Record<string, string>
  scripts?: Record<string, string>
  [key: string]: unknown
}

interface AliasMainPackageOptions {
  version?: string
}

function copyIfExists(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) return
  fs.cpSync(sourcePath, targetPath, { recursive: true })
}

function removeIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  fs.rmSync(filePath, { recursive: true, force: true })
}

function rewriteFile(filePath: string, replacements: Array<[string, string]>): void {
  if (!fs.existsSync(filePath)) return

  let content = fs.readFileSync(filePath, "utf-8")
  for (const [from, to] of replacements) {
    if (!content.includes(from)) {
      throw new Error(`Expected to find '${from}' in ${filePath}`)
    }
    content = content.split(from).join(to)
  }
  fs.writeFileSync(filePath, content)
}

function createAliasManifest(pkg: PackageJson, options: AliasMainPackageOptions): PackageJson {
  const exportsField = { ...(pkg.exports ?? {}) }
  if (exportsField["./schema.json"] === `./dist/${CANONICAL_SCHEMA_FILE}`) {
    exportsField["./schema.json"] = `./dist/${ALIAS_SCHEMA_FILE}`
  }

  const version = options.version ?? pkg.version
  const scripts = { ...(pkg.scripts ?? {}) }
  delete scripts.prepare
  delete scripts.prepublishOnly

  const nextScripts = Object.keys(scripts).length > 0 ? scripts : undefined

  return {
    ...pkg,
    name: ALIAS_PACKAGE_NAME,
    version,
    bin: {
      [ALIAS_BINARY_NAME]: `bin/${ALIAS_BINARY_NAME}.js`,
    },
    exports: exportsField,
    scripts: nextScripts,
    optionalDependencies: renameOptionalDependencyKeys(
      pkg.optionalDependencies,
      CANONICAL_PACKAGE_NAME,
      ALIAS_PACKAGE_NAME
    )
      ? Object.fromEntries(
          Object.entries(
            renameOptionalDependencyKeys(
              pkg.optionalDependencies,
              CANONICAL_PACKAGE_NAME,
              ALIAS_PACKAGE_NAME
            ) ?? {}
          ).map(([name]) => [name, version])
        )
      : undefined,
  }
}

function copyPackageFiles(sourceRoot: string, outDir: string): void {
  for (const entry of ["dist", "bin", "postinstall.mjs", "package.json"]) {
    copyIfExists(path.join(sourceRoot, entry), path.join(outDir, entry))
  }

  for (const entry of fs.readdirSync(sourceRoot)) {
    if (!/^(README|LICENSE)/i.test(entry)) continue
    copyIfExists(path.join(sourceRoot, entry), path.join(outDir, entry))
  }
}

function rewriteRuntimeIdentity(outDir: string): void {
  rewriteFile(path.join(outDir, "bin", "platform.js"), [[CANONICAL_BINARY_NAME, ALIAS_BINARY_NAME]])
  rewriteFile(path.join(outDir, "bin", `${ALIAS_BINARY_NAME}.js`), [[CANONICAL_BINARY_NAME, ALIAS_BINARY_NAME]])
  rewriteFile(path.join(outDir, "postinstall.mjs"), [[CANONICAL_BINARY_NAME, ALIAS_BINARY_NAME]])

  rewriteFile(path.join(outDir, "dist", "index.js"), [
    [`var PACKAGE_NAME = "${CANONICAL_PACKAGE_NAME}";`, `var PACKAGE_NAME = "${ALIAS_PACKAGE_NAME}";`],
  ])
  const cliIndexPath = path.join(outDir, "dist", "cli", "index.js")
  if (fs.existsSync(cliIndexPath)) {
    const cliIndexContent = fs.readFileSync(cliIndexPath, "utf-8")
    if (cliIndexContent.includes(`var PACKAGE_NAME2 = "${CANONICAL_PACKAGE_NAME}",`)) {
      rewriteFile(cliIndexPath, [
        [`var PACKAGE_NAME2 = "${CANONICAL_PACKAGE_NAME}",`, `var PACKAGE_NAME2 = "${ALIAS_PACKAGE_NAME}",`],
      ])
    } else {
      rewriteFile(cliIndexPath, [
        [`var PACKAGE_NAME2 = "${CANONICAL_PACKAGE_NAME}";`, `var PACKAGE_NAME2 = "${ALIAS_PACKAGE_NAME}";`],
      ])
    }
  }
  rewriteFile(path.join(outDir, "dist", "hooks", "auto-update-checker", "constants.d.ts"), [
    [`export declare const PACKAGE_NAME = "${CANONICAL_PACKAGE_NAME}";`, `export declare const PACKAGE_NAME = "${ALIAS_PACKAGE_NAME}";`],
    [
      `export declare const NPM_REGISTRY_URL = "https://registry.npmjs.org/-/package/${CANONICAL_PACKAGE_NAME}/dist-tags";`,
      `export declare const NPM_REGISTRY_URL = "https://registry.npmjs.org/-/package/${ALIAS_PACKAGE_NAME}/dist-tags";`,
    ],
  ])
}

export function createAliasMainPackage(
  sourceRoot: string,
  outDir: string,
  options: AliasMainPackageOptions = {}
): void {
  removeIfExists(outDir)
  fs.mkdirSync(outDir, { recursive: true })

  copyPackageFiles(sourceRoot, outDir)

  const packageJsonPath = path.join(outDir, "package.json")
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PackageJson
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(createAliasManifest(packageJson, options), null, 2)}\n`)

  const canonicalWrapperPath = path.join(outDir, "bin", `${CANONICAL_BINARY_NAME}.js`)
  const aliasWrapperPath = path.join(outDir, "bin", `${ALIAS_BINARY_NAME}.js`)
  if (!fs.existsSync(canonicalWrapperPath)) {
    throw new Error(`Expected canonical wrapper at ${canonicalWrapperPath}`)
  }

  fs.copyFileSync(canonicalWrapperPath, aliasWrapperPath)
  removeIfExists(canonicalWrapperPath)

  const canonicalSchemaPath = path.join(outDir, "dist", CANONICAL_SCHEMA_FILE)
  const aliasSchemaPath = path.join(outDir, "dist", ALIAS_SCHEMA_FILE)
  if (fs.existsSync(canonicalSchemaPath)) {
    fs.copyFileSync(canonicalSchemaPath, aliasSchemaPath)
    removeIfExists(canonicalSchemaPath)
  }

  rewriteRuntimeIdentity(outDir)
}
