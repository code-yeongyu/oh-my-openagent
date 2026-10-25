import { expect, it } from "bun:test";

import { compare, countByFile, countSuppressions, ratchetedFiles, SUPPRESSION } from "./lint-ratchet.ts";

const root = "/repo";

it("counts findings per file and rule, relative to the repo root", () => {
  const counts = countByFile(
    [
      { code: "typescript(no-non-null-assertion)", filename: "packages/omo-opencode/src/a.ts" },
      { code: "typescript(no-non-null-assertion)", filename: "/repo/packages/omo-opencode/src/a.ts" },
      { code: "typescript(no-explicit-any)", filename: "packages/omo-opencode/src/a.ts" },
      { code: "typescript(ban-ts-comment)", filename: "script/b.ts" },
    ],
    root,
  );
  expect(counts).toEqual({
    "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2, "typescript/no-explicit-any": 1 },
    "script/b.ts": { "typescript/ban-ts-comment": 1 },
  });
});

it("refuses a count that goes up, including any finding in a file the baseline does not list", () => {
  const { increases } = compare(
    { "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 } },
    {
      "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 3 },
      "packages/omo-opencode/src/new.ts": { "typescript/no-explicit-any": 1 },
    },
  );
  expect(increases).toEqual([
    { file: "packages/omo-opencode/src/a.ts", rule: "typescript/no-non-null-assertion", before: 2, after: 3 },
    { file: "packages/omo-opencode/src/new.ts", rule: "typescript/no-explicit-any", before: 0, after: 1 },
  ]);
});

it("reports a count that goes down, so the baseline must be lowered in the same change", () => {
  const { increases, decreases } = compare(
    {
      "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 },
      "packages/omo-opencode/src/gone.ts": { "typescript/no-explicit-any": 1 },
    },
    { "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 } },
  );
  expect(increases).toEqual([]);
  expect(decreases).toEqual([
    { file: "packages/omo-opencode/src/gone.ts", rule: "typescript/no-explicit-any", before: 1, after: 0 },
  ]);
});

it("accepts counts that match the baseline exactly", () => {
  const counts = { "packages/omo-opencode/src/a.ts": { "typescript/no-non-null-assertion": 2 } };
  expect(compare(counts, counts)).toEqual({ increases: [], decreases: [] });
});

it("counts every disable comment that could hide one of the three rules, in both linters' forms", () => {
  // Built at runtime so this file holds no directive of its own for the gate to count.
  const line = "/".repeat(2);
  const block = ["/", "*"].join("");
  const source = [
    `${line} oxlint-disable-next-line typescript/no-explicit-any`,
    `${line} eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- legacy`,
    `${block} eslint-disable */`,
    `const a = 1; ${line} oxlint-disable-line`,
    `${line} oxlint-disable-next-line typescript/ban-ts-comment, eslint/no-console`,
    `${line} oxlint-disable-next-line eslint/no-console -- unrelated rule, not counted`,
    `const text = "oxlint-disable-next-line typescript/no-explicit-any";`,
    `${block}\n  eslint-disable-next-line typescript/no-explicit-any\n*/`,
  ].join("\n");
  expect(countSuppressions("probe.ts", source)).toBe(6);
  expect(countSuppressions("probe.ts", "const x = 1;\n")).toBe(0);
});

it("refuses a new disable comment like any other rise", () => {
  const { increases } = compare({}, { "script/probe.ts": { [SUPPRESSION]: 1 } });
  expect(increases).toEqual([{ file: "script/probe.ts", rule: SUPPRESSION, before: 0, after: 1 }]);
});

it("skips generated sources by path, so only hand-written files are ratcheted", () => {
  expect(
    ratchetedFiles([
      "packages/telemetry-core/src/otlp-proto/opentelemetry/proto/common/v1/common_pb.ts",
      "packages/senpi-desktop-protocol/src/engine-schema.generated.ts",
      "packages/telemetry-core/src/otlp-proto/handwritten.ts",
      "packages/web/lib/pb.ts",
      "README.md",
    ]),
  ).toEqual(["packages/telemetry-core/src/otlp-proto/handwritten.ts", "packages/web/lib/pb.ts"]);
});
