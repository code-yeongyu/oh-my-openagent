import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function makeTempDir() {
	return mkdtemp(join(tmpdir(), "omo-codex-install-"));
}

export async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writePlugin(root, name, version) {
	const pluginRoot = join(root, "plugins", name);
	await writePluginAt(pluginRoot, name, version);
}

export async function writePluginAt(pluginRoot, name, version) {
	await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
	await mkdir(join(pluginRoot, "dist"), { recursive: true });
	await mkdir(join(pluginRoot, "hooks"), { recursive: true });
	await mkdir(join(pluginRoot, "skills", name), { recursive: true });
	await mkdir(join(pluginRoot, "components", "ultrawork", "agents"), { recursive: true });
	await writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), {
		name,
		version,
		description: `${name} test plugin`,
		mcpServers: "./.mcp.json",
		hooks: "./hooks/hooks.json",
		skills: "./skills/",
	});
	await writeJson(join(pluginRoot, ".mcp.json"), {
		mcpServers: {
			[name]: {
				command: "node",
				args: ["./dist/cli.js", "mcp"],
				cwd: ".",
			},
		},
	});
	await writeJson(join(pluginRoot, "hooks", "hooks.json"), { hooks: {} });
	await writeFile(join(pluginRoot, "skills", name, "SKILL.md"), "---\nname: test\n---\n");
	await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"), 'name = "explorer"\n');
	await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "librarian.toml"), 'name = "librarian"\n');
	await writeFile(join(pluginRoot, "components", "ultrawork", "agents", "plan.toml"), 'name = "plan"\n');
	await writeJson(join(pluginRoot, "package.json"), {
		name: `@example/${name}`,
		version,
		bin: {
			[name]: "./dist/cli.js",
		},
		scripts: {
			build: "node -e \"require('fs').writeFileSync('dist/cli.js', 'console.log(1)')\"",
		},
		dependencies: {},
	});
}
