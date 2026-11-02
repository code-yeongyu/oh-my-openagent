import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { launchDesktopEngine, type AcquireDesktopEngineOptions } from "../src/acquire";
import { engineSha256, launchStableEngine } from "../src/stable-launch";

let root: string;
const host = "darwin-arm64";
const asset = `senpi-desktop-engine-${host}`;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "omo-stable-engine-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function options(version: string, bytes: Buffer): AcquireDesktopEngineOptions {
	return {
		version, host,
		cacheDir: join(root, "cache"),
		installDir: join(root, "installed"),
		locatorOptions: {
			runtimeDir: "", execDir: join(root, "bin"),
			packageDir: join(root, "package"), repoRoot: join(root, "repo"),
		},
		isReleaseEngine: () => true,
		fetch: async (input) => new Response(String(input).endsWith("checksums.txt") ? `${hash(bytes)}  ${asset}\n` : bytes),
	};
}

describe("stable release engine launch", () => {
	it("launches two verified releases at the identical installation path", async () => {
		// Given two releases with different bytes.
		const firstBytes = Buffer.from("first release");
		const secondBytes = Buffer.from("second release");
		const launch = (path: string) => engineSha256(path);

		// When both releases are launched.
		const first = await launchDesktopEngine(options("5.1.4", firstBytes), launch);
		const second = await launchDesktopEngine(options("5.1.5", secondBytes), launch);

		// Then the same path executes each requested digest, with current metadata.
		expect(first.path).toBe(second.path);
		expect(first).toMatchObject({ value: hash(firstBytes) });
		expect(second).toMatchObject({ value: hash(secondBytes) });
		expect(JSON.parse(readFileSync(join(root, "installed", host, "release.json"), "utf8")))
			.toEqual({ version: "5.1.5", sha256: hash(secondBytes) });
	});

	it("replaces the executable atomically without changing the previous inode", async () => {
		// Given a published file and a second name retaining its original inode.
		const first = await launchDesktopEngine(options("5.1.4", Buffer.from("old")), (path) => path);
		if (first.path === null) throw new Error("first launch failed");
		const previous = join(root, "previous-engine");
		linkSync(first.path, previous);
		const inode = statSync(first.path).ino;

		// When another release is installed.
		const second = await launchDesktopEngine(options("5.1.5", Buffer.from("new")), (path) => path);

		// Then the previous inode stays intact; an in-place write would change both names.
		expect(second.path).toBe(first.path);
		expect(readFileSync(previous, "utf8")).toBe("old");
		expect(readFileSync(first.path, "utf8")).toBe("new");
		expect(statSync(first.path).ino).not.toBe(inode);
		expect(readdirSync(join(root, "installed", host)).filter((name) => name.startsWith(".engine-"))).toEqual([]);
	});

	it("never promotes an ad-hoc release over the stable signed file", async () => {
		// Given an existing signed release and a different unsigned download.
		const first = await launchDesktopEngine(options("5.1.4", Buffer.from("signed")), (path) => path);
		const unsigned = { ...options("5.1.5", Buffer.from("ad-hoc")), isReleaseEngine: () => false };

		// When the unsigned engine is launched.
		const second = await launchDesktopEngine(unsigned, (path) => path);

		// Then it retains its immutable path and the permission-bearing file is unchanged.
		expect(second.path).not.toBe(first.path);
		if (first.path === null) throw new Error("first launch failed");
		expect(readFileSync(first.path, "utf8")).toBe("signed");
	});

	it("preserves a development engine without creating a stable slot", async () => {
		// Given a local development engine.
		const local = join(root, "repo", "target", "release", "senpi-desktop-engine");
		mkdirSync(join(root, "repo", "target", "release"), { recursive: true });
		writeFileSync(local, "development", { mode: 0o755 });

		// When local precedence resolves it.
		const result = await launchDesktopEngine(options("5.1.5", Buffer.from("unused")), (path) => path);

		// Then the local file is launched as-is, even when signature verification is injected.
		expect(result).toMatchObject({ path: local, value: local });
		expect(existsSync(join(root, "installed"))).toBe(false);
	});

	it("promotes signed extracted payloads but leaves unsigned extracted builds untouched", async () => {
		// Given a release-stamped payload outside the download cache.
		const runtimeDir = join(root, "runtime");
		const payloadDir = join(runtimeDir, "native", "prebuilds", host);
		const payload = join(payloadDir, "senpi-desktop-engine");
		mkdirSync(payloadDir, { recursive: true });
		writeFileSync(payload, "extracted release", { mode: 0o755 });
		writeFileSync(join(runtimeDir, "package.json"), JSON.stringify({ name: "omo", version: "5.1.5" }));
		const releaseOptions = options("5.1.5", Buffer.from("unused"));
		const extracted = { ...releaseOptions, locatorOptions: { ...releaseOptions.locatorOptions, runtimeDir } };

		// When a signed payload and then a local unsigned build are selected.
		const signed = await launchDesktopEngine(extracted, (path) => path);
		writeFileSync(payload, "local unsigned build");
		const unsigned = await launchDesktopEngine({ ...extracted, isReleaseEngine: () => false }, (path) => path);

		// Then only the signed release owns the stable path.
		expect(signed.path).toBe(join(root, "installed", host, "senpi-desktop-engine"));
		expect(unsigned.path).toBe(payload);
		if (signed.path === null) throw new Error("signed launch failed");
		expect(readFileSync(signed.path, "utf8")).toBe("extracted release");
	});

	it.runIf(process.platform === "darwin")("executes the verified native image when replacement races between verify and spawn", () => {
		// Given two native images and a competing process that respects the same advisory lock.
		const directory = join(root, "stable");
		const original = join(root, "original");
		const replacement = join(root, "replacement");
		for (const [status, path] of [original, replacement].entries()) {
			const compiled = spawnSync("/usr/bin/cc", ["-x", "c", `-DEXIT_CODE=${status}`, "-o", path, "-"], {
				input: "int main(void) { return EXIT_CODE; }\n",
				encoding: "utf8",
			});
			expect(compiled.status, compiled.stderr).toBe(0);
		}
		const first = { path: original, sha256: engineSha256(original), version: "5.1.4", directory };
		const competitor = `
			const { DatabaseSync } = require("node:sqlite");
			const { renameSync } = require("node:fs");
			const db = new DatabaseSync(process.argv[1]);
			try { db.exec("BEGIN EXCLUSIVE"); }
			catch (e) { if (e.code !== "ERR_SQLITE_ERROR" && e.code !== "SQLITE_BUSY") throw e; console.log("locked"); process.exit(0); }
			renameSync(process.argv[2], process.argv[3]); db.close(); console.log("replaced");
		`;

		// When a replacement attempts the critical section after verification, before spawn.
		const launched = launchStableEngine(first, (path) => {
			const raced = spawnSync(process.execPath, ["-e", competitor, join(directory, "launch.lock"), replacement, path], { encoding: "utf8" });
			expect(raced.error).toBeUndefined();
			expect(raced.status).toBe(0);
			return { competitor: raced.stdout.trim(), executed: spawnSync(path) };
		}, () => true);

		// Then each native image returns its own compiled exit code.
		expect(launched.value.executed).toMatchObject({ status: 0, signal: null });
		expect(launched.value.competitor).toBe("locked");
		const second = launchStableEngine({
			path: replacement, sha256: engineSha256(replacement), version: "5.1.5", directory,
		}, (path) => spawnSync(path), () => true);
		expect(second.path).toBe(launched.path);
		expect(second.value).toMatchObject({ status: 1, signal: null });
	});
});
