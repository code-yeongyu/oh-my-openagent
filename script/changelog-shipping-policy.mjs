import { posix } from "node:path"

function matchesEntry(path, entry) {
  return new Bun.Glob(entry).match(path) || new Bun.Glob(`${entry.replace(/\/$/, "")}/**`).match(path)
}

function matchesPackage(path, { directory, manifest }) {
  const relative = posix.relative(directory || ".", path)
  if (relative.startsWith("../")) return false
  const files = manifest.files ?? []
  if (files.some((entry) => entry.startsWith("!") && matchesEntry(relative, entry.slice(1)))) return false
  const bins = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {})
  return relative === "package.json" || bins.includes(relative)
    || files.some((entry) => !entry.startsWith("!") && matchesEntry(relative, entry))
}

export function isTestOrGeneratedPath(path) {
  return /(^|\/)(?:tests?|__tests__|__fixtures__|fixtures|test-fixtures|test-support|node_modules|dist|build|install-dist)(\/|$)/.test(path)
    || /(?:^|\/)(?:[^/]*_)?tests?\.rs$/.test(path)
    || /\.(?:test|spec|snap|fixture|test-fixtures?|test-harness|test-helpers?)\.[^/]+$/.test(path)
    || /(?:^|[\/.-])(?:fixtures?|test-harness|test-utils|test-support|test-helpers?|test-fixtures?|test-runtime)\.[cm]?[jt]sx?$/.test(path)
    || (path.includes("/testing/") && path !== "packages/omo-opencode/src/testing/create-plugin-module.ts")
    || /(?:^|\/)(?:AGENTS|README|CHANGELOG|changes|THIRD-PARTY-NOTICES)\.md$/i.test(path)
    || /^packages\/omo-senpi\/plugin\/extensions\//.test(path)
    || /(?:^|\/)[^/]+\.generated\.[^/]+$/.test(path)
}

export function isUserFacingPath(path, policy) {
  if (isTestOrGeneratedPath(path) || /^(?:docs|\.github)\//.test(path)) return false
  if (policy.generators.has(path) || policy.crates.some((root) => path === root || path.startsWith(`${root}/`))) return true
  if (policy.crates.length && ["Cargo.toml", "Cargo.lock"].includes(path)) return true
  if (policy.packages.some((pkg) => matchesPackage(path, pkg))) return true
  return policy.packages.some(({ directory, manifest }) => {
    if (!directory || !path.startsWith(`${directory}/`)) return false
    const relative = path.slice(directory.length + 1)
    // Workspace source becomes bundled payload; native bin packages also compile root TS inputs.
    return /^(?:src|skills|prompts)\//.test(relative)
      || (manifest.bin && /^[^/]+\.tsx?$/.test(relative))
  })
}

// Read tracked tree data, never import a package or execute a release generator.
export function shippingPolicy(paths, read) {
  const tracked = new Set(paths)
  const manifests = paths.filter((path) => path === "package.json" || /^packages\/.*\/package\.json$/.test(path))
    .filter((path) => !isTestOrGeneratedPath(path) && !path.includes("/upstreams/"))
    .map((path) => ({ directory: posix.dirname(path) === "." ? "" : posix.dirname(path), manifest: JSON.parse(read(path)) }))
  const packages = manifests.filter(({ directory, manifest }) =>
    !directory || (!manifest.private && (manifest.files || manifest.bin)) || manifest.pi)
  // Private plugin/component manifests can be shipped by a parent's files allowlist.
  for (const pkg of manifests) {
    if (!packages.includes(pkg) && packages.some((parent) => matchesPackage(`${pkg.directory}/package.json`, parent))) packages.push(pkg)
  }
  // Private workspaces exporting runtime TS supply sources to the published bundles.
  for (const pkg of manifests) {
    if (!packages.includes(pkg) && /"[^"]*src\/[^"]*"/.test(JSON.stringify(pkg.manifest.exports ?? pkg.manifest.main ?? ""))) packages.push(pkg)
  }
  const generators = new Set()
  const addCommands = (commands, directory, buildOnly = false) => {
    for (const command of commands) {
      for (const match of command.matchAll(/(?:bun(?: run)?|node)\s+([A-Za-z0-9_./-]+\.(?:ts|mjs|js))\b/g)) {
        const path = posix.normalize(posix.join(directory, match[1]))
        if (buildOnly && !/^(?:build|stage|sync|materialize)[-.]/.test(posix.basename(path))) continue
        if (tracked.has(path) && !isTestOrGeneratedPath(path)) generators.add(path)
      }
    }
  }
  for (const { directory, manifest } of packages) {
    addCommands(Object.entries(manifest.scripts ?? {}).filter(([name]) => /^(?:build(?::|$)|prepack$|prepare$)/.test(name)).map(([, command]) => command), directory)
  }
  for (const path of paths.filter((path) => /^\.github\/workflows\/publish[^/]*\.ya?ml$/.test(path))) addCommands([read(path)], "", true)
  // Include the imported helpers that shape generated launcher, installer, and sidecar payloads.
  const scanner = new Bun.Transpiler({ loader: "ts" })
  for (const path of generators) {
    if (path.endsWith(".json")) continue
    for (const { path: specifier } of scanner.scanImports(read(path).replace(/^#![^\n]*\n/, ""))) {
      if (!specifier.startsWith(".")) continue
      const stem = posix.normalize(posix.join(posix.dirname(path), specifier))
      const imported = [stem, `${stem}.ts`, `${stem}.mjs`, `${stem}.js`, `${stem}/index.ts`].find((candidate) => tracked.has(candidate))
      if (imported && /(?:^|\/)scripts?\//.test(imported) && !isTestOrGeneratedPath(imported) && /\.(?:ts|mjs|js|json)$/.test(imported)) generators.add(imported)
    }
  }
  const cargo = paths.filter((path) => /^crates\/[^/]+\/Cargo\.toml$/.test(path))
    .map((path) => ({ root: posix.dirname(path), manifest: Bun.TOML.parse(read(path)) }))
  const crates = new Set(cargo.filter(({ root, manifest }) => manifest.bin?.length || tracked.has(`${root}/src/main.rs`)).map(({ root }) => root))
  for (const root of crates) {
    const { manifest } = cargo.find((crate) => crate.root === root)
    const dependencies = [manifest.dependencies, manifest["build-dependencies"],
      ...Object.values(manifest.target ?? {}).flatMap((target) => [target.dependencies, target["build-dependencies"]])]
    for (const table of dependencies) {
      for (const dependency of Object.values(table ?? {})) {
        if (dependency.path) crates.add(posix.normalize(posix.join(root, dependency.path)))
      }
    }
  }
  return { packages, generators, crates: [...crates] }
}
