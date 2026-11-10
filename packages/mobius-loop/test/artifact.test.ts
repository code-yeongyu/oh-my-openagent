import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installedArtifact } from "./artifact-fixture.ts";
import { payloadFiles, validatePayload } from "./artifact-payload.ts";

test("packed skill passes the authoring gate in an isolated tarball consumer", async () => {
  const artifact = await installedArtifact();
  const archive = new Bun.Archive(await Bun.file(artifact.tarball).arrayBuffer());
  const entries = await archive.files();
  const archived = [...entries.keys()].filter(file => !file.endsWith("/"))
    .map(file => file.replace(/^package\//, "")).sort();

  await validatePayload(artifact.packageRoot, archived);

  // Bun adds .bun-tag while installing; it must not be in the tarball.
  expect((await payloadFiles(artifact.packageRoot)).filter(file => file !== ".bun-tag")).toEqual(archived);
  for (const [file, contents] of entries) {
    if (!file.endsWith("/")) {
      expect(await Bun.file(join(artifact.packageRoot, file.replace(/^package\//, ""))).bytes())
        .toEqual(new Uint8Array(await contents.arrayBuffer()));
    }
  }
  expect((await readdir(join(artifact.root, "consumer/node_modules"))).filter(name => !name.startsWith(".")))
    .toEqual(["mobius-loop"]);
  expect(await artifact.call("help")).toMatchObject({ ok: true, result: { moduleUrl: artifact.moduleUrl } });
});

test("missing packed runtime produces RED and restored installed bytes produce GREEN", async () => {
  const artifact = await installedArtifact();
  const runtime = join(artifact.packageRoot, "skills/mobius-loop/scripts/storage.mjs");
  const bytes = await readFile(runtime);
  await rm(runtime);
  try {
    const red = await artifact.invoke("help");
    expect(red.code).not.toBe(0);
    expect(red.stderr).toContain("ERR_MODULE_NOT_FOUND");
    expect(red.stderr).toContain("storage.mjs");
    console.info(`Mutation RED: removed installed storage.mjs; Node exited ${red.code} with ERR_MODULE_NOT_FOUND`);
  } finally {
    await writeFile(runtime, bytes);
  }
  expect(await readFile(runtime)).toEqual(bytes);
  expect(await artifact.call("help")).toMatchObject({ ok: true, result: { moduleUrl: artifact.moduleUrl } });
  console.info("Mutation GREEN: restored identical storage.mjs bytes; fresh Node help succeeded");
});

test("missing release guide fails the shipped Markdown gate until identical bytes are restored", async () => {
  const artifact = await installedArtifact();
  const archive = new Bun.Archive(await Bun.file(artifact.tarball).arrayBuffer());
  const files = [...(await archive.files()).keys()].filter(file => !file.endsWith("/"))
    .map(file => file.replace(/^package\//, "")).sort();
  const guide = join(artifact.packageRoot, "docs/releasing.md");
  const bytes = await readFile(guide);
  await validatePayload(artifact.packageRoot, files);

  await rm(guide);
  try {
    await expect(validatePayload(artifact.packageRoot, files)).rejects.toThrow("releasing.md");
    await expect(validatePayload(artifact.packageRoot, files.filter(file => file !== "docs/releasing.md")))
      .rejects.toThrow("docs/releasing.md");
    console.info("Mutation RED: removed installed docs/releasing.md; Markdown link and payload gates rejected it");
  } finally {
    await writeFile(guide, bytes);
  }
  expect(await readFile(guide)).toEqual(bytes);
  await validatePayload(artifact.packageRoot, files);
  console.info("Mutation GREEN: restored identical release guide bytes; shipped Markdown gate succeeded");
});

test("installed Node processes preserve resume, revision conflicts, references and learning", async () => {
  const { call, record } = await installedArtifact();
  expect(await call("start", { title: "Artifact journey", focus: "deliver" }))
    .toMatchObject({ ok: true, result: { snapshot: { revision: 0 } } });
  for (const event of [
    { type: "outcome", id: "time", statement: "Faster", baseline: "20", target: "5", measure: "Sessions" },
    { type: "option", id: "guide", title: "Guide", hypothesis: "Faster", tradeoffs: [], outcomeIds: ["time"] },
    { type: "decision", optionId: "guide", rationale: "Try", decidedBy: "Owner", refs: ["decision:1"] },
    { type: "experiment", id: "trial", optionId: "guide", plan: "Observe", passCriteria: "5",
      deliveryRef: { kind: "ulw-loop", sessionId: "session-1", goalId: "goal-1" } },
    { type: "delivery", experimentId: "trial", output: "Guide", checks: [], refs: ["release:1"] },
    { type: "pause", reason: "Await feedback" },
  ] satisfies Parameters<typeof record>[0][]) {
    expect(await record(event)).toMatchObject({ ok: true });
  }
  expect(await call("start", { title: "Do not overwrite", focus: "discover" }))
    .toMatchObject({ ok: true, result: { snapshot: { title: "Artifact journey", revision: 6 },
      records: { lifecycle: "paused", focus: "deliver" } } });
  expect(await call("record", { expectedRevision: 5, event: { type: "resume", reason: "Stale" } }))
    .toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  expect(await record({ type: "resume", reason: "Feedback available" })).toMatchObject({ ok: true });
  expect(await record({ type: "evidence", id: "simulated", experimentId: "trial", outcomeId: "time",
    kind: "measurement", provenance: "simulated", source: { actor: "Tester", role: "executor" },
    summary: "Synthetic result", refs: ["simulation:1"] })).toMatchObject({ ok: true });
  const assessment = { type: "assessment", experimentId: "trial", validity: "valid",
    hypothesisSupport: "supported", outcomes: [{ outcomeId: "time", status: "achieved", evidenceIds: ["simulated"] }],
    learning: "Simulation is not impact", nextAction: "Observe real sessions" } satisfies Parameters<typeof record>[0];
  expect(await call("record", { expectedRevision: 8, event: assessment }))
    .toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
  expect(await record({ ...assessment, hypothesisSupport: "inconclusive",
    outcomes: [{ outcomeId: "time", status: "unmeasured", evidenceIds: [] }] })).toMatchObject({ ok: true });
  expect(await record({ type: "focus", to: "discover", reason: "Reframe", refs: ["simulation:1"] }))
    .toMatchObject({ ok: true, result: { records: { focus: "discover",
      experiments: [{ deliveryRef: { sessionId: "session-1", goalId: "goal-1" } }],
      deliveries: [{ refs: ["release:1"] }], evidence: [{ refs: ["simulation:1"] }] } } });
  const learning = await call("learning", { experimentId: "trial" });
  expect(learning).toMatchObject({ ok: true });
  if (learning === null || typeof learning !== "object" || !("result" in learning)) throw new TypeError("Missing learning");
  const result = learning.result;
  if (result === null || typeof result !== "object" || !("body" in result) || typeof result.body !== "string")
    throw new TypeError("Missing learning body");
  const body: unknown = JSON.parse(result.body);
  expect(body).toMatchObject({ revision: 10, experiment: { deliveryRef: { sessionId: "session-1" } },
    assessment: { outcomes: [{ status: "unmeasured" }], learning: assessment.learning },
    evidence: [{ provenance: "simulated", source: { actor: "Tester", role: "executor" } }] });
});

test("fresh Node readers refuse malformed and symlink state and respect a writer lock", async () => {
  const { project, call } = await installedArtifact();
  expect(await call("start", { title: "Storage boundary" })).toMatchObject({ ok: true });
  const store = join(project, ".omo/mobius/artifact");
  const file = join(store, "initiative.json");
  const before = await readFile(file);
  await mkdir(join(store, ".lock"));
  try {
    expect(await call("record", { expectedRevision: 0, event: { type: "pause", reason: "Busy" } }))
      .toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(await call("status")).toMatchObject({ ok: true, result: { snapshot: { revision: 0 } } });
    expect(await readFile(file)).toEqual(before);
  } finally {
    await rm(join(store, ".lock"), { recursive: true });
  }
  expect(await call("record", { expectedRevision: 0, event: { type: "pause", reason: "Released" } }))
    .toMatchObject({ ok: true, result: { snapshot: { revision: 1 } } });
  await writeFile(file, "{broken");
  expect(await call("start", { title: "Must not replace" }))
    .toMatchObject({ ok: false, error: { code: "MALFORMED_STATE" } });
  expect(await readFile(file, "utf8")).toBe("{broken");
  const outside = join(project, "outside.json");
  await writeFile(outside, before);
  await rm(file);
  await symlink(outside, file);
  expect(await call("status")).toMatchObject({ ok: false, error: { code: "UNSAFE_PATH" } });
  expect(await call("start", { title: "Must not follow link" }))
    .toMatchObject({ ok: false, error: { code: "UNSAFE_PATH" } });
  expect(await readFile(outside)).toEqual(before);
});
