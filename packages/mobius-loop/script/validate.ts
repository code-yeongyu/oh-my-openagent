import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const manifest: unknown = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert(manifest !== null && typeof manifest === "object");
assert("pi" in manifest && "type" in manifest);
assert.deepEqual(manifest.pi, { skills: ["./skills"] });
assert.equal(manifest.type, "module");
for (const field of ["dependencies", "exports", "bin"]) {
  assert(!(field in manifest), `Unexpected package field: ${field}`);
}
if ("scripts" in manifest) {
  assert(manifest.scripts !== null && typeof manifest.scripts === "object");
  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
    assert(!(lifecycle in manifest.scripts), `Unexpected install lifecycle: ${lifecycle}`);
  }
}
const skillRoot = resolve(root, "skills/mobius-loop");
const skillFile = resolve(skillRoot, "SKILL.md");
const skill = await readFile(skillFile, "utf8");
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill);
assert(frontmatter?.[1], "Skill frontmatter is missing");
const metadata: unknown = Bun.YAML.parse(frontmatter[1]);
assert(metadata && typeof metadata === "object");
assert("name" in metadata && metadata.name === "mobius-loop");
assert("description" in metadata && typeof metadata.description === "string");
assert(metadata.description.length > 0 && metadata.description.length <= 1024);

async function links(file: string): Promise<void> {
  const text = await readFile(file, "utf8");
  for (const [, href] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    assert(href);
    if (/^(?:https?:|#)/.test(href)) continue;
    const destination = resolve(dirname(file), href.split("#")[0] ?? "");
    assert(destination.startsWith(`${root}${sep}`), `Reference escapes package: ${href}`);
    assert((await stat(destination)).isFile(), `Missing reference: ${href}`);
  }
}

async function references(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Symlinked skill asset: ${file}`);
    if (entry.isDirectory()) {
      await references(file);
    } else if (entry.name.endsWith(".md")) {
      await links(file);
    }
  }
}
await references(skillRoot);
for (const file of ["README.md", "NOTICE.md", "docs/releasing.md"]) {
  await links(resolve(root, file));
}
for (const file of ["LICENSE.md", "NOTICE.md"]) {
  assert((await readFile(resolve(root, file), "utf8")).trim().length > 0);
}
console.log("Skill metadata, manifest boundaries, notices and relative references: PASS");
