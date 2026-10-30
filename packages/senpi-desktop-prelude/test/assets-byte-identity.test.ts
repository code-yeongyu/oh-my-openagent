import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computerPreludeAssets } from "../src/index";

// sha256 of each published prelude asset on dev at #9113's prelude contingency. The five texts moved
// from generated TS constants into assets.generated.json without touching one byte; any later change
// to the published bytes must consciously update this fixture.
const FIXTURE_PATH = new URL("./assets.sha256.json", import.meta.url);

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

describe("computer prelude published bytes", () => {
	const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, string>;

	it.each([
		["javascript", "COMPUTER_PRELUDE_JAVASCRIPT"],
		["python", "COMPUTER_PRELUDE_PYTHON"],
		["declarations", "COMPUTER_DECLARATIONS"],
		["documentation", "COMPUTER_DOCUMENTATION"],
		["safety", "COMPUTER_SAFETY"],
	] as const)("keeps %s byte-identical to dev (#9113)", (field, fixtureName) => {
		expect(sha256(computerPreludeAssets[field])).toBe(fixture[fixtureName]);
	});

	it("still declares exactly the computer export", () => {
		expect(computerPreludeAssets.exports).toEqual(["computer"]);
	});
});
