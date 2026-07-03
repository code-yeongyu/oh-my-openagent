import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const vendorRoot = join(packageRoot, "vendor");

function readVendor(relativePath: string): string {
	return readFileSync(join(vendorRoot, relativePath), "utf8");
}

describe("omo-pi source rebrand", () => {
	test("coding-agent package exposes omoai with .omo config", () => {
		const pkg = JSON.parse(readVendor("coding-agent/package.json"));

		expect(pkg.name).toBe("@code-yeongyu/senpi");
		expect(pkg.piConfig).toEqual({ name: "omoai", configDir: ".omo" });
		expect(pkg.bin).toEqual({ omoai: "dist/cli.js" });
	});

	test("TUI log files use the omoai .omo namespace", () => {
		const source = readVendor("tui/src/tui.ts");

		expect(source).toContain('".omo", "agent", "omoai-debug.log"');
		expect(source).toContain('".omo", "agent", "omoai-crash.log"');
		expect(source).not.toContain('".senpi", "agent", "senpi-debug.log"');
		expect(source).not.toContain('".senpi", "agent", "senpi-crash.log"');
	});

	test("hook defaults derive project hooks from CONFIG_DIR_NAME", () => {
		const session = readVendor("coding-agent/src/core/agent-session.ts");
		const hooksIndex = readVendor("coding-agent/src/core/extensions/builtin/hooks/index.ts");
		const hooksConfigLoader = readVendor("coding-agent/src/core/extensions/builtin/hooks/config-loader.ts");

		expect(session).toContain("CONFIG_DIR_NAME");
		expect(hooksIndex).toContain("CONFIG_DIR_NAME");
		expect(hooksConfigLoader).toContain("CONFIG_DIR_NAME");
		expect(`${session}\n${hooksIndex}\n${hooksConfigLoader}`).not.toContain(".senpi/hooks.json");
	});

	test("legacy senpi migration is disabled before rename work", () => {
		const source = readVendor("coding-agent/src/legacy-senpi-dir-migration.ts");
		const markerIndex = source.indexOf("// omo-pi: legacy migration disabled");
		const returnIndex = source.indexOf("return;", markerIndex);
		const legacyMoveIndex = source.indexOf('join(cwd, ".pi")');

		expect(markerIndex).toBeGreaterThanOrEqual(0);
		expect(returnIndex).toBeGreaterThan(markerIndex);
		expect(legacyMoveIndex).toBeGreaterThan(returnIndex);
	});

	test("CLI and extension loader expose omo-pi aliases", () => {
		const cli = readVendor("coding-agent/src/cli.ts");
		const loader = readVendor("coding-agent/src/core/extensions/loader.ts");

		expect(cli).toContain('"/node_modules/omo-pi"');
		expect(loader).toContain('"@code-yeongyu/senpi"');
		expect(loader).toContain('"omo-pi"');
	});

	test("websearch config points users to CONFIG_DIR_NAME instead of .pi", () => {
		const index = readVendor("coding-agent/src/core/extensions/builtin/websearch/index.ts");
		const config = readVendor("coding-agent/src/core/extensions/builtin/websearch/websearch/config.ts");
		const tool = readVendor("coding-agent/src/core/extensions/builtin/websearch/websearch/tool.ts");

		expect(index).toContain("${CONFIG_DIR_NAME}/websearch.json");
		expect(config).toContain("CONFIG_DIR_NAME");
		expect(tool).toContain("${CONFIG_DIR_NAME}/websearch.json");
		expect(`${index}\n${config}\n${tool}`).not.toContain(".pi/websearch.json");
	});

	test("package manager does not auto-discover legacy project .pi resources", () => {
		const source = readVendor("coding-agent/src/core/package-manager.ts");

		expect(source).toContain("CONFIG_DIR_NAME");
		expect(source).not.toContain('join(this.cwd, ".pi")');
		expect(source).not.toContain("legacyProjectDirs");
		expect(source).not.toContain("Project extensions from .pi/");
		expect(source).not.toContain("Project skills from .pi/");
	});
});
