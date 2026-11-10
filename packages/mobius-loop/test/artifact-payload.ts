import assert from "node:assert/strict";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export async function payloadFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `Unexpected package symlink: ${entry.name}`);
    if (entry.isDirectory()) {
      files.push(...(await payloadFiles(resolve(root, entry.name))).map(file => `${entry.name}/${file}`));
    } else {
      assert(entry.isFile(), `Unexpected package entry: ${entry.name}`);
      files.push(entry.name);
    }
  }
  return files.sort();
}

export async function validatePayload(root: string, files: readonly string[]) {
  const required = ["package.json", "README.md", "LICENSE.md", "NOTICE.md", "docs/releasing.md",
    "skills/mobius-loop/SKILL.md",
    ...["mobius.mjs", "storage.mjs", "records.mjs", "status.mjs", "assessment.mjs", "validation.mjs",
      "mobius.d.mts", "contracts.d.mts"].map(name => `skills/mobius-loop/scripts/${name}`)];
  for (const file of files) {
    assert(required.includes(file)
      || /^skills\/mobius-loop\/references\/[^/]+\.md$/.test(file), `Unexpected shipped file: ${file}`);
  }
  for (const file of required) {
    assert(files.includes(file), `Missing required shipped file: ${file}`);
  }
  const manifest: unknown = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert(manifest !== null && typeof manifest === "object");
  assert("name" in manifest && manifest.name === "mobius-loop");
  assert("pi" in manifest);
  assert.deepEqual(manifest.pi, { skills: ["./skills"] });
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "bundledDependencies",
    "bundleDependencies", "exports", "main", "module", "bin", "workspaces"]) {
    assert(!(field in manifest), `Unexpected package entrypoint or dependency: ${field}`);
  }
  if ("scripts" in manifest) {
    assert(manifest.scripts !== null && typeof manifest.scripts === "object");
    for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
      assert(!(lifecycle in manifest.scripts), `Unexpected install lifecycle: ${lifecycle}`);
    }
  }
  const skillPath = resolve(root, "skills/mobius-loop/SKILL.md");
  const skill = await readFile(skillPath, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1];
  assert(frontmatter, "Skill metadata is required");
  const metadata: unknown = Bun.YAML.parse(frontmatter);
  assert(metadata !== null && typeof metadata === "object");
  assert("name" in metadata && metadata.name === "mobius-loop");
  assert("description" in metadata && typeof metadata.description === "string");
  assert(metadata.description.length > 0 && metadata.description.length <= 1024);
  let referenceCount = 0;
  for (const file of files.filter(entry => entry.endsWith(".md"))) {
    const text = await readFile(resolve(root, file), "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const href = match[1];
      assert(href);
      if (/^(?:https?:|#)/.test(href)) continue;
      const target = resolve(dirname(resolve(root, file)), href.split("#")[0] ?? "");
      assert(!relative(root, target).startsWith(`..${sep}`), `Reference escapes package: ${href}`);
      assert((await realpath(target)).startsWith(`${await realpath(root)}${sep}`));
      assert((await stat(target)).isFile(), `Missing relative reference: ${href}`);
      referenceCount += 1;
    }
  }
  assert(referenceCount > 0, "Validate actual relative Markdown references");
  for (const file of ["LICENSE.md", "NOTICE.md"]) {
    assert((await readFile(resolve(root, file), "utf8")).trim().length > 0);
  }
}
