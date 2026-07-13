/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
	findTomlAssignment,
	isTomlLexicallyValid,
	scanTomlLines,
} from "./toml-lexical-lines";

describe("scanTomlLines", () => {
	test("#given a multiline value containing brackets #when scanning #then only real table declarations become headers", () => {
		const config = [
			"[features.multi_agent_v2]",
			"multi_agent_mode_hint_text = '''Direct work policy:",
			"[Direct work]",
			"Keep bounded tasks local.'''",
			"[agents]",
			"",
		].join("\n");

		const headers = scanTomlLines(config)
			.map((line) => line.tableHeader)
			.filter((header) => header !== null);

		expect(headers).toEqual(["[features.multi_agent_v2]", "[agents]"]);
	});

	test("#given quoted hash keys and trailing comments #when scanning #then the complete table header is retained", () => {
		const config = [
			'["agents#custom"] # keep',
			"model = 'gpt-5.6-terra'",
			"",
		].join("\n");

		const first = scanTomlLines(config)[0];

		expect(first?.tableHeader).toBe('["agents#custom"]');
	});

	test("#given multiline assignment-looking text #when reading an assignment #then only active TOML is returned", () => {
		const config = [
			"notes = '''",
			'model = "gpt-5.6-sol"',
			"'''",
			'model = "gpt-5.5"',
			"",
		].join("\n");

		expect(findTomlAssignment(config, "model")?.value).toBe('"gpt-5.5"');
	});

	test("#given an unterminated multiline string #when validating #then the document is rejected", () => {
		expect(isTomlLexicallyValid('notes = """\nmodel = "gpt-5.6-sol"\n')).toBe(
			false,
		);
	});
});
