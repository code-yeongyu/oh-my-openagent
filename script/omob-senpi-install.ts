import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export async function installSenpiTarball(tarballPath: string, installRoot: string): Promise<string> {
	rmSync(installRoot, { recursive: true, force: true })
	mkdirSync(installRoot, { recursive: true })
	// Bun resolves even bundled aliases from npm. Dev workspaces need not be published,
	// so retain the packed graph and install only the dependencies outside that bundle.
	await new Bun.Archive(await Bun.file(tarballPath).bytes()).extract(installRoot)
	const packageRoot = join(installRoot, "package")
	const manifest: {
		readonly bundleDependencies?: readonly string[]
		readonly bundledDependencies?: readonly string[]
		readonly dependencies?: Readonly<Record<string, string>>
		readonly optionalDependencies?: Readonly<Record<string, string>>
	} = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
	const bundled = new Set(manifest.bundleDependencies ?? manifest.bundledDependencies ?? [])
	for (const name of bundled) {
		if (!existsSync(join(packageRoot, "node_modules", name, "package.json"))) {
			throw new Error(`missing bundled dependency: ${name}`)
		}
	}
	const dependencies = Object.fromEntries(Object.entries(manifest.dependencies ?? {}).filter(([name]) => !bundled.has(name)))
	const optionalDependencies = Object.fromEntries(Object.entries(manifest.optionalDependencies ?? {}).filter(([name]) => !bundled.has(name)))
	if (Object.keys(dependencies).length === 0 && Object.keys(optionalDependencies).length === 0) return packageRoot
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
	const target = join(packageRoot, "node_modules")
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
