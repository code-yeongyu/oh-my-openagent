import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, symlink, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createMobius } from "./mobius.mjs";
import { fixture, experimentFixture, result, evidence, assessment } from "./tests/fixture.ts";

test("persists one atomic snapshot and history, independently for each project and slug", async () => {
  const { cwd, store, record } = await fixture();
  await record({ type: "focus", to: "deliver", reason: "Existing context", refs: [] });
  const sdk = createMobius({ cwd, slug: "test-loop" });
  const status = result(await sdk.status());
  expect(status.snapshot.revision).toBe(1);
  expect(status.snapshot.events[0]?.event).toEqual({ type: "focus", to: "deliver", reason: "Existing context", refs: [] });
  expect(JSON.parse(await readFile(join(store, "initiative.json"), "utf8"))).toEqual(status.snapshot);
  expect((await readdir(store)).sort()).toEqual([".gitignore", "initiative.json"]);
  expect(await readFile(join(store, ".gitignore"), "utf8")).toBe("*\n");
  const other = createMobius({ cwd, slug: "other-loop" });
  expect(await other.status()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(result(await other.start({ title: "Independent" })).snapshot.revision).toBe(0);
  const second = await fixture();
  expect(result(await second.sdk.status()).records.focus).toBe("discover");
});

test("refuses stale revisions and deterministic busy writers without changing state", async () => {
  const { sdk, store, record } = await fixture();
  await record({ type: "pause", reason: "Wait" });
  const before = await readFile(join(store, "initiative.json"), "utf8");
  expect(await sdk.record({ expectedRevision: 0, event: { type: "resume", reason: "Stale" } }))
    .toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  await mkdir(join(store, ".lock"));
  try {
    expect(await sdk.record({ expectedRevision: 1, event: { type: "resume", reason: "Busy" } }))
      .toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(await sdk.start({ title: "Busy" })).toMatchObject({ ok: false, error: { code: "BUSY" } });
    expect(result(await sdk.status()).records.lifecycle).toBe("paused");
  } finally { await rm(join(store, ".lock"), { recursive: true }); }
  expect(await readFile(join(store, "initiative.json"), "utf8")).toBe(before);
});

test.each([
  "{broken",
  JSON.stringify({ schemaVersion: 1, slug: "test-loop", title: "Broken", initialFocus: "discover", revision: 7, events: [] }),
  JSON.stringify({ schemaVersion: 1, slug: "test-loop", title: "Broken", initialFocus: "discover", revision: 1,
    events: [{ revision: 1, at: "2026-11-06T00:00:00.000Z", event: { type: "decision", optionId: "missing", rationale: "Invalid", decidedBy: "Nobody", refs: [] } }] }),
])("preserves malformed state for diagnosis %#", async contents => {
  const { sdk, store } = await fixture();
  const file = join(store, "initiative.json");
  await writeFile(file, contents);
  expect(await sdk.status()).toMatchObject({ ok: false, error: { code: "MALFORMED_STATE" } });
  expect(await sdk.start({ title: "Do not overwrite" })).toMatchObject({ ok: false, error: { code: "MALFORMED_STATE" } });
  expect(await sdk.record({ expectedRevision: 0, event: { type: "pause", reason: "Invalid" } }))
    .toMatchObject({ ok: false, error: { code: "MALFORMED_STATE" } });
  expect(await readFile(file, "utf8")).toBe(contents);
});

test.each(["../escape", "nested/path", ".", "..", "has space", "UPPER", "a--b", "a".repeat(81)])("refuses unsafe slug %s", async slug => {
  const { cwd } = await fixture();
  const sdk = createMobius({ cwd, slug });
  expect(await sdk.start({ title: "Unsafe" })).toMatchObject({ ok: false, error: { code: "UNSAFE_PATH" } });
});

test("replay refuses achievement whose persisted evidence became simulated", async () => {
  const { sdk, store, record } = await experimentFixture();
  await record(evidence());
  const { snapshot } = await record(assessment());
  for (const entry of snapshot.events) {
    if (entry.event.type === "evidence") entry.event.provenance = "simulated";
  }
  const contents = JSON.stringify(snapshot);
  await writeFile(join(store, "initiative.json"), contents);
  expect(await sdk.status()).toMatchObject({ ok: false, error: { code: "MALFORMED_STATE" } });
  expect(await sdk.start({ title: "Cannot bypass validation" })).toMatchObject({ ok: false, error: { code: "MALFORMED_STATE" } });
  expect(await readFile(join(store, "initiative.json"), "utf8")).toBe(contents);
});

test("refuses HOME as a project", async () => {
  const sdk = createMobius({ cwd: homedir(), slug: "must-not-write" });
  expect(await sdk.start({ title: "Unsafe" })).toMatchObject({ ok: false, error: { code: "UNSAFE_PATH" } });
});

test.each([".omo", ".omo/mobius", ".omo/mobius/test-loop", ".omo/mobius/test-loop/initiative.json",
  ".omo/mobius/test-loop/.lock", ".omo/mobius/test-loop/.gitignore"])("refuses symlinked storage at %s", async relative => {
  const { sdk, cwd } = await fixture();
  const target = join(cwd, relative);
  const destination = join(cwd, "outside");
  await rm(target, { recursive: true, force: true });
  await mkdir(destination);
  await mkdir(dirname(target), { recursive: true });
  await symlink(destination, target);
  expect(await sdk.start({ title: "Unsafe" })).toMatchObject({ ok: false, error: { code: "UNSAFE_PATH" } });
  expect(await readdir(destination)).toEqual([]);
});

test("captures caller events before asynchronous storage work", async () => {
  const { sdk } = await fixture();
  const event = { type: "pause", reason: "Original" } as const;
  const mutable = { ...event };
  const write = sdk.record({ expectedRevision: 0, event: mutable });
  Reflect.set(mutable, "reason", "Changed");
  result(await write);
  expect(result(await sdk.status()).snapshot.events[0]?.event).toEqual(event);
});

test("rejects captured events missing required fields without corrupting durable state", async () => {
  const { cwd, sdk, store } = await fixture();
  class Pause {
    readonly type = "pause";
    get reason() { return "Wait for observed feedback"; }
  }
  const file = join(store, "initiative.json");
  const before = await readFile(file, "utf8");

  expect(await sdk.record({ expectedRevision: 0, event: new Pause() }))
    .toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

  expect(await readFile(file, "utf8")).toBe(before);
  const reopened = createMobius({ cwd, slug: "test-loop" });
  expect(result(await reopened.status()).snapshot.revision).toBe(0);
});

test("persists the captured start input so a successful initiative remains replayable", async () => {
  const { cwd } = await fixture();
  const sdk = createMobius({ cwd, slug: "captured-start" });
  let reads = 0;
  const input = { get title() { return ++reads === 1 ? "Captured title" : ""; } };

  const started = result(await sdk.start(input));

  expect(started.snapshot.title).toBe("Captured title");
  const reopened = createMobius({ cwd, slug: "captured-start" });
  expect(result(await reopened.status()).snapshot.title).toBe("Captured title");
});
