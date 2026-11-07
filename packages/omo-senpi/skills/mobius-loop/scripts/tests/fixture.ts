import { onTestFinished } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMobius } from "../mobius.mjs";
import type { Envelope, Event } from "../contracts.d.mts";

export function result<T>(envelope: Envelope<T>): T {
  assert(envelope.ok, JSON.stringify(envelope));
  return envelope.result;
}

export async function fixture(focus: "discover" | "decide" | "deliver" = "discover") {
  const cwd = await mkdtemp(join(tmpdir(), "mobius-sdk-"));
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  const sdk = createMobius({ cwd, slug: "test-loop" });
  result(await sdk.start({ title: "Reduce diagnosis time", focus }));
  const store = join(cwd, ".omo", "mobius", "test-loop");
  async function record(event: Event) {
    const { snapshot } = result(await sdk.status());
    return result(await sdk.record({ expectedRevision: snapshot.revision, event }));
  }
  return { cwd, sdk, store, record };
}

export async function experimentFixture() {
  const fixtureValue = await fixture("deliver");
  const { record } = fixtureValue;
  await record({ type: "context", problem: "Diagnosis takes too long", people: [
    { name: "Installers", role: "affected" }, { name: "Owner", role: "decider" },
    { name: "Maintainer", role: "executor" }, { name: "Support", role: "stakeholder" },
  ], unknowns: [] });
  await record({ type: "outcome", id: "time", statement: "Reduce diagnosis time", baseline: "20 minutes", target: "5 minutes", measure: "Observed support sessions" });
  await record({ type: "option", id: "command", title: "Diagnostic command", hypothesis: "Faster diagnosis", tradeoffs: ["Maintenance"], outcomeIds: ["time"] });
  await record({ type: "decision", optionId: "command", rationale: "Test the shortest path", decidedBy: "Owner", refs: ["decision:1"] });
  await record({ type: "experiment", id: "trial", optionId: "command", plan: "Observe support sessions", passCriteria: "At most five minutes",
    deliveryRef: { kind: "ulw-loop", sessionId: "session-1", goalId: "goal-1" } });
  return fixtureValue;
}

export function evidence(overrides: Partial<Extract<Event, { type: "evidence" }>> = {}): Extract<Event, { type: "evidence" }> {
  return { type: "evidence", id: "observed", experimentId: "trial", outcomeId: "time", kind: "measurement",
    provenance: "observed", source: { actor: "Support", role: "stakeholder" }, summary: "Sessions took four minutes", refs: ["sessions:1"], ...overrides };
}

export function assessment(overrides: Partial<Extract<Event, { type: "assessment" }>> = {}): Extract<Event, { type: "assessment" }> {
  return { type: "assessment", experimentId: "trial", validity: "valid", hypothesisSupport: "supported",
    outcomes: [{ outcomeId: "time", status: "achieved", evidenceIds: ["observed"] }],
    learning: "Guided diagnosis reduced observed time", nextAction: "Review bounded completion", ...overrides };
}
