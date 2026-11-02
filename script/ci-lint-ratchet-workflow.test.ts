import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("workflow field must be an object");
  }
  return value;
}

test("lint ratchet is an independent required-check candidate on every dev PR and merge group", () => {
  const workflow = record(load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")));
  const triggers = record(workflow.on);
  expect(record(triggers.pull_request).branches).toContain("dev");
  expect(record(triggers.pull_request).paths).toBeUndefined();
  expect(record(triggers.pull_request)["paths-ignore"]).toBeUndefined();
  expect(record(triggers.merge_group).types).toContain("checks_requested");

  const job = record(record(workflow.jobs)["lint-ratchet"]);
  expect(job.name).toBe("Lint ratchet");
  expect(job.if).toBeUndefined();
  expect(job.needs).toBeUndefined();
  expect(job["continue-on-error"]).toBeUndefined();
  if (!Array.isArray(job.steps)) throw new Error("ratchet job must have steps");
  const steps = job.steps.map(record);
  const ratchet = steps.filter((step) => step.run === "bun run lint:ratchet");
  expect(ratchet).toHaveLength(1);
  expect(ratchet[0]?.if).toBeUndefined();
  expect(ratchet[0]?.["continue-on-error"]).toBeUndefined();
  expect(steps.some((step) => step.run === "bun install --frozen-lockfile --ignore-scripts")).toBe(true);
});
