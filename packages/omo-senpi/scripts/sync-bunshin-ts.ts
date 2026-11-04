#!/usr/bin/env bun
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"

// Vendors the built publishable output of @sisyphuslabs/bunshin-ts and @sisyphuslabs/bunshin-ts-relay into
// packages/omo-senpi/vendor/<package>/. Neither package is on npm and their source repositories are private (tracked
// internally), so the caller passes a local checkout of each. For every package in vendor/PIN.json this exports the
// pinned commit from that checkout (git archive, so the checkout itself is never touched), installs the exported tree
// from its own lockfile, runs the package's own publish build and compares the output with the PIN digests. A mismatch
// exits 1; --write replaces the vendored copy and the PIN instead. --commit <package>=<sha> re-pins a package.
// Run from the repo root:
//   bun packages/omo-senpi/scripts/sync-bunshin-ts.ts --bunshin-ts <checkout> --bunshin-ts-relay <checkout> [--write]
// src/bunshin-ts-vendor.test.ts holds the vendored bytes to PIN.json between syncs.

type PinnedPackage = {
	readonly name: string
	readonly version: string
	readonly commit: string
	readonly packageDir: string
	readonly dependencies: Readonly<Record<string, string>>
	readonly files: Readonly<Record<string, string>>
}

type Pin = { readonly note: string; readonly packages: Readonly<Record<string, PinnedPackage>> }

type PublishManifest = {
	readonly name: string
	readonly version: string
	readonly dependencies?: Readonly<Record<string, string>>
}

const VENDOR_ROOT = join(import.meta.dir, "..", "vendor")
const PIN_PATH = join(VENDOR_ROOT, "PIN.json")
// The publish manifest is recorded in PIN.json (name, version, dependencies) instead of being vendored: a nested
// package.json would make the vendored directory look like a workspace package to the repo's tooling.
const MANIFEST = "package.json"

// The one rule for what is vendored: everything but the top-level publish manifest. A package.json deeper in the
// output is package content, so it is copied and digested like any other file.
const isVendored = (path: string): boolean => path !== MANIFEST

const portable = (root: string, file: string): string => relative(root, file).split(sep).join("/")

const run = async (command: readonly string[], cwd: string): Promise<string> => {
	const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" })
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	])
	if (code !== 0) throw new Error(`${command.join(" ")} exited ${code} in ${cwd}:\n${err.trim()}`)
	return out.trim()
}

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
	)

export const digestTree = (dir: string): Record<string, string> =>
	Object.fromEntries(
		walk(dir)
			.map((file) => [portable(dir, file), sha256(readFileSync(file))] as const)
			.filter(([path]) => isVendored(path))
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
	)

export const copyVendored = (out: string, dest: string): void => {
	cpSync(out, dest, { recursive: true, filter: (src) => src === out || isVendored(portable(out, src)) })
}

const flag = (argv: readonly string[], name: string): string | undefined => {
	const at = argv.indexOf(name)
	return at >= 0 ? argv[at + 1] : undefined
}

const buildAt = async (checkout: string, pinned: PinnedPackage, commit: string, work: string): Promise<string> => {
	const tree = join(work, "tree")
	const out = join(work, "out")
	const sha = await run(["git", "-C", checkout, "rev-parse", "--verify", `${commit}^{commit}`], work)
	await run(["sh", "-c", `mkdir -p "${tree}" && git -C "$0" archive "$1" | tar -x -C "${tree}"`, checkout, sha], work)
	await run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], tree)
	await run(["bun", join(pinned.packageDir, "scripts", "build.ts"), out], tree)
	return out
}

const syncPackage = async (
	key: string,
	pinned: PinnedPackage,
	checkout: string,
	commit: string,
	write: boolean,
): Promise<PinnedPackage | undefined> => {
	const work = mkdtempSync(join(tmpdir(), `sync-${key}-`))
	try {
		const out = await buildAt(checkout, pinned, commit, work)
		const manifest = JSON.parse(readFileSync(join(out, MANIFEST), "utf8")) as PublishManifest
		const next: PinnedPackage = {
			...pinned,
			name: manifest.name,
			version: manifest.version,
			commit: await run(["git", "-C", checkout, "rev-parse", `${commit}^{commit}`], work),
			dependencies: manifest.dependencies ?? {},
			files: digestTree(out),
		}
		if (JSON.stringify(next) === JSON.stringify(pinned)) {
			console.log(`${key}: matches ${pinned.name}@${pinned.version} built at ${pinned.commit}`)
			return undefined
		}
		const drifted = Object.keys({ ...pinned.files, ...next.files }).filter((p) => pinned.files[p] !== next.files[p])
		console.log(`${key}: differs from PIN (${drifted.length} file(s)): ${drifted.join(", ") || "manifest only"}`)
		if (!write) return next
		rmSync(join(VENDOR_ROOT, key), { recursive: true, force: true })
		copyVendored(out, join(VENDOR_ROOT, key))
		return next
	} finally {
		rmSync(work, { recursive: true, force: true })
	}
}

const main = async (argv: readonly string[]): Promise<number> => {
	const pin = JSON.parse(readFileSync(PIN_PATH, "utf8")) as Pin
	const write = argv.includes("--write")
	const recommits = new Map(
		argv.flatMap((arg, i) => (argv[i - 1] === "--commit" ? [arg.split("=", 2) as [string, string]] : [])),
	)
	const packages: Record<string, PinnedPackage> = { ...pin.packages }
	let drift = false
	for (const [key, pinned] of Object.entries(pin.packages)) {
		const checkout = flag(argv, `--${key}`)
		if (checkout === undefined) throw new Error(`pass --${key} <local checkout of the ${pinned.name} source>`)
		const next = await syncPackage(key, pinned, checkout, recommits.get(key) ?? pinned.commit, write)
		if (next === undefined) continue
		drift = true
		packages[key] = next
	}
	if (!drift) return 0
	if (!write) return 1
	await Bun.write(PIN_PATH, `${JSON.stringify({ ...pin, packages }, null, "\t")}\n`)
	console.log("vendor/PIN.json updated; rebuild the plugin (build-extension.mjs) and commit vendor/ with it")
	return 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
