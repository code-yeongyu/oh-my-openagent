import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildXSearchRequest, CARRIER_MODELS, PROMPT_VARIANTS } from "../../src/components/x-search/client.ts";
import { fixtureKey, materializeDates } from "./x-search-backtest-core.mjs";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const CLI = join(ROOT, "x-search-backtest.mjs");

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: join(ROOT, "../../../../.."), env: { ...process.env, XAI_API_KEY: "test-secret", ...env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function requestFor(query, variant = "v1", carrier = "fast") {
  const dates = materializeDates(query, "2026-09-03");
  return buildXSearchRequest({ query: query.query, mode: "latest", max_results: 10, from_date: dates.since, to_date: dates.to_date, ...(query.x_search ?? {}) }, { variant, carrier: CARRIER_MODELS[carrier] });
}

function fixture(query, lane, response, status = "ok", variant = "v1", carrier = "fast") {
  const request = requestFor(query, variant, carrier);
  return { key: fixtureKey({ queryId: query.id, lane, variant, carrier, request }), value: { queryId: query.id, lane, request, response, status, usage: response?.usage ?? {}, errors: [], recordedAt: "2026-09-03T00:00:00.000Z" } };
}

describe("x-search backtest CLI", () => {
  test("offline reports blocked and missing as NA, tunes, scores holdout, and never fetches", async () => {
    const base = await mkdtemp(join(tmpdir(), "x-search-backtest-"));
    const out = join(base, "out");
    const fixtures = join(out, "fixtures");
    await mkdir(fixtures, { recursive: true });
    const queries = {
      version: 1,
      queries: [
        { id: "q01", split: "calibration", query: "alpha", since_days_ago: 7, reference_urls: ["https://x.com/a/status/101"], web_terms: ["alpha"] },
        { id: "q02", split: "holdout", query: "beta", since_days_ago: 5, reference_urls: ["https://x.com/a/status/202"], web_terms: ["beta"] },
        { id: "q03", split: "holdout", query: "gamma", since_days_ago: 4, reference_urls: [], web_terms: ["gamma"] },
      ],
    };
    const response = (id) => ({ output: [{ type: "message", content: [{ type: "output_text", text: `https://x.com/a/status/${id} result` }] }], usage: { cost_in_usd_ticks: 1000000, server_side_tool_usage_details: { x_search_calls: 1 } } });
    await writeFile(join(base, "queries.json"), JSON.stringify(queries));
    const q1 = queries.queries[0], q2 = queries.queries[1];
    for (const [q, lane, res] of [[q1, "api-direct", response(101)], [q1, "omo-tool", response(101)], [q1, "web", { text: "alpha" }], [q2, "api-direct", response(202)], [q2, "omo-tool", response(202)], [q2, "web", { text: "beta" }]]) {
      const f = fixture(q, lane, res);
      await writeFile(join(fixtures, `${f.key}.json`), JSON.stringify(f.value));
    }
    const blocked = fixture(q1, "grok-cli", "Sign in to continue", "blocked_auth");
    await writeFile(join(fixtures, `${blocked.key}.json`), JSON.stringify(blocked.value));

    const result = await run(["--queries", join(base, "queries.json"), "--mode", "offline", "--variants", "v1", "--carriers", "fast", "--out", out, "--report"], { OMO_X_SEARCH_BACKTEST_NO_NETWORK: "1" });
    // Write after creating the query file so CLI reads exactly the hand-made set.
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const report = await Bun.file(join(out, "report.json")).json();
    expect(report.queries.find((q) => q.id === "q01").lanes["grok-cli"].status).toBe("blocked_auth");
    expect(report.queries.find((q) => q.id === "q03").lanes["api-direct"].status).toBe("missing_fixture");
    expect(report.queries.find((q) => q.id === "q01").lanes["grok-cli"].jaccard).toBe(null);
    expect(report.tuning.chosen.variant).toBe("v1");
    expect(report.aggregate.holdout.jaccard.n).toBeGreaterThan(0);
    expect(report.aggregate.lanes["grok-cli"].jaccard.n).toBe(0);
  });

  test("record mode under the no-network guard fails fast", async () => {
    const base = await mkdtemp(join(tmpdir(), "x-search-backtest-record-"));
    const queries = { version: 1, queries: [{ id: "q01", split: "calibration", query: "alpha", since_days_ago: 1, reference_urls: [], web_terms: ["alpha"] }] };
    const queryFile = join(base, "queries.json");
    await writeFile(queryFile, JSON.stringify(queries));
    const result = await run(["--queries", queryFile, "--mode", "record", "--variants", "v1", "--carriers", "fast", "--out", join(base, "out"), "--cap-usd", "1"], { OMO_X_SEARCH_BACKTEST_NO_NETWORK: "1" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("network disabled");
  });
});

void PROMPT_VARIANTS;
