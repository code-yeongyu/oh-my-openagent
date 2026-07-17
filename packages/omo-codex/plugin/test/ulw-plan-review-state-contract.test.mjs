import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(dirname(pluginRoot)));

const surfaces = [
	{
		name: "shared OpenCode",
		skillPath: join(repositoryRoot, "packages", "shared-skills", "skills", "ulw-plan", "SKILL.md"),
		workflowPath: join(repositoryRoot, "packages", "shared-skills", "skills", "ulw-plan", "references", "full-workflow.md"),
		independentReviewer: "oracle",
		reviewRoots: {
			momus: "<literal-canonical-source-workspace-root>",
			independent: "<literal-canonical-source-workspace-root>",
		},
		runtimeHomes: { momus: null, independent: null },
	},
	{
		name: "Codex",
		skillPath: join(pluginRoot, "components", "ultrawork", "skills", "ulw-plan", "SKILL.md"),
		workflowPath: join(pluginRoot, "components", "ultrawork", "skills", "ulw-plan", "references", "full-workflow.md"),
		independentReviewer: "codex-cli:gpt-5.6-sol:xhigh",
		reviewRoots: {
			momus: "<literal-canonical-source-workspace-root>",
			independent: "<literal-canonical-disposable-review-workspace-root>",
		},
		runtimeHomes: { momus: null, independent: "<literal-isolated-codex-home>" },
	},
];

function readJsonContract(workflow, contractName) {
	const fence = "```";
	const pattern = new RegExp(`<!-- ${contractName} -->\\s*${fence}json\\s*([\\s\\S]*?)\\s*${fence}`);
	const match = workflow.match(pattern);
	assert.ok(match, `missing ${contractName}`);
	return JSON.parse(match[1]);
}

function matchesCas(state, expected, clauses) {
	return clauses.every((clause) => {
		const separator = clause.indexOf("=");
		if (separator !== -1) {
			const key = clause.slice(0, separator);
			const value = clause.slice(separator + 1);
			return state[key] === value;
		}
		return Object.hasOwn(expected, clause) && state[clause] === expected[clause];
	});
}

for (const surface of surfaces) {
	test(`#given ${surface.name} #when deeper review becomes required before plan completion #then durable request state covers explicit and automatic review without inventing a digest`, async () => {
		const skill = await readFile(surface.skillPath, "utf8");
		const workflow = await readFile(surface.workflowPath, "utf8");
		const contract = readJsonContract(workflow, "ulw-plan-review-request-state-contract");

		assert.equal(contract.transition, "replace");
		assert.equal(contract.phase, "review_requested");
		assert.deepEqual(contract.applies_when, ["explicit_review_modifier_before_complete_plan", "intent=unclear_and_nontrivial"]);
		assert.match(skill, /Include `--review-required`[\s\S]{0,180}non-Trivial UNCLEAR/);
		assert.match(workflow, /--draft-only/);
		assert.equal(contract.atomic, true);
		assert.equal(contract.review_required, true);
		assert.equal(contract.plan_path, ".omo/plans/<slug>.md");
		assert.equal(contract.plan_sha256, null);
		assert.equal(contract.review_round_id, null);
		assert.deepEqual(contract.pending_action_policy, {
			review_required: "write and review .omo/plans/<slug>.md",
			otherwise: "write .omo/plans/<slug>.md",
		});
		assert.equal(contract["pending-action"], contract.pending_action_policy.review_required);
		assert.deepEqual(Object.keys(contract.review).sort(), ["independent", "momus"]);

		for (const lane of Object.values(contract.review)) {
			assert.deepEqual(lane, {
				status: "pending",
				workspace_root: null,
				runtime_home: null,
				target: ".omo/plans/<slug>.md",
				round_id: null,
				plan_sha256: null,
				launch_id: null,
				session: null,
				result: null,
			});
		}
	});

	test(`#given a complete ${surface.name} plan #when a fresh review round starts #then both lanes persist literal workspace and artifact bindings`, async () => {
		const workflow = await readFile(surface.workflowPath, "utf8");
		const contract = readJsonContract(workflow, "ulw-plan-review-round-state-contract");

		assert.equal(contract.transition, "replace");
		assert.equal(contract.phase, "review_round_initialized");
		assert.deepEqual(contract.applies_when, [
			"complete_plan_after_review_request",
			"explicit_review_modifier_with_complete_plan",
			"retry_after_plan_change",
		]);
		assert.equal(contract.atomic, true);
		assert.equal(contract.review_required, true);
		assert.equal(contract.plan_path, ".omo/plans/<slug>.md");
		assert.equal(contract.plan_sha256, "<sha256-of-complete-plan>");
		assert.equal(contract.review_round_id, "<fresh-unique-round-id>");
		assert.equal(contract.round_status, "active");
		assert.deepEqual(contract.completion_cas, [
			"status=in_flight",
			"workspace_root",
			"runtime_home",
			"target",
			"launch_id",
			"round_id",
			"plan_sha256",
			"session",
			"receipt_identity=session",
			"live_plan_sha256=plan_sha256",
			"echoed_binding",
			"terminal_transition=in_flight->approved|changes_requested|inconclusive",
		]);
		assert.equal(contract["pending-action"], "review .omo/plans/<slug>.md");

		for (const [laneName, lane] of Object.entries(contract.review)) {
			assert.deepEqual(lane, {
				status: "pending",
				workspace_root: surface.reviewRoots[laneName],
				runtime_home: surface.runtimeHomes[laneName],
				target: ".omo/plans/<validated-slug>.md",
				round_id: "<review-round-id>",
				plan_sha256: "<plan-sha256>",
				launch_id: null,
				session: null,
				result: null,
			});
		}
	});

	test(`#given a ${surface.name} review round #when launch, interruption, completion, or compaction occurs #then the durable transition table fails closed`, async () => {
		const workflow = await readFile(surface.workflowPath, "utf8");
		const contract = readJsonContract(workflow, "ulw-plan-review-lifecycle-state-contract");

		assert.deepEqual(contract.transitions.launch, {
			from: "pending",
			to: "launching",
			cas: ["round_status=active", "status=pending", "workspace_root", "runtime_home", "target", "round_id", "plan_sha256"],
			writes: ["launch_id=<fresh-launch-id>"],
		});
		assert.deepEqual(contract.transitions.receipt, {
			from: "launching",
			to: "in_flight",
			cas: [
				"round_status=active",
				"status=launching",
				"workspace_root",
				"runtime_home",
				"target",
				"round_id",
				"plan_sha256",
				"launch_id",
			],
			writes: ["session=<session-or-process-receipt>"],
		});
		assert.deepEqual(contract.transitions.complete, {
			from: "in_flight",
			to: ["approved", "changes_requested", "inconclusive"],
			one_shot: true,
			cas: [
				"round_status=active",
				"workspace_root",
				"runtime_home",
				"target",
				"launch_id",
				"round_id",
				"plan_sha256",
				"session",
				"receipt_identity=session",
				"live_plan_sha256=plan_sha256",
				"echoed_binding",
			],
		});
		assert.deepEqual(contract.transitions.launch_interrupted, {
			from: { round_status: "active", lane_status: "launching" },
			to: {
				round_status: "inconclusive",
				lane_status: "inconclusive",
				result: "launch_interrupted_without_receipt",
			},
			cas: [
				"round_status=active",
				"status=launching",
				"workspace_root",
				"runtime_home",
				"target",
				"round_id",
				"plan_sha256",
				"launch_id",
			],
			invalidates_other_lane: true,
			next: "fresh_review_round",
		});
		assert.deepEqual(contract.resume_after_compaction, {
			pending: "dispatch_with_launch_cas",
			launching: "apply_launch_interrupted_transition",
			in_flight: "wait_for_matching_completion_only",
			"approved|changes_requested|inconclusive": "do_not_mutate",
			"round_status=inconclusive": "start_fresh_review_round",
		});
		assert.deepEqual(contract.rejected_completions, ["duplicate", "late", "stale", "mismatched"]);
	});

	test(`#given ${surface.name} round R2 replaced R1 #when a delayed R1 launch or receipt arrives #then identity-bound CAS leaves R2 unchanged`, async () => {
		const workflow = await readFile(surface.workflowPath, "utf8");
		const contract = readJsonContract(workflow, "ulw-plan-review-lifecycle-state-contract");
		const currentRound = {
			round_status: "active",
			status: "pending",
			workspace_root: surface.reviewRoots.independent,
			runtime_home: surface.runtimeHomes.independent,
			target: ".omo/plans/demo.md",
			round_id: "round-r2",
			plan_sha256: "sha-r2",
			launch_id: null,
		};
		const staleRound = {
			...currentRound,
			round_id: "round-r1",
			plan_sha256: "sha-r1",
			launch_id: "launch-r1",
		};

		assert.equal(matchesCas(currentRound, currentRound, contract.transitions.launch.cas), true);
		assert.equal(matchesCas(currentRound, staleRound, contract.transitions.launch.cas), false);

		const launchedCurrentRound = { ...currentRound, status: "launching", launch_id: "launch-r2" };
		assert.equal(matchesCas(launchedCurrentRound, launchedCurrentRound, contract.transitions.receipt.cas), true);
		assert.equal(matchesCas(launchedCurrentRound, staleRound, contract.transitions.receipt.cas), false);
		assert.equal(matchesCas(launchedCurrentRound, staleRound, contract.transitions.launch_interrupted.cas), false);
	});

	test(`#given ${surface.name} independent reviewers #when exact-path retrieval drifts #then intake fails closed without alternate artifact recovery`, async () => {
		const workflow = await readFile(surface.workflowPath, "utf8");
		const contract = readJsonContract(workflow, "ulw-plan-review-intake-contract");

		assert.equal(contract.independent_reviewer, surface.independentReviewer);
		assert.deepEqual(contract.lanes, ["momus", "independent"]);
		assert.equal(contract.binding, "substitute_literals_before_dispatch");
		assert.equal(contract.workspace_root, "<literal-canonical-review-workspace-root>");
		assert.equal(contract.runtime_home, "<literal-runtime-home-or-null>");
		assert.equal(contract.target, "<literal-.omo/plans/validated-slug.md>");
		assert.equal(contract.first_action, "read_exact_plan_path");
		assert.equal(contract.read_mechanism, "open_workspace_root_then_openat_no_follow_each_segment_fstat_read_hash");
		assert.equal(contract.artifact_identity, "<literal-plan-sha256>");
		assert.equal(contract.round_identity, "<literal-review-round-id>");
		assert.equal(contract.launch_identity, "<literal-launch-id>");
		assert.deepEqual(contract.required_echo, [
			"workspace_root",
			"runtime_home",
			"target",
			"artifact_identity",
			"round_identity",
			"launch_identity",
		]);
		assert.deepEqual(contract.required_receipt, ["session_or_process_identity"]);
		assert.deepEqual(contract.pre_read_validation.sort(), [
			"descriptor_relative_no_follow_each_segment",
			"open_workspace_root_directory_descriptor",
			"regular_file",
			"workspace_relative_canonical_equality",
		]);
		assert.equal(contract.drift_verdict, "INCONCLUSIVE");
		assert.deepEqual(contract.drift_conditions.sort(), [
			"ancestor_descriptor_mismatch",
			"digest_mismatch",
			"incomplete_retrieval",
			"launch_identity_mismatch",
			"path_mismatch",
			"read_failure",
			"receipt_identity_mismatch",
			"runtime_home_mismatch",
			"stale_or_different_artifact",
			"unsafe_path",
		]);
		assert.deepEqual(contract.forbidden_fallbacks.sort(), [
			"alternate_files",
			"memory",
			"search",
			"summaries",
		]);
	});
}
