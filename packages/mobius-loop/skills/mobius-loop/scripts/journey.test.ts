import { expect, test } from "bun:test";
import { createMobius } from "./mobius.mjs";
import { fixture, experimentFixture, result, evidence, assessment } from "./tests/fixture.ts";

test("A1 keeps unknown people, outcomes and measures visible", async () => {
  const { sdk, record } = await fixture();
  await record({ type: "context", problem: "Build a dashboard", people: [], unknowns: ["Who benefits?"] });
  const status = await record({ type: "outcome", id: "impact", statement: "Impact is unknown" });
  expect(status.records.context?.people).toEqual([]);
  expect(status.gaps).toEqual([
    "Identify affected people.", "Unknown: Who benefits?", "Establish a baseline for outcome impact.",
    "Define a target for outcome impact.", "Define a measure for outcome impact.",
    "Measure or obtain observed feedback on outcome impact; impact is unverified.",
  ]);
  expect(result(await sdk.status()).records.outcomes[0]?.measure).toBeUndefined();
});

test("A2 and A11 resume existing context in Deliver without a workshop ceremony", async () => {
  const { cwd, sdk, record } = await experimentFixture();
  await record(evidence());
  await record({ type: "pause", reason: "Await review" });
  const resumed = createMobius({ cwd, slug: "test-loop" });
  const before = result(await resumed.start({ title: "Do not replace", focus: "discover" }));
  expect(before.snapshot.title).toBe("Reduce diagnosis time");
  const after = result(await resumed.record({ expectedRevision: before.snapshot.revision, event: { type: "resume", reason: "Review available" } }));
  expect(after.records.focus).toBe("deliver");
  expect(after.records.evidence.map(item => item.id)).toEqual(["observed"]);
  expect(after.records.lifecycle).toBe("active");
  expect(result(await sdk.status()).snapshot.revision).toBe(after.snapshot.revision);
});

test("A3 and A6 retain alternatives when choosing a revised option and another experiment", async () => {
  const { record } = await experimentFixture();
  await record({ type: "option", id: "guide", title: "Guide", hypothesis: "Self-service is faster", tradeoffs: [], outcomeIds: ["time"], supersedes: "command" });
  await record({ type: "decision", optionId: "guide", rationale: "Feedback favors self-service", decidedBy: "Owner", refs: ["feedback:1"] });
  const status = await record({ type: "experiment", id: "retry", optionId: "guide", plan: "Observe guide use", passCriteria: "Five minutes" });
  expect(status.records.options.map(item => item.id)).toEqual(["command", "guide"]);
  expect(status.records.experiments.map(item => item.id)).toEqual(["trial", "retry"]);
  expect(status.records.decisions.map(item => item.rationale)).toEqual(["Test the shortest path", "Feedback favors self-service"]);
});

test("A4 and A8 keep impact unmeasured after passing delivery checks", async () => {
  const { record } = await experimentFixture();
  await record({ type: "delivery", experimentId: "trial", output: "Command shipped",
    checks: [{ name: "Tests", status: "pass", evidence: ["ci:1"] }], refs: ["release:1"] });
  const status = await record(assessment({ validity: "unknown", hypothesisSupport: "inconclusive",
    outcomes: [{ outcomeId: "time", status: "unmeasured", evidenceIds: [] }], nextAction: "Observe installers" }));
  expect(status.records.deliveries[0]?.checks[0]?.status).toBe("pass");
  expect(status.records.assessments[0]?.outcomes[0]?.status).toBe("unmeasured");
  expect(status.nextActions).toContain("Observe installers");
  expect(status.gaps).toContain("Measure or obtain observed feedback on outcome time; impact is unverified.");
});

test("A5 and A9 keep feedback and delivery through a discovery pivot and Foundation update", async () => {
  const { record } = await experimentFixture();
  await record({ type: "delivery", experimentId: "trial", output: "Prototype", checks: [], refs: ["prototype:1"] });
  await record(evidence({ kind: "feedback", summary: "The original framing is wrong" }));
  await record({ type: "foundation", id: "feedback", area: "collaboration", note: "Invite support", owner: "Maintainer", status: "open", refs: [] });
  await record({ type: "focus", to: "discover", reason: "Reframe using feedback", refs: ["sessions:1"] });
  const status = await record({ type: "foundation", id: "feedback", area: "collaboration", note: "Support invited", owner: "Maintainer", status: "done", refs: ["meeting:1"] });
  expect(status.records.focus).toBe("discover");
  expect(status.records.foundation).toHaveLength(1);
  expect(status.records.foundation[0]?.status).toBe("done");
  expect(status.records.evidence[0]?.summary).toBe("The original framing is wrong");
  expect(status.records.deliveries[0]?.output).toBe("Prototype");
});

test("A7 separates valid execution, contradicted hypothesis and unmet outcome in exported learning", async () => {
  const { record, sdk } = await experimentFixture();
  await record(evidence({ summary: "Sessions still take twenty minutes" }));
  const status = await record(assessment({ hypothesisSupport: "contradicted",
    outcomes: [{ outcomeId: "time", status: "not_achieved", evidenceIds: ["observed"] }],
    learning: "The command did not help", nextAction: "Try a guide" }));
  expect(status.records.assessments[0]?.validity).toBe("valid");
  expect(status.records.assessments[0]?.hypothesisSupport).toBe("contradicted");
  expect(status.records.assessments[0]?.outcomes[0]?.status).toBe("not_achieved");
  const learning = result(await sdk.learning({ experimentId: "trial" }));
  const body = JSON.parse(learning.body);
  expect(body.assessment.learning).toBe("The command did not help");
  expect(body.evidence[0].source).toEqual({ actor: "Support", role: "stakeholder" });
  expect(body.evidence[0].provenance).toBe("observed");
});

test.each([
  { resolution: "achieved", kind: "measurement" },
  { resolution: "achieved", kind: "feedback" },
  { resolution: "irrelevant", kind: "feedback" },
] as const)("A12 closes current $resolution outcomes using observed $kind", async ({ resolution, kind }) => {
  const { record } = await experimentFixture();
  await record(evidence({ kind }));
  await record(assessment({ outcomes: [{ outcomeId: "time", status: resolution, evidenceIds: ["observed"] }] }));
  const status = await record({ type: "close", reason: "Bounded review complete", resolution, evidenceIds: ["observed"] });
  expect(status.records.lifecycle).toBe("closed");
  expect(status.records.closure?.resolution).toBe(resolution);
  expect(status.nextActions).toEqual([]);
});

test("A6 repeats an adjusted experiment without changing the current focus", async () => {
  const { record } = await experimentFixture();
  await record(assessment({ hypothesisSupport: "inconclusive",
    outcomes: [{ outcomeId: "time", status: "unmeasured", evidenceIds: [] }], nextAction: "Try a larger sample" }));
  const status = await record({ type: "experiment", id: "larger-sample", optionId: "command",
    plan: "Observe ten sessions", passCriteria: "At most five minutes" });
  expect(status.records.focus).toBe("deliver");
  expect(status.records.experiments.map(item => item.id)).toEqual(["trial", "larger-sample"]);
});

test("stopped closure records a reason without asserting success", async () => {
  const { record } = await fixture();
  const status = await record({ type: "close", reason: "Funding ended", resolution: "stopped", evidenceIds: [] });
  expect(status.records.closure?.resolution).toBe("stopped");
  expect(status.records.outcomes).toEqual([]);
});
