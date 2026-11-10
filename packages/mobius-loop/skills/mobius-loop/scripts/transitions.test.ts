import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { fixture, experimentFixture, result, evidence, assessment } from "./tests/fixture.ts";
import type { Event } from "./contracts.d.mts";

test.each([
  { provenance: "simulated", kind: "feedback" },
  { provenance: "inferred", kind: "measurement" },
  { provenance: "observed", kind: "technical" },
] as const)("A10 refuses impact achievement from $provenance $kind evidence", async evidenceType => {
  const { record, sdk } = await experimentFixture();
  await record(evidence(evidenceType));
  const before = result(await sdk.status());
  const rejected = await sdk.record({ expectedRevision: before.snapshot.revision, event: assessment() });
  expect(rejected).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
  const after = result(await sdk.status());
  expect(after.snapshot.revision).toBe(before.snapshot.revision);
  expect(after.records.evidence[0]?.provenance).toBe(evidenceType.provenance);
  expect(after.records.assessments).toEqual([]);
});

test.each(["invalid", "unknown"] as const)("refuses achieved outcomes from %s experiments", async validity => {
  const { sdk, record } = await experimentFixture();
  await record(evidence());
  const { snapshot } = result(await sdk.status());
  expect(await sdk.record({ expectedRevision: snapshot.revision, event: assessment({ validity }) }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test("requires the selected option before beginning an experiment", async () => {
  const { record, sdk } = await fixture();
  await record({ type: "outcome", id: "impact", statement: "Reduce work" });
  const { snapshot } = await record({ type: "option", id: "a", title: "A", hypothesis: "Less work", tradeoffs: [], outcomeIds: ["impact"] });
  expect(await sdk.record({ expectedRevision: snapshot.revision,
    event: { type: "experiment", id: "trial", optionId: "a", plan: "Try it", passCriteria: "Less work" } }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test.each([
  { type: "option", id: "orphan", title: "Orphan", hypothesis: "Unknown", tradeoffs: [], outcomeIds: ["missing"] },
  { type: "decision", optionId: "missing", rationale: "Unknown", decidedBy: "Owner", refs: [] },
  { type: "delivery", experimentId: "missing", output: "Unknown", checks: [], refs: [] },
  { type: "evidence", id: "orphan", experimentId: "missing", kind: "measurement", provenance: "observed", source: { actor: "Owner", role: "stakeholder" }, summary: "Unknown", refs: [] },
] satisfies Event[])("refuses dangling references for $type", async event => {
  const { sdk } = await fixture();
  expect(await sdk.record({ expectedRevision: 0, event }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test("changed outcomes invalidate earlier supported resolutions", async () => {
  const { record, sdk } = await experimentFixture();
  await record(evidence());
  await record(assessment());
  const { snapshot, gaps } = await record({ type: "outcome", id: "time", statement: "Reduce to one minute", target: "One minute" });
  expect(gaps).toContain("Measure or obtain observed feedback on outcome time; impact is unverified.");
  expect(await sdk.record({ expectedRevision: snapshot.revision,
    event: { type: "close", resolution: "achieved", reason: "Old success", evidenceIds: ["observed"] } }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
  expect(result(await sdk.status()).records.assessments).toHaveLength(1);
});

test("assessment evidence must match its experiment and outcome", async () => {
  const { record, sdk } = await experimentFixture();
  await record(evidence());
  await record({ type: "experiment", id: "second", optionId: "command", plan: "Another sample", passCriteria: "Five minutes" });
  const { snapshot } = result(await sdk.status());
  expect(await sdk.record({ expectedRevision: snapshot.revision, event: assessment({ experimentId: "second" }) }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test("closure requires cited supporting evidence", async () => {
  const { record, sdk } = await experimentFixture();
  await record(evidence());
  const { snapshot } = await record(assessment());
  expect(await sdk.record({ expectedRevision: snapshot.revision,
    event: { type: "close", resolution: "achieved", reason: "No references", evidenceIds: [] } }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test("one achieved outcome cannot close another unmeasured outcome", async () => {
  const { record, sdk } = await experimentFixture();
  await record(evidence());
  await record(assessment());
  const { snapshot } = await record({ type: "outcome", id: "confidence", statement: "Increase confidence" });
  expect(await sdk.record({ expectedRevision: snapshot.revision,
    event: { type: "close", resolution: "achieved", reason: "Partial success", evidenceIds: ["observed"] } }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test.each([
  { type: "option", id: "command", title: "Duplicate", hypothesis: "Duplicate", tradeoffs: [], outcomeIds: ["time"] },
  { type: "experiment", id: "trial", optionId: "command", plan: "Duplicate", passCriteria: "Duplicate" },
  evidence(),
] satisfies Event[])("refuses reused identifiers for $type", async event => {
  const { record, sdk } = await experimentFixture();
  const { snapshot } = await record(evidence());
  expect(await sdk.record({ expectedRevision: snapshot.revision, event }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test("a later invalid assessment withdraws its earlier outcome resolution", async () => {
  const { record, sdk } = await experimentFixture();
  await record(evidence());
  await record(assessment());
  const { snapshot } = await record(assessment({ validity: "invalid", hypothesisSupport: "inconclusive", outcomes: [],
    learning: "Sampling was biased", nextAction: "Repeat with representative users" }));
  expect(await sdk.record({ expectedRevision: snapshot.revision,
    event: { type: "close", resolution: "achieved", reason: "Outdated review", evidenceIds: ["observed"] } }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test("paused initiatives require resume and closed initiatives cannot be mutated", async () => {
  const { sdk, record } = await fixture();
  const paused = await record({ type: "pause", reason: "Wait" });
  expect(await sdk.record({ expectedRevision: paused.snapshot.revision,
    event: { type: "focus", to: "deliver", reason: "Skip pause", refs: [] } }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
  const closed = await record({ type: "close", reason: "Cancelled", resolution: "stopped", evidenceIds: [] });
  expect(await sdk.record({ expectedRevision: closed.snapshot.revision, event: { type: "resume", reason: "Reopen" } }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
});

test.each<Readonly<Record<string, unknown>>>([
  { type: "context", problem: "", people: [], unknowns: [] },
  { type: "focus", to: "foundation", reason: "Invalid focus", refs: [] },
  { type: "pause", reason: "Pause", surprise: true },
  { type: "pause", reason: "Pause", constructor: "Unknown field" },
  { type: "evidence", id: "e", experimentId: "trial", kind: "feedback", provenance: "imagined", source: { actor: "Agent", role: "executor" }, summary: "Predicted", refs: [] },
])("validates malformed public events without writing $type", async event => {
  const { sdk } = await fixture();
  expect(await Reflect.apply(sdk.record, sdk, [{ expectedRevision: 0, event }]))
    .toMatchObject({ ok: false, operation: "record", error: { code: "INVALID_INPUT" } });
  expect(result(await sdk.status()).snapshot.revision).toBe(0);
});

test("learning requires an assessment and help supplies executable event contracts", async () => {
  const { sdk } = await experimentFixture();
  expect(await sdk.learning({ experimentId: "trial" }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
  const help = result(await sdk.help());
  expect(new URL(help.moduleUrl).protocol).toBe("file:");
  expect(help.events.evidence?.provenance).toBe("observed|simulated|inferred");
  expect(help.methods.record?.expectedRevision).toBe("revision");
});

test("mutating help contracts cannot weaken public event validation", async () => {
  const { sdk } = await experimentFixture();
  const help = result(await sdk.help());
  const source = help.events.evidence?.source;
  assert(source && typeof source === "object" && "object" in source);
  source.object.role = "string";
  expect(await Reflect.apply(sdk.record, sdk, [{ expectedRevision: 5,
    event: { ...evidence(), source: { actor: "Robot", role: "robot" } } }]))
    .toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
});
