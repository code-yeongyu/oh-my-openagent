// biome-ignore-all format: compact CLI batch tests stay under the pure LOC budget.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseSteeringProposals } from "../src/cli-steering.js";

describe("parseSteeringProposals", () => {
	it("#given proposals-json #when parsing steer args #then returns every proposal", async () => {
		const proposals = await parseSteeringProposals([
			"--proposals-json",
			JSON.stringify([
				{ kind: "annotate_ledger", evidence: "one", rationale: "because one" },
				{ kind: "annotate_ledger", source: "cli", evidence: "two", rationale: "because two" },
			]),
		]);

		expect(proposals).toHaveLength(2);
		expect(proposals[0]).toMatchObject({ evidence: "one", source: "cli" });
		expect(proposals[1]).toMatchObject({ evidence: "two" });
	});

	it("#given proposals-json path #when parsing steer args #then reads proposals from the file", async () => {
		const repo = await mkdtemp(join(tmpdir(), "ug-cli-steer-batch-"));
		const file = join(repo, "batch.json");
		await writeFile(file, JSON.stringify([{ kind: "annotate_ledger", source: "cli", evidence: "file", rationale: "because file" }]), "utf8");

		const proposals = await parseSteeringProposals(["--proposals-json", file]);

		expect(proposals).toHaveLength(1);
		expect(proposals[0]).toMatchObject({ evidence: "file" });
	});
});
