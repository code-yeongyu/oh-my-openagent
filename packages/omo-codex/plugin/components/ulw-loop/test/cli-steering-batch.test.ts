// biome-ignore-all format: compact CLI batch tests stay under the pure LOC budget.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.js";
import { parseSteeringProposals } from "../src/cli-steering.js";
import { ulwLoopGoalsPath } from "../src/paths.js";
import { writePlan } from "../src/plan-io.js";
import type { UlwLoopPlan } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

function plan(): UlwLoopPlan {
	return { version: 1, createdAt: NOW, updatedAt: NOW, briefPath: ".omo/ulw-loop/brief.md", goalsPath: ".omo/ulw-loop/goals.json", ledgerPath: ".omo/ulw-loop/ledger.jsonl", goals: [] };
}

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

	it("#given kind and proposals-json #when steering through CLI #then rejects conflict without mutation", async () => {
		const repo = await mkdtemp(join(tmpdir(), "ug-cli-steer-batch-conflict-"));
		const out: string[] = [];
		try {
			await writePlan(repo, plan());
			const before = await readFile(ulwLoopGoalsPath(repo), "utf8");
			vi.spyOn(process, "cwd").mockReturnValue(repo);
			vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
				out.push(chunk.toString());
				return true;
			});
			vi.spyOn(process.stderr, "write").mockImplementation((): boolean => true);

			expect(await ulwLoopCommand(["steer", "--kind", "annotate_ledger", "--evidence", "flag", "--rationale", "flag", "--proposals-json", '[{"kind":"annotate_ledger","evidence":"batch","rationale":"batch"}]', "--json"])).toBe(1);

			expect(JSON.parse(out.join(""))).toHaveProperty("error.code", "ULW_LOOP_STEERING_BATCH_CONFLICT");
			expect(await readFile(ulwLoopGoalsPath(repo), "utf8")).toBe(before);
		} finally {
			vi.restoreAllMocks();
			await rm(repo, { recursive: true, force: true });
		}
	});
});
