import { describe, expect, test } from "bun:test";
import {
  extractTweetIds, jaccard, recall, aggregate, fixtureKey, estimateUsd,
  costGuard, reconcileCost, redactSecrets, webOverlap, validateQuerySet,
  materializeDates, PER_CALL_CEILING_USD, LANE_STATUSES, QUERY_SPLITS,
} from "./x-search-backtest-core.mjs";

describe("x-search backtest core", () => {
  test("extracts tweet ids recursively and metrics handle empty sets", () => {
    expect(extractTweetIds({ a: "https://x.com/a/status/123", b: ["status/456", { c: "789" }] })).toEqual(["123", "456"]);
    expect(jaccard([1, 2], [2, 3])).toBeCloseTo(1 / 3);
    expect(recall([], [])).toBe(1); expect(recall([1], [])).toBe(0); expect(recall([], [1])).toBe(0);
  });
  test("aggregates numeric values only and exposes lane statuses", () => {
    expect(aggregate([1, "NA", 3, null])).toEqual({ mean: 2, median: 2, n: 2 });
    expect(LANE_STATUSES).toEqual(["ok", "blocked_auth", "error", "missing_fixture", "skipped_cost_cap"]);
    expect(QUERY_SPLITS).toEqual(["calibration", "holdout"]);
  });
  test("fixture keys are canonical and estimates fail closed", () => {
    expect(fixtureKey({ lane: "a", model: { z: 1, a: 2 }, variant: "v", carrier: "c", request: {}, wrapperRev: 1 }))
      .toBe(fixtureKey({ wrapperRev: 1, request: {}, carrier: "c", variant: "v", model: { a: 2, z: 1 }, lane: "a" }));
    expect(estimateUsd(100)).toBe(1e-8); expect(estimateUsd()).toBe("COST_UNKNOWN");
  });
  test("cost guard reserves ceiling and reconciliation marks exceeded", () => {
    expect(PER_CALL_CEILING_USD).toBe(0.25);
    expect(costGuard({ spentUsd: 5.8, reservedUsd: 0, capUsd: 6, perCallCeilingUsd: .25 })).toEqual({ canSchedule: false, reason: "cap_exceeded" });
    expect(reconcileCost({ spentUsd: 5.8, capUsd: 6, status: "ok" }, 3e9)).toMatchObject({ status: "cap_exceeded" });
  });
  test("redacts secret keys and sentinel strings recursively", () => {
    const value = { Authorization: "Bearer abc", authorization: "x", apiKey: "x", api_key: "x", access_token: "x", nested: [{ note: "contains SENTINEL" }] };
    expect(redactSecrets(value, "SENTINEL")).toEqual({ Authorization: "<redacted>", authorization: "<redacted>", apiKey: "<redacted>", api_key: "<redacted>", access_token: "<redacted>", nested: [{ note: "contains <redacted>" }] });
  });
  test("web overlap normalizes words and validates queries/materializes dates", () => {
    expect(webOverlap("cats and dogs!", ["cats", "dogs"])).toBe(1);
    const query = { id: "q", split: "calibration", since_days_ago: 7, until_days_ago: 2, web_terms: ["cats"] };
    expect(validateQuerySet({ queries: [{ ...query, split: "train" }] })).toBe(false);
    expect(validateQuerySet({ queries: [{ ...query, split: "calibration" }] })).toBe(true);
    expect(validateQuerySet({ queries: [{ ...query, split: "holdout" }] })).toBe(true);
    expect(materializeDates(query, "2026-09-03")).toEqual({ since: "2026-08-27", to_date: "2026-09-01" });
  });
});
