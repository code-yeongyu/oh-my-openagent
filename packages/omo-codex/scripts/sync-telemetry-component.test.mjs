import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = new URL("./sync-telemetry-component.mjs", import.meta.url);

async function makeTempDir() {
	return mkdtemp(join(tmpdir(), "omo-codex-telemetry-sync-"));
}

async function runSync(args) {
	const { syncTelemetryComponent } = await import(SCRIPT_PATH);
	return syncTelemetryComponent(args);
}

test("#given stale telemetry component files #when sync runs #then pure package telemetry source rewrites the component copy", async () => {
	// given
	const root = await makeTempDir();
	const sourceDir = join(root, "source");
	const componentDir = join(root, "component");
	await mkdir(sourceDir);
	await mkdir(componentDir);
	await writeFile(join(sourceDir, "atomic-write.ts"), "export const source = true\n", { flush: true });
	await writeFile(join(componentDir, "atomic-write.ts"), "export const stale = true\n", { flush: true });

	try {
		// when
		const result = await runSync({
			sourceDir,
			componentDir,
			files: ["atomic-write.ts"],
			check: false,
		});

		// then
		assert.deepEqual(result, {
			checked: false,
			changed: ["atomic-write.ts"],
		});
		assert.equal(await readFile(join(componentDir, "atomic-write.ts"), "utf8"), "export const source = true\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("#given a missing pure telemetry source file #when sync runs #then it fails with the missing source path", async () => {
	// given
	const root = await makeTempDir();
	const sourceDir = join(root, "source");
	const componentDir = join(root, "component");
	await mkdir(componentDir);
	await writeFile(join(componentDir, "atomic-write.ts"), "export const stale = true\n", { flush: true });

	try {
		// when / then
		await assert.rejects(
			runSync({
				sourceDir,
				componentDir,
				files: ["atomic-write.ts"],
				check: false,
			}),
			(error) => error instanceof Error && error.message.includes(join(sourceDir, "atomic-write.ts")),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("#given packaged default layout without pure telemetry source #when cli sync runs #then it exits cleanly", async () => {
	// given
	const root = await makeTempDir();
	const scriptPath = join(root, "packages", "omo-codex", "scripts", "sync-telemetry-component.mjs");
	await mkdir(join(root, "packages", "omo-codex", "scripts"), { recursive: true });
	await cp(new URL("./sync-telemetry-component.mjs", import.meta.url), scriptPath);

	try {
		// when
		const result = spawnSync(process.execPath, [scriptPath], {
			encoding: "utf8",
			env: {
				...process.env,
			},
		});

		// then
		assert.equal(result.status, 0, result.stderr);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
