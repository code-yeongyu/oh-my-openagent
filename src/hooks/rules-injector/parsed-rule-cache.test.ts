import { beforeEach, describe, expect, it } from "bun:test";
import { clearParsedRuleCache, createParsedRuleReader } from "./parsed-rule-cache";

describe("parsed rule cache", () => {
	beforeEach(() => {
		clearParsedRuleCache();
	});

	it("#given full cache #when updating existing rule #then unrelated oldest rule remains cached", () => {
		// given
		const readCounts = new Map<string, number>();
		const contents = new Map<string, string>();
		for (let index = 0; index < 256; index += 1) {
			contents.set(`/rules/${index}.md`, `rule-${index}\n`);
		}
		const readRule = createParsedRuleReader({
			readFileSync: (filePath: string) => {
				readCounts.set(filePath, (readCounts.get(filePath) ?? 0) + 1);
				return contents.get(filePath) ?? "";
			},
			statSync: (filePath: string) => ({
				mtimeMs: filePath === "/rules/100.md" ? 2000 : 1000,
				size: (contents.get(filePath) ?? "").length,
				isFile: () => true,
			}),
		});
		for (let index = 0; index < 256; index += 1) {
			readRule(`/rules/${index}.md`, `/rules/${index}.md`);
		}
		contents.set("/rules/100.md", "updated-rule\n");

		// when
		readRule("/rules/100.md", "/rules/100.md");
		readRule("/rules/0.md", "/rules/0.md");

		// then
		expect(readCounts.get("/rules/0.md")).toBe(1);
		expect(readCounts.get("/rules/100.md")).toBe(2);
	});
});
