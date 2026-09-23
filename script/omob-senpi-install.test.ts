import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function packFixture(root: string, files: Readonly<Record<string, string>>): Promise<string> {
	const path = join(root, "fixture.tgz")
	await Bun.write(path, new Bun.Archive(files, { compress: "gzip" }))
	return path
}

async function runInstall(tarball: string, root: string) {
	const requests: string[] = []
	const registry = Bun.serve({
		port: 0,
		fetch(request) {
			requests.push(new URL(request.url).pathname)
			return Response.json({ error: "fixture packages are not published" }, { status: 404 })
		},
	})
	try {
		const installRoot = join(root, "install")
		const child = Bun.spawn([process.execPath, "-e", `
			import { installSenpiTarball } from ${JSON.stringify(new URL("./omob-senpi-install.ts", import.meta.url).href)};
			console.log("PACKAGE_ROOT=" + await installSenpiTarball(${JSON.stringify(tarball)}, ${JSON.stringify(installRoot)}));
		`], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, BUN_CONFIG_REGISTRY: registry.url.href, BUN_INSTALL_CACHE_DIR: join(root, "cache") },
		})
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
		])
		return { exitCode, stdout, stderr, requests, packageRoot: stdout.match(/PACKAGE_ROOT=(.+)/)?.[1] ?? "" }
	} finally {
		await registry.stop(true)
	}
}

describe("installSenpiTarball", () => {
	test("uses an unpublished bundled alias without resolving it from the registry", async () => {
		const root = mkdtempSync(join(tmpdir(), "omob-unpublished-"))
		try {
			const tarball = await packFixture(root, {
				"package/package.json": JSON.stringify({
					name: "@code-yeongyu/senpi",
					version: "0.0.0-unpublished",
					dependencies: { "@omob-fixture/core": "npm:@omob-fixture/never-published-core@0.0.0-unpublished" },
					bundleDependencies: ["@omob-fixture/core"],
				}),
				"package/node_modules/@omob-fixture/core/package.json": JSON.stringify({
					name: "@omob-fixture/core", version: "0.0.0-unpublished", main: "index.js",
				}),
				"package/node_modules/@omob-fixture/core/index.js": "module.exports = 'packed-unpublished-code';",
			})
			const result = await runInstall(tarball, root)
			expect(result.exitCode, result.stderr).toBe(0)
			expect(result.requests).toEqual([])
			const entry = join(result.packageRoot, "node_modules/@omob-fixture/core/index.js")
			expect((await import(entry)).default).toBe("packed-unpublished-code")
			expect(JSON.parse(readFileSync(join(result.packageRoot, "package.json"), "utf8")).dependencies["@omob-fixture/core"])
				.toBe("npm:@omob-fixture/never-published-core@0.0.0-unpublished")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("keeps unbundled required and optional packages beside a bundled package in the same scope", async () => {
		const root = mkdtempSync(join(tmpdir(), "omob-unbundled-"))
		try {
			const optionalTarball = join(root, "optional.tgz")
			const requiredTarball = join(root, "required.tgz")
			for (const [path, name] of [[optionalTarball, "optional"], [requiredTarball, "required"]]) {
				if (path === undefined || name === undefined) throw new Error("invalid fixture")
				await Bun.write(path, new Bun.Archive({
					"package/package.json": JSON.stringify({
						name: `@code-yeongyu/${name}`, version: "1.0.0", main: "index.js",
						scripts: { install: "bun -e \"throw new Error('lifecycle must not run')\"" },
					}),
					"package/index.js": `module.exports = '${name}-sidecar';`,
				}, { compress: "gzip" }))
			}
			const tarball = await packFixture(root, {
				"package/package.json": JSON.stringify({
					name: "@code-yeongyu/senpi", version: "0.0.0-unpublished",
					dependencies: { "@code-yeongyu/bundled": "1.0.0", "@code-yeongyu/required": `file:${requiredTarball}` },
					optionalDependencies: { "@code-yeongyu/optional": `file:${optionalTarball}` },
					bundleDependencies: ["@code-yeongyu/bundled"],
				}),
				"package/node_modules/@code-yeongyu/bundled/package.json": JSON.stringify({
					name: "@code-yeongyu/bundled", version: "1.0.0", main: "index.js",
				}),
				"package/node_modules/@code-yeongyu/bundled/index.js": "module.exports = 'packed';",
			})
			const result = await runInstall(tarball, root)
			expect(result.exitCode, result.stderr).toBe(0)
			expect(result.requests).toEqual([])
			for (const [name, value] of [["bundled", "packed"], ["required", "required-sidecar"], ["optional", "optional-sidecar"]]) {
				expect((await import(join(result.packageRoot, `node_modules/@code-yeongyu/${name}/index.js`))).default).toBe(value)
			}
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("rejects a tarball missing a declared bundled package instead of fetching a replacement", async () => {
		const root = mkdtempSync(join(tmpdir(), "omob-missing-bundle-"))
		try {
			const tarball = await packFixture(root, {
				"package/package.json": JSON.stringify({
					name: "@code-yeongyu/senpi", version: "0.0.0-unpublished",
					dependencies: { "@omob-fixture/missing": "0.0.0-unpublished" },
					bundleDependencies: ["@omob-fixture/missing"],
				}),
			})
			const result = await runInstall(tarball, root)
			expect(result.exitCode).not.toBe(0)
			expect(result.stderr).toContain("missing bundled dependency: @omob-fixture/missing")
			expect(result.requests).toEqual([])
			expect(existsSync(join(root, "install", "bun.lock"))).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
