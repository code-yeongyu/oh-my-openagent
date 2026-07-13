import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_URL = new URL("../components/bootstrap/dist/cli.js", import.meta.url);
const bootstrapCli = await import(CLI_URL.href);

export const { runBootstrapWorker, runWorkerSetup } = bootstrapCli;
export const MARKETPLACE_SOURCE_LINE =
	'source = "https://github.com/code-yeongyu/lazycodex.git"';
export const PLUGIN_VERSION = "9.9.9";
export const BUNDLED_EXPLORER_TOML =
	'description = "Explorer agent"\nmodel_reasoning_effort = "medium"\n';
export const BUNDLED_METIS_TOML =
	'description = "Metis agent"\nmodel_reasoning_effort = "high"\n';

export async function withSetupFixture(run) {
	const root = await mkdtemp(join(tmpdir(), "omo-bootstrap-setup-"));
	try {
		const pluginRoot = join(root, "plugin");
		const pluginData = join(root, "plugin-data");
		const codexHome = join(root, "codex-home");
		await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
		await mkdir(join(pluginRoot, "hooks"), { recursive: true });
		await mkdir(join(pluginRoot, "components", "ultrawork", "agents"), {
			recursive: true,
		});
		// A complete npx-style payload ships dist/cli; the marketplace-payload
		// (no dist/cli -> degraded omo-cli) path is covered by
		// bootstrap-binlinks.test.mjs.
		await mkdir(join(pluginRoot, "dist", "cli"), { recursive: true });
		await writeFile(join(pluginRoot, "dist", "cli", "index.js"), "");
		await mkdir(pluginData, { recursive: true });
		await mkdir(codexHome, { recursive: true });
		await writeFile(
			join(pluginRoot, ".codex-plugin", "plugin.json"),
			`${JSON.stringify({ hooks: "./hooks/hooks.json", name: "omo", version: PLUGIN_VERSION })}\n`,
		);
		const pluginRootPlaceholder = String.raw`\${PLUGIN_ROOT}`;
		await writeFile(
			join(pluginRoot, "hooks", "hooks.json"),
			`${JSON.stringify({
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									command: `node "${pluginRootPlaceholder}/components/bootstrap/dist/cli.js" hook session-start`,
									statusMessage:
										"LazyCodex(9.9.9): Checking Bootstrap Provisioning",
									timeout: 30,
									type: "command",
								},
							],
						},
					],
				},
			})}\n`,
		);
		await writeFile(
			join(pluginRoot, ".mcp.json"),
			`${JSON.stringify({ mcpServers: { git_bash: { args: ["serve"], command: "node", env: {} } } }, null, "\t")}\n`,
		);
		await writeFile(
			join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"),
			BUNDLED_EXPLORER_TOML,
		);
		await writeFile(
			join(pluginRoot, "components", "ultrawork", "agents", "metis.toml"),
			BUNDLED_METIS_TOML,
		);
		await writeFile(
			join(codexHome, "config.toml"),
			`[marketplaces.sisyphuslabs]\n${MARKETPLACE_SOURCE_LINE}\n`,
		);
		await run({ codexHome, pluginData, pluginRoot, root });
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

export function setupOptions(fixture, overrides = {}) {
	return {
		codexHome: fixture.codexHome,
		env: {},
		platform: "darwin",
		pluginData: fixture.pluginData,
		pluginRoot: fixture.pluginRoot,
		...overrides,
	};
}

export async function readConfig(fixture) {
	return readFile(join(fixture.codexHome, "config.toml"), "utf8");
}
