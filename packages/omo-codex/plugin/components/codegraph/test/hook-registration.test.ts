import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const pluginConfigPath = resolve(pluginRoot, ".codex-plugin/plugin.json");

describe("CodeGraph hook registration", () => {
	it("#given plugin hook config #when inspected #then CodeGraph is registered after bootstrap SessionStart", () => {
		// given
		const pluginConfig: unknown = JSON.parse(readFileSync(pluginConfigPath, "utf8"));

		// when
		const hookPaths =
			typeof pluginConfig === "object" && pluginConfig !== null && "hooks" in pluginConfig && Array.isArray(pluginConfig.hooks)
				? pluginConfig.hooks.filter((hookPath): hookPath is string => typeof hookPath === "string")
				: [];

		// then
		expect(hookPaths).toContain("./hooks/session-start-checking-codegraph-bootstrap.json");
		expect(hookPaths.indexOf("./hooks/session-start-checking-bootstrap-provisioning.json")).toBeLessThan(
			hookPaths.indexOf("./hooks/session-start-checking-codegraph-bootstrap.json"),
		);
	});
});
