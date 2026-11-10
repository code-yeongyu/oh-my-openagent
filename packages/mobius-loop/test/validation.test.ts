import { expect, test } from "bun:test";
import { appendFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { installedArtifact } from "./artifact-fixture.ts";

test("package validator accepts contained references in an installed artifact", async () => {
  const artifact = await installedArtifact();

  const validation = await artifact.validate();

  expect(validation.code).toBe(0);
  expect(validation.stderr).toBe("");
});

test("package validator rejects a reference to an existing file outside its root", async () => {
  const artifact = await installedArtifact();
  const outside = join(artifact.root, "outside.md");
  await writeFile(outside, "Outside the package");
  const href = relative(artifact.packageRoot, outside).split(sep).join("/");
  await appendFile(join(artifact.packageRoot, "README.md"), `\n[Outside](${href})\n`);

  const validation = await artifact.validate();

  expect(validation.code).not.toBe(0);
  expect(validation.stderr).toContain(`Reference escapes package: ${href}`);
});
