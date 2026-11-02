import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWorkerSetup } from "../components/bootstrap/dist/cli.js";

async function fixture(run) {
	const root = await mkdtemp(join(tmpdir(), "bootstrap-default-"));
	try {
		const pluginRoot = join(root, "plugin");
		const codexHome = join(root, "codex");
		const pluginData = join(root, "data");
		const agents = join(pluginRoot, "components", "ultrawork", "agents");
		await mkdir(agents, { recursive: true });
		await mkdir(join(pluginRoot, "dist", "cli"), { recursive: true });
		await mkdir(join(root, ".omo"), { recursive: true });
		await mkdir(join(codexHome, "agents"), { recursive: true });
		await writeFile(join(pluginRoot, "dist", "cli", "index.js"), "");
		await writeFile(join(agents, "lazycodex-worker-medium.toml"), 'name = "lazycodex-worker-medium"\nmodel = "qa-model"\ndeveloper_instructions = "qa worker"\n');
		await run({ root, codexHome, pluginRoot, pluginData, platform: "darwin", env: { HOME: root, USERPROFILE: root }, target: join(codexHome, "agents", "default.toml") });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("#given a bundled worker #when bootstrap repeats #then default registration and bytes are stable", async () => {
	await fixture(async (input) => {
		await runWorkerSetup(input);
		const content = await readFile(input.target, "utf8");
		assert.match(content, /^name = "default"$/m);
		assert.match(content, /^model = "qa-model"$/m);
		const config = await readFile(join(input.codexHome, "config.toml"), "utf8");
		assert.match(config, /\[agents\.default\]\nconfig_file = "\.\/agents\/default\.toml"/);
		await runWorkerSetup(input);
		assert.equal(await readFile(input.target, "utf8"), content);
		assert.equal(await readFile(join(input.codexHome, "config.toml"), "utf8"), config);
	});
});

test("#given unified default.disable #when bootstrap runs #then fresh and previously managed defaults are absent", async () => {
	await fixture(async (input) => {
		const configPath = join(input.root, ".omo", "omo.jsonc");
		const disabled = JSON.stringify({ "[codex]": { agents: { default: { disable: true } } } });
		await writeFile(configPath, disabled);
		await runWorkerSetup(input);
		await assert.rejects(readFile(input.target), { code: "ENOENT" });
		await writeFile(configPath, "{}");
		await runWorkerSetup(input);
		assert.match(await readFile(input.target, "utf8"), /^name = "default"$/m);
		await writeFile(configPath, disabled);
		await runWorkerSetup(input);
		await assert.rejects(readFile(input.target), { code: "ENOENT" });
		assert.doesNotMatch(await readFile(join(input.codexHome, "config.toml"), "utf8"), /\[agents\.default\]/);
	});
});

test("#given a user default #when bootstrap runs #then it is preserved and degradation is visible", async () => {
	await fixture(async (input) => {
		const custom = 'name = "default"\nmodel = "custom"\n';
		await writeFile(input.target, custom);
		const outcome = await runWorkerSetup(input);
		assert.ok(outcome.degraded.some((entry) => entry.component === "agents"));
		assert.equal(await readFile(input.target, "utf8"), custom);
	});
});
