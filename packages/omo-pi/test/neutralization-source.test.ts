import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const vendorRoot = join(packageRoot, "vendor");
const disabledSelfUpdateMessage =
	"omoai self-update is managed by the omo repo - reinstall from a new tarball";
const omoRepoUrl = "https://github.com/code-yeongyu/oh-my-openagent";

function readVendor(relativePath: string): string {
	return readFileSync(join(vendorRoot, relativePath), "utf8");
}

function indexAfter(source: string, needle: string, afterIndex: number): number {
	const index = source.indexOf(needle, afterIndex);
	expect(index).toBeGreaterThanOrEqual(0);
	return index;
}

describe("omo-pi network surface neutralization", () => {
	test("package-manager update disables self-update before any network or installer plan", () => {
		const source = readVendor("coding-agent/src/package-manager-cli.ts");
		const caseIndex = indexAfter(source, 'case "update": {', 0);
		const markerIndex = indexAfter(source, "// omo-pi: self-update disabled", caseIndex);
		const messageIndex = indexAfter(source, disabledSelfUpdateMessage, markerIndex);
		const returnIndex = indexAfter(source, "return true;", messageIndex);
		const planIndex = source.indexOf("getSelfUpdatePlan", caseIndex);
		const latestIndex = source.indexOf("getLatestPiRelease", caseIndex);
		const runIndex = source.indexOf("runSelfUpdate", caseIndex);

		for (const index of [planIndex, latestIndex, runIndex]) {
			if (index >= 0) {
				expect(markerIndex).toBeLessThan(index);
				expect(returnIndex).toBeLessThan(index);
			}
		}
	});

	test("bootstrap self-update is disabled without removing package-manager commands", () => {
		const source = readVendor("coding-agent/src/cli.ts");
		const conditionIndex = indexAfter(source, "isMissingBundledWorkspaceDependencies(getPackageDir())", 0);
		const markerIndex = indexAfter(source, "// omo-pi: self-update disabled", conditionIndex);
		const messageIndex = indexAfter(source, disabledSelfUpdateMessage, markerIndex);
		const exitIndex = indexAfter(source, "process.exit();", messageIndex);
		const handlerIndex = source.indexOf("handleBootstrapSelfUpdate", conditionIndex);

		expect(source).toContain('const PACKAGE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"])');
		expect(markerIndex).toBeGreaterThan(conditionIndex);
		expect(exitIndex).toBeGreaterThan(messageIndex);
		if (handlerIndex >= 0) {
			expect(exitIndex).toBeLessThan(handlerIndex);
		}
	});

	test("latest-version fetch is unreachable and changelog URLs point at omo", () => {
		const source = readVendor("coding-agent/src/utils/version-check.ts");
		const functionIndex = indexAfter(source, "export async function getLatestPiRelease", 0);
		const markerIndex = indexAfter(source, "// omo-pi: version-check disabled", functionIndex);
		const returnIndex = indexAfter(source, "return undefined;", markerIndex);
		const skipIndex = indexAfter(source, "PI_SKIP_VERSION_CHECK", functionIndex);
		const fetchIndex = indexAfter(source, "fetch(", functionIndex);

		expect(source).toContain(`const RELEASE_CHANGELOG_BASE_URL = "${omoRepoUrl}"`);
		expect(returnIndex).toBeLessThan(skipIndex);
		expect(returnIndex).toBeLessThan(fetchIndex);
	});

	test("install telemetry ping is removed", () => {
		const source = readVendor("coding-agent/src/modes/interactive/interactive-mode.ts");

		expect(source).not.toContain("https://pi.dev/api/report-install");
		expect(source).not.toContain("report-install");
	});

	test("cosmetic release URL points at the omo repository", () => {
		const source = readVendor("coding-agent/src/config.ts");

		expect(source).toContain(`Download from: ${omoRepoUrl}/releases/latest`);
		expect(source).not.toContain("https://github.com/code-yeongyu/senpi/releases/latest");
	});
});
