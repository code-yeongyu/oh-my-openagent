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

	it("#given stat throws an error #when reading a rule #then falls back to uncached content", () => {
		// given
		const readRule = createParsedRuleReader({
			readFileSync: () => "---\ndescription: fallback\n---\nbody\n",
			statSync: () => {
				throw new Error("stat unavailable");
			},
		});

		// when
		const result = readRule("/rules/fallback.md", "/rules/fallback.md");

		// then
		expect(result.statFingerprint).toBeNull();
		expect(result.metadata.description).toBe("fallback");
		expect(result.body).toBe("body\n");
	});

	it("#given stat throws a non-error value #when reading a rule #then rethrows it", () => {
		// given
		const thrown = "stat unavailable";
		const readRule = createParsedRuleReader({
			readFileSync: () => "---\ndescription: fallback\n---\nbody\n",
			statSync: () => {
				throw thrown;
			},
		});

		// when
		const read = (): void => {
			readRule("/rules/fallback.md", "/rules/fallback.md");
		};

		// then
		expect(read).toThrow(thrown);
	});
});
