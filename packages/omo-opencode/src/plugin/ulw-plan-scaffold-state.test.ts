/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseFrontmatter } from "@oh-my-opencode/utils";

const SCAFFOLD_PLAN_URL = pathToFileURL(
	join(
		import.meta.dir,
		"../../../shared-skills/skills/ulw-plan/scripts/scaffold-plan.mjs",
	),
).href;

type ReviewBudget = {
	readonly limit?: number;
	readonly used?: number;
};

type ReviewProtocol = {
	readonly protocol_version?: string;
	readonly coverage_matrix_version?: string;
	readonly phase?: string;
	readonly budgets?: {
		readonly full_rounds?: ReviewBudget;
		readonly correction_a?: ReviewBudget;
		readonly final_repair_b?: ReviewBudget;
		readonly targeted_closure?: ReviewBudget;
		readonly pre_receipt_replacements_per_lane?: number;
	};
	readonly identities?: Record<string, string | null>;
	readonly rounds?: readonly unknown[];
	readonly corrections?: readonly unknown[];
	readonly closures?: readonly unknown[];
	readonly lanes?: readonly unknown[];
	readonly attempts?: readonly unknown[];
	readonly raw_completions?: readonly unknown[];
	readonly semantic_receipts?: readonly unknown[];
	readonly findings?: readonly unknown[];
	readonly root_causes?: readonly unknown[];
	readonly repair_impacts?: readonly unknown[];
	readonly audit_events?: readonly unknown[];
	readonly terminal?: null;
};

type DraftState = {
	readonly review_required?: boolean;
	readonly review_protocol?: ReviewProtocol;
};

function parseDraftState(draft: string): DraftState {
	const parsed = parseFrontmatter<DraftState>(
		draft.replace(/^approach: .+$/m, "approach: null"),
	);
	if (!parsed.hadFrontmatter || parsed.parseError) {
		throw new Error("Expected scaffold draft frontmatter to parse");
	}
	return parsed.data;
}

async function withTemporaryDirectory<T>(
	prefix: string,
	operation: (directory: string) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	try {
		return await operation(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe("ulw-plan bounded review scaffold state", () => {
	test("#given a review-required draft #when its scaffold state is parsed #then bounded protocol seed is complete and unused", async () => {
		// given
		const { buildDraft } = await import(SCAFFOLD_PLAN_URL);

		// when
		const state = parseDraftState(
			buildDraft("bounded-seed", "clear", { reviewRequired: true }),
		);

		// then
		expect(state.review_required).toBe(true);
		expect(state.review_protocol).toEqual({
			protocol_version: "bounded-review/v1",
			coverage_matrix_version: "D01-D10/v1",
			phase: "review_requested",
			budgets: {
				full_rounds: { limit: 2, used: 0 },
				correction_a: { limit: 1, used: 0 },
				final_repair_b: { limit: 1, used: 0 },
				targeted_closure: { limit: 1, used: 0 },
				pre_receipt_replacements_per_lane: 1,
			},
			identities: {
				scope_id: null,
				workspace_root: null,
				runtime_home: null,
				target_path: ".omo/plans/bounded-seed.md",
				target_sha256: null,
				target_bytes: null,
				target_byte_count: null,
				snapshot_id: null,
				phase_id: null,
				round_id: null,
				closure_id: null,
				reviewer_id: null,
				launch_id: null,
				expected_receipt_id: null,
			},
			rounds: [],
			corrections: [],
			closures: [],
			lanes: [],
			attempts: [],
			raw_completions: [],
			semantic_receipts: [],
			findings: [],
			root_causes: [],
			repair_impacts: [],
			audit_events: [],
			terminal: null,
		});
	});

	test("#given a review-optional draft #when its scaffold state is parsed #then bounded review state is omitted", async () => {
		// given
		const { buildDraft } = await import(SCAFFOLD_PLAN_URL);

		// when
		const state = parseDraftState(buildDraft("optional-seed", "clear"));

		// then
		expect(state.review_required).toBe(false);
		expect(state.review_protocol).toBeUndefined();
	});

	test("#given a review-required draft-only request #when scaffold runs #then it writes only parsed draft state", async () => {
		await withTemporaryDirectory("omo-ulw-plan-draft-", async (directory) => {
			// given
			const { scaffold } = await import(SCAFFOLD_PLAN_URL);
			const draftPath = join(directory, ".omo", "drafts", "draft-only.md");
			const planPath = join(directory, ".omo", "plans", "draft-only.md");

			// when
			const results = await scaffold(directory, {
				slug: "draft-only",
				intent: "unclear",
				draftOnly: true,
				reviewRequired: true,
			});

			// then
			expect(results).toEqual([
				{ relPath: join(".omo", "drafts", "draft-only.md"), status: "created" },
			]);
			expect(
				parseDraftState(await readFile(draftPath, "utf8")).review_protocol
					?.phase,
			).toBe("review_requested");
			expect(await Bun.file(planPath).exists()).toBe(false);
		});
	});

	test("#given an unsafe slug #when scaffold arguments are parsed #then it is rejected", async () => {
		// given
		const { parseArgs } = await import(SCAFFOLD_PLAN_URL);

		// when / then
		expect(() =>
			parseArgs(["bun", "scaffold-plan.mjs", "../escape"]),
		).toThrow();
	});

	test("#given a symlinked plan directory #when scaffold writes #then it rejects before writing outside the workspace", async () => {
		await withTemporaryDirectory(
			"omo-ulw-plan-workspace-",
			async (directory) => {
				await withTemporaryDirectory(
					"omo-ulw-plan-outside-",
					async (outside) => {
						// given
						const { scaffold } = await import(SCAFFOLD_PLAN_URL);
						await mkdir(join(directory, ".omo"), { recursive: true });
						await symlink(outside, join(directory, ".omo", "plans"), "dir");

						// when / then
						await expect(
							scaffold(directory, { slug: "symlinked", intent: "clear" }),
						).rejects.toThrow();
						expect(await readdir(outside)).toEqual([]);
					},
				);
			},
		);
	});

	test("#given a hand-edited plan #when reset runs without force #then it preserves the existing plan", async () => {
		await withTemporaryDirectory("omo-ulw-plan-reset-", async (directory) => {
			// given
			const { scaffold } = await import(SCAFFOLD_PLAN_URL);
			await scaffold(directory, { slug: "protected", intent: "clear" });
			const planPath = join(directory, ".omo", "plans", "protected.md");
			const handEditedPlan = `${await readFile(planPath, "utf8")}\n- [ ] preserve hand-authored state\n`;
			await writeFile(planPath, handEditedPlan, "utf8");

			// when / then
			await expect(
				scaffold(directory, {
					slug: "protected",
					intent: "clear",
					reset: true,
				}),
			).rejects.toThrow();
			expect(await readFile(planPath, "utf8")).toBe(handEditedPlan);
		});
	});
});
