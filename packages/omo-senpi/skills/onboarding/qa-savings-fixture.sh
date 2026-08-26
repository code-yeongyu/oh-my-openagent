#!/usr/bin/env bash
set -euo pipefail

TMPDIR_QA=$(mktemp -d)
trap 'rm -rf "$TMPDIR_QA"' EXIT

cat > "$TMPDIR_QA/models.json" <<'EOF'
{
  "zeta": {"models": {"model-only": {"cost": {"input": 9, "output": 90, "cache_read": 0.9, "cache_write": 11}}}},
  "anthropic": {"models": {"model-a": {"cost": {"input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75}}}},
  "alpha": {"models": {"model-only": {"cost": {"input": 4, "output": 20, "cache_read": 0.4, "cache_write": 5}}}},
  "openai": {"models": {
    "model-b": {"cost": {"input": 2, "output": 10, "cache_read": 0.2, "cache_write": 2.5}},
    "model-c": {"cost": {"input": 1, "output": 5, "cache_read": 0.1}}
  }}
}
EOF

cat > "$TMPDIR_QA/2026-07-01-s1.jsonl" <<'EOF'
{"type":"session","id":"s1","timestamp":"2026-07-01T00:00:00Z"}
{"type":"message","timestamp":"2026-07-01T00:00:00.000Z","message":{"role":"assistant","usage":{"input":100000,"output":20000,"cacheRead":400000,"cacheWrite":50000}}}
{"type":"model_change","provider":"anthropic","modelId":"model-a","timestamp":"2026-07-01T00:00:00.001Z"}
{"type":"message","timestamp":"2026-07-01T00:00:00.001Z","message":{"role":"assistant","provider":"openai","model":"model-b","usage":{"input":200000,"output":30000,"cacheRead":0,"cacheWrite":100000}}}
{"type":"model_change","provider":"openai","modelId":"model-b","timestamp":"2026-07-01T00:00:00.002Z"}
{"type":"message","timestamp":"2026-07-01T00:00:00.002Z","message":{"role":"assistant","usage":{"input":0,"output":100000,"cacheRead":0,"cacheWrite":0}}}
{"type":"message","timestamp":"not-a-date","message":{"role":"assistant","provider":"anthropic","model":"model-a","usage":{"input":9000000,"output":9000000,"cacheRead":9000000,"cacheWrite":9000000}}}
EOF

cat > "$TMPDIR_QA/2026-07-02-s2.jsonl" <<'EOF'
{"type":"session","id":"s2","timestamp":"2026-07-02T00:00:00Z"}
{"type":"message","timestamp":"2026-07-02T00:00:01Z","message":{"role":"assistant","provider":"missing","model":"model-only","usage":{"input":50000,"output":10000,"cacheRead":50000,"cacheWrite":0}}}
EOF

cat > "$TMPDIR_QA/2026-07-03-insufficient.jsonl" <<'EOF'
{"type":"model_change","provider":"openai","modelId":"model-c","timestamp":"2026-07-03T00:00:00Z"}
{"type":"message","timestamp":"2026-07-03T00:00:01Z","message":{"role":"assistant","usage":{"input":100000,"output":10000,"cacheRead":100000,"cacheWrite":10000}}}
EOF

cat > "$TMPDIR_QA/2026-07-04-zero.jsonl" <<'EOF'
{"type":"model_change","provider":"openai","modelId":"model-b","timestamp":"2026-07-04T00:00:00Z"}
{"type":"message","timestamp":"2026-07-04T00:00:01Z","message":{"role":"assistant","usage":{"input":0,"output":100000,"cacheRead":0,"cacheWrite":0}}}
EOF

ACTUAL=$(node - "$TMPDIR_QA" <<'EOF'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const models = JSON.parse(fs.readFileSync(path.join(root, "models.json"), "utf8"));
const sessionFiles = fs.readdirSync(root).filter((name) => name.endsWith(".jsonl")).sort();

function priceFor(catalog, provider, model) {
  if (catalog === undefined) return undefined;
  const composite = catalog[provider]?.models?.[model]?.cost;
  if (composite !== undefined) return { provider, cost: composite };
  for (const providerId of Object.keys(catalog).sort()) {
    for (const modelId of Object.keys(catalog[providerId].models ?? {}).sort()) {
      if (modelId === model) return { provider: providerId, cost: catalog[providerId].models[modelId].cost };
    }
  }
  return undefined;
}

function validCost(cost) {
  return cost !== undefined
    && ["input", "output", "cache_read", "cache_write"].every((key) => Number.isFinite(cost[key]));
}

function readSession(file) {
  const entries = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => ({
    index,
    value: JSON.parse(line),
  }));
  const firstChange = entries.find(({ value }) => value.type === "model_change")?.value;
  let active = firstChange === undefined ? undefined : { provider: firstChange.provider, model: firstChange.modelId };
  let malformedSkipped = 0;
  const usage = [];
  for (const { value } of entries) {
    if (value.timestamp !== undefined && Number.isNaN(Date.parse(value.timestamp))) {
      malformedSkipped += 1;
      continue;
    }
    if (value.type === "model_change") {
      active = { provider: value.provider, model: value.modelId };
      continue;
    }
    const message = value.type === "message" ? value.message : undefined;
    if (message?.usage === undefined) continue;
    const identity = message.provider !== undefined && message.model !== undefined
      ? { provider: message.provider, model: message.model }
      : active;
    if (identity === undefined) continue;
    usage.push({ identity, usage: message.usage });
  }
  return { usage, malformedSkipped };
}

function summarize(catalog) {
  const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let actual = 0;
  let savings = 0;
  let insufficientSessions = 0;
  let zeroInputSessions = 0;
  let malformedSkipped = 0;
  let modelOnlyProvider = "";
  for (const name of sessionFiles) {
    const session = readSession(path.join(root, name));
    malformedSkipped += session.malformedSkipped;
    const totalInput = session.usage.reduce(
      (sum, entry) => sum + entry.usage.input + entry.usage.cacheRead + entry.usage.cacheWrite,
      0,
    );
    if (totalInput === 0) {
      zeroInputSessions += 1;
      continue;
    }
    const priced = session.usage.map((entry) => ({
      ...entry,
      price: priceFor(catalog, entry.identity.provider, entry.identity.model),
    }));
    if (priced.some((entry) => !validCost(entry.price?.cost))) {
      insufficientSessions += 1;
      continue;
    }
    for (const entry of priced) {
      const usage = entry.usage;
      const price = entry.price;
      if (price === undefined) process.exit(1);
      if (entry.identity.model === "model-only") modelOnlyProvider = price.provider;
      totals.input += usage.input;
      totals.cacheRead += usage.cacheRead;
      totals.cacheWrite += usage.cacheWrite;
      totals.output += usage.output;
      actual += (
        usage.input * price.cost.input
        + usage.output * price.cost.output
        + usage.cacheRead * price.cost.cache_read
        + usage.cacheWrite * price.cost.cache_write
      ) / 1_000_000;
      savings += usage.cacheRead * (price.cost.input - price.cost.cache_read) / 1_000_000;
    }
  }
  const grandInput = totals.input + totals.cacheRead + totals.cacheWrite;
  const round = (value) => Math.round(value * 100) / 100;
  return {
    ...totals,
    cacheRatePct: round(totals.cacheRead / grandInput * 100),
    actualCost: round(actual),
    baselineCost: round(actual + savings),
    savings: round(savings),
    insufficientSessions,
    zeroInputSessions,
    malformedSkipped,
    modelOnlyProvider,
  };
}

const priced = summarize(models);
process.stdout.write(JSON.stringify({
  ...priced,
  apiUnavailableSessions: summarize(undefined).insufficientSessions,
}));
EOF
)

EXPECTED='{"input":350000,"cacheRead":450000,"cacheWrite":150000,"output":160000,"cacheRatePct":47.37,"actualCost":3.28,"baselineCost":4.54,"savings":1.26,"insufficientSessions":1,"zeroInputSessions":1,"malformedSkipped":1,"modelOnlyProvider":"alpha","apiUnavailableSessions":3}'

test "$ACTUAL" = "$EXPECTED"
echo "qa-savings-fixture: OK"
