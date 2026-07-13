import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	capturePreservedAgentReasoning,
	linkCachedPluginAgents,
} from "./link-cached-plugin-agents";

describe("managed bundled agent reasoning migration", () => {
	test("#given historical managed support-agent tuples #when agents are re-linked #then upgrades to current bundled tuples", async () => {
		const { codexHome, pluginRoot } = await makeAgentFixture();
		await mkdir(join(codexHome, "agents"), { recursive: true });
		await writeFile(
			join(codexHome, "agents", "momus.toml"),
			agentToml("momus", "gpt-5.5", "xhigh"),
		);
		await writeFile(
			join(codexHome, "agents", "explorer.toml"),
			agentToml("explorer", "gpt-5.6-luna", "low"),
		);
		await writeFile(
			join(codexHome, "agents", "librarian.toml"),
			agentToml("librarian", "gpt-5.4-mini", "low"),
		);
		await writeFile(
			join(codexHome, "agents", "lazycodex-worker-low.toml"),
			agentToml("lazycodex-worker-low", "gpt-5.6-luna", "high"),
		);
		await writeFile(
			join(codexHome, "agents", "lazycodex-worker-medium.toml"),
			agentToml("lazycodex-worker-medium", "gpt-5.6-luna", "max"),
		);
		await writeFile(
			join(codexHome, "agents", "lazycodex-qa-executor.toml"),
			agentToml("lazycodex-qa-executor", "gpt-5.6-luna", "high"),
		);
		const preservedReasoning = await capturePreservedAgentReasoning({
			codexHome,
		});

		await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning });

		expect(await readAgentReasoning(codexHome, "momus")).toEqual({
			model: "gpt-5.6-sol",
			effort: "ultra",
		});
		expect(await readAgentReasoning(codexHome, "explorer")).toEqual({
			model: "gpt-5.6-terra",
			effort: "medium",
		});
		expect(await readAgentReasoning(codexHome, "librarian")).toEqual({
			model: "gpt-5.6-terra",
			effort: "medium",
		});
		expect(await readAgentReasoning(codexHome, "lazycodex-worker-low")).toEqual(
			{ model: "gpt-5.6-terra", effort: "high" },
		);
		expect(
			await readAgentReasoning(codexHome, "lazycodex-worker-medium"),
		).toEqual({ model: "gpt-5.6-terra", effort: "high" });
		expect(
			await readAgentReasoning(codexHome, "lazycodex-qa-executor"),
		).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
	});

	test("#given custom installed support-agent tuples #when agents are re-linked #then preserves each tuple", async () => {
		const { codexHome, pluginRoot } = await makeAgentFixture();
		await mkdir(join(codexHome, "agents"), { recursive: true });
		await writeFile(
			join(codexHome, "agents", "momus.toml"),
			agentToml("momus", "gpt-5.6-sol", "high"),
		);
		await writeFile(
			join(codexHome, "agents", "explorer.toml"),
			agentToml("explorer", "gpt-5.6-terra", "xhigh"),
		);
		await writeFile(
			join(codexHome, "agents", "librarian.toml"),
			agentToml("librarian", "gpt-5.6-terra", "high"),
		);
		await writeFile(
			join(codexHome, "agents", "lazycodex-worker-low.toml"),
			agentToml("lazycodex-worker-low", "gpt-5.6-luna", "xhigh"),
		);
		await writeFile(
			join(codexHome, "agents", "lazycodex-worker-medium.toml"),
			agentToml("lazycodex-worker-medium", "gpt-5.6-luna", "ultra"),
		);
		await writeFile(
			join(codexHome, "agents", "lazycodex-qa-executor.toml"),
			agentToml("lazycodex-qa-executor", "gpt-5.6-luna", "low"),
		);
		const preservedReasoning = await capturePreservedAgentReasoning({
			codexHome,
		});

		await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning });

		expect(await readAgentReasoning(codexHome, "momus")).toEqual({
			model: "gpt-5.6-sol",
			effort: "high",
		});
		expect(await readAgentReasoning(codexHome, "explorer")).toEqual({
			model: "gpt-5.6-terra",
			effort: "xhigh",
		});
		expect(await readAgentReasoning(codexHome, "librarian")).toEqual({
			model: "gpt-5.6-terra",
			effort: "high",
		});
		expect(await readAgentReasoning(codexHome, "lazycodex-worker-low")).toEqual(
			{ model: "gpt-5.6-luna", effort: "xhigh" },
		);
		expect(
			await readAgentReasoning(codexHome, "lazycodex-worker-medium"),
		).toEqual({ model: "gpt-5.6-luna", effort: "ultra" });
		expect(
			await readAgentReasoning(codexHome, "lazycodex-qa-executor"),
		).toEqual({ model: "gpt-5.6-luna", effort: "low" });
	});

	test("#given a custom model and effort on a managed role #when agents are re-linked #then preserves the pair", async () => {
		const { codexHome, pluginRoot } = await makeAgentFixture();
		await mkdir(join(codexHome, "agents"), { recursive: true });
		await writeFile(
			join(codexHome, "agents", "explorer.toml"),
			agentToml("explorer", "custom-model", "low"),
		);
		const preservedReasoning = await capturePreservedAgentReasoning({
			codexHome,
		});

		await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning });

		expect(await readAgentReasoning(codexHome, "explorer")).toEqual({
			model: "custom-model",
			effort: "low",
		});
	});

	test("#given a custom model and effort on an unlisted bundled role #when agents are re-linked #then preserves the pair", async () => {
		const { codexHome, pluginRoot } = await makeAgentFixture();
		await mkdir(join(codexHome, "agents"), { recursive: true });
		await writeFile(
			join(codexHome, "agents", "metis.toml"),
			agentToml("metis", "custom-model", "medium"),
		);
		const preservedReasoning = await capturePreservedAgentReasoning({
			codexHome,
		});

		await linkCachedPluginAgents({ codexHome, pluginRoot, preservedReasoning });

		expect(await readAgentReasoning(codexHome, "metis")).toEqual({
			model: "custom-model",
			effort: "medium",
		});
	});
});

async function makeAgentFixture(): Promise<{
	readonly codexHome: string;
	readonly pluginRoot: string;
}> {
	const root = await mkdtemp(
		join(tmpdir(), "omo-codex-agent-effort-migration-"),
	);
	const codexHome = join(root, "codex");
	const pluginRoot = join(root, "plugin");
	const agentsDir = join(pluginRoot, "components", "ultrawork", "agents");
	await mkdir(agentsDir, { recursive: true });
	await writeFile(
		join(agentsDir, "momus.toml"),
		agentToml("momus", "gpt-5.6-sol", "ultra"),
	);
	await writeFile(
		join(agentsDir, "explorer.toml"),
		agentToml("explorer", "gpt-5.6-terra", "medium"),
	);
	await writeFile(
		join(agentsDir, "librarian.toml"),
		agentToml("librarian", "gpt-5.6-terra", "medium"),
	);
	await writeFile(
		join(agentsDir, "metis.toml"),
		agentToml("metis", "gpt-5.6-sol", "high"),
	);
	await writeFile(
		join(agentsDir, "lazycodex-worker-low.toml"),
		agentToml("lazycodex-worker-low", "gpt-5.6-terra", "high"),
	);
	await writeFile(
		join(agentsDir, "lazycodex-worker-medium.toml"),
		agentToml("lazycodex-worker-medium", "gpt-5.6-terra", "high"),
	);
	await writeFile(
		join(agentsDir, "lazycodex-qa-executor.toml"),
		agentToml("lazycodex-qa-executor", "gpt-5.6-terra", "medium"),
	);
	return { codexHome, pluginRoot };
}

function agentToml(name: string, model: string, effort: string): string {
	return `name = "${name}"\nmodel = "${model}"\nmodel_reasoning_effort = "${effort}"\n`;
}

async function readAgentReasoning(
	codexHome: string,
	agentName: string,
): Promise<{ readonly model: string; readonly effort: string }> {
	const content = await readFile(
		join(codexHome, "agents", `${agentName}.toml`),
		"utf8",
	);
	const model = /^model\s*=\s*"([^"]+)"$/m.exec(content)?.[1];
	const effort = /^model_reasoning_effort\s*=\s*"([^"]+)"$/m.exec(content)?.[1];
	if (model === undefined || effort === undefined)
		throw new Error(`missing reasoning tuple for ${agentName}`);
	return { model, effort };
}
