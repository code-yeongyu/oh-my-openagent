import { expect, test } from "bun:test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installedArtifact } from "./artifact-fixture.ts";

test("process death before atomic rename retains the committed snapshot and refuses the abandoned lock", async () => {
  const artifact = await installedArtifact();
  expect(await artifact.call("start", { title: "Interrupted artifact write" })).toMatchObject({ ok: true });
  const store = join(artifact.project, ".omo/mobius/artifact");
  const file = join(store, "initiative.json");
  const before = await readFile(file);
  const preload = join(artifact.root, "interrupt-rename.mjs");
  await writeFile(preload, `
    import { createRequire, syncBuiltinESMExports } from "node:module";
    const fs = createRequire(import.meta.url)("node:fs/promises");
    fs.rename = async () => { process.kill(process.pid, "SIGKILL"); };
    syncBuiltinESMExports();
  `);

  const interrupted = await artifact.invoke("record", {
    expectedRevision: 0, event: { type: "pause", reason: "Must not commit" },
  }, pathToFileURL(preload).href);

  expect(interrupted.code).not.toBe(0);
  expect(await readFile(file)).toEqual(before);
  expect((await readdir(store)).filter(name => /^\.initiative-.*\.tmp$/.test(name))).toHaveLength(1);
  expect(await artifact.call("status")).toMatchObject({ ok: true, result: {
    snapshot: { revision: 0 }, records: { lifecycle: "active" },
  } });
  expect(await artifact.call("record", { expectedRevision: 0, event: { type: "pause", reason: "Abandoned lock" } }))
    .toMatchObject({ ok: false, error: { code: "BUSY" } });
});
