import { describe, expect, test } from "bun:test";
import { REQUEST_TYPES } from "../../src/local-api/validate.ts";
import { fakeOwnerTarget, loadFixtures, runConformance } from "./conformance/runner.ts";

runConformance(fakeOwnerTarget);

describe("conformance fixtures", () => {
  test("every request type and the hello have at least one ok case and one refusal", () => {
    const fixtures = loadFixtures();
    const covered = [...REQUEST_TYPES, "hello"].map((type) => {
      const cases = fixtures.filter((f) => f.request === type).flatMap((f) => f.cases);
      return {
        type,
        ok: cases.some((c) => c.outcome === "ok"),
        refusal: cases.some((c) => c.outcome === "refusal"),
      };
    });
    expect(covered.filter((c) => !c.ok || !c.refusal)).toEqual([]);
    expect(fixtures.map((f) => f.request).toSorted()).toEqual(
      [...REQUEST_TYPES, "hello"].toSorted(),
    );
  });
});
