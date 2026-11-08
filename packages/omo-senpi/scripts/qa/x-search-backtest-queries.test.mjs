import { describe, expect, test } from "bun:test";
import { validateQuerySet } from "./x-search-backtest-core.mjs";
import querySet from "./fixtures/x-search-backtest/queries.v1.json";

describe("x-search backtest query set v1", () => {
  test("ships a valid 20-query set with calibration and holdout splits", () => {
    expect(validateQuerySet(querySet)).toBe(true);
    expect(querySet.version).toBe(1);
    expect(querySet.carriers).toEqual(["fast", "reasoning"]);
    expect(querySet.cap_usd).toBe(6);
    expect(querySet.queries).toHaveLength(20);
    expect(new Set(querySet.queries.map((query) => query.id))).toEqual(
      new Set(Array.from({ length: 20 }, (_, index) => `q${String(index + 1).padStart(2, "0")}`)),
    );
    expect(querySet.queries.filter((query) => query.split === "calibration")).toHaveLength(14);
    expect(querySet.queries.filter((query) => query.split === "holdout")).toHaveLength(6);
    expect(querySet.queries.every((query) => Number.isInteger(query.since_days_ago) && query.since_days_ago >= 1 && query.since_days_ago <= 30)).toBe(true);
    expect(querySet.queries.every((query) => !("cohort" in query))).toBe(true);
  });
});
