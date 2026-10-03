import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

interface PackageManifest {
	readonly name?: string
	readonly bundleDependencies?: readonly string[]
	readonly bundledDependencies?: readonly string[]
	readonly dependencies?: Readonly<Record<string, string>>
	readonly optionalDependencies?: Readonly<Record<string, string>>
	readonly peerDependencies?: Readonly<Record<string, string>>
	readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
}

function readManifest(packageRoot: string): PackageManifest {
	return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as PackageManifest
}

async function extractPackage(tarballPath: string, destination: string): Promise<void> {
	mkdirSync(dirname(destination), { recursive: true })
	const staging = mkdtempSync(`${destination}.extract-`)
	try {
		await new Bun.Archive(await Bun.file(tarballPath).bytes()).extract(staging)
		const packageRoot = join(staging, "package")
		if (!existsSync(join(packageRoot, "package.json"))) throw new Error(`${tarballPath} has no package/package.json`)
		renameSync(packageRoot, destination)
	} finally {
		rmSync(staging, { recursive: true, force: true })
	}
}

type ExternalDependencies = Map<string, { readonly spec: string; optional: boolean; readonly owner: string }>

function addExternal(externals: ExternalDependencies, name: string, spec: string, optional: boolean, owner: string): void {
	const existing = externals.get(name)
	if (existing === undefined) {
		externals.set(name, { spec, optional, owner })
		return
	}
	if (existing.spec !== spec) {
		throw new Error(`${owner} requires ${name}@${spec} but ${existing.owner} requires ${name}@${existing.spec}; one flat engine install cannot satisfy both`)
	}
	if (!optional) existing.optional = false
}

/**
 * Installs a packed senpi engine for the omob dev binary.
 *
 * The published engine reaches its lockstep workspaces (`pi-ai`, `pi-tui`, ...) through exact
 * registry aliases at the SAME version string it carries. A source build at that version is not
 * the published one, so letting the registry resolve those aliases mixes current engine code with
 * stale siblings. `localPackages` maps each lockstep dependency name to a tarball packed from the
 * same checkout; every reachable one is placed beside the engine, and only the remaining external
 * dependencies are installed from the registry. Packages listed in `bundleDependencies` are taken
 * from the tarball as packed.
 */
export async function installSenpiTarball(
	tarballPath: string,
	installRoot: string,
	localPackages: Readonly<Record<string, string>> = {},
): Promise<string> {
	rmSync(installRoot, { recursive: true, force: true })
	mkdirSync(installRoot, { recursive: true })
	await new Bun.Archive(await Bun.file(tarballPath).bytes()).extract(installRoot)
	const packageRoot = join(installRoot, "package")
	const target = join(packageRoot, "node_modules")
	const manifest = readManifest(packageRoot)
	const bundled = new Set(manifest.bundleDependencies ?? manifest.bundledDependencies ?? [])
	for (const name of bundled) {
		if (!existsSync(join(target, name, "package.json"))) {
			throw new Error(`missing bundled dependency: ${name}`)
		}
		if (localPackages[name] !== undefined) throw new Error(`${name} is both bundled in the engine tarball and supplied as a local package`)
	}

	const externals: ExternalDependencies = new Map()
	const placed = new Set<string>()
	const pending: Array<{ readonly owner: string; readonly manifest: PackageManifest; readonly peers: boolean }> = [
		{ owner: manifest.name ?? "engine", manifest, peers: false },
	]
	while (pending.length > 0) {
		const current = pending.shift()
		if (current === undefined) break
		const edges: Array<readonly [string, string, boolean]> = [
			...Object.entries(current.manifest.dependencies ?? {}).map(([name, spec]) => [name, spec, false] as const),
			...Object.entries(current.manifest.optionalDependencies ?? {}).map(([name, spec]) => [name, spec, true] as const),
			...(current.peers
				? Object.entries(current.manifest.peerDependencies ?? {}).map(
						([name, spec]) => [name, spec, current.manifest.peerDependenciesMeta?.[name]?.optional === true] as const,
					)
				: []),
		]
		for (const [name, spec, optional] of edges) {
			// A sibling's peer on the engine itself is satisfied by the package being assembled.
			if (name === manifest.name || bundled.has(name)) continue
			const localTarball = localPackages[name]
			if (localTarball === undefined) {
				addExternal(externals, name, spec, optional, current.owner)
				continue
			}
			if (placed.has(name)) continue
			placed.add(name)
			const destination = join(target, name)
			await extractPackage(localTarball, destination)
			pending.push({ owner: name, manifest: readManifest(destination), peers: true })
		}
	}

	const dependencies = Object.fromEntries([...externals].filter(([, entry]) => !entry.optional).map(([name, entry]) => [name, entry.spec]))
	const optionalDependencies = Object.fromEntries([...externals].filter(([, entry]) => entry.optional).map(([name, entry]) => [name, entry.spec]))
	if (externals.size === 0) return packageRoot
	writeFileSync(join(installRoot, "package.json"), `${JSON.stringify({
		private: true, dependencies, optionalDependencies,
	}, undefined, "\t")}\n`)
	await new Promise<void>((resolveInstall, rejectInstall) => {
		const child = spawn("bun", ["install", "--production", "--ignore-scripts"], { cwd: installRoot, stdio: "inherit" })
		child.once("error", rejectInstall)
		child.once("close", (status) => {
			if (status === 0) resolveInstall()
			else rejectInstall(new Error(`bun install --production --ignore-scripts failed with exit code ${status}`))
		})
	})
	mkdirSync(target, { recursive: true })
	if (!existsSync(join(installRoot, "node_modules"))) return packageRoot
	for (const entry of readdirSync(join(installRoot, "node_modules"))) {
		if (entry.startsWith(".")) continue
		const from = join(installRoot, "node_modules", entry)
		const to = join(target, entry)
		if (entry.startsWith("@")) {
			mkdirSync(to, { recursive: true })
			for (const child of readdirSync(from)) {
				if (!existsSync(join(to, child))) renameSync(join(from, child), join(to, child))
			}
		} else if (!existsSync(to)) {
			renameSync(from, to)
		}
	}
	return packageRoot
}
