import { describe, expect, test } from "bun:test";
import { appendFileSync, rmSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { Glob } from "bun";
import { copyRepo, debugEntryPaths, isObject, packageDirs, REPO_ROOT, repoFiles, runKnip, toRepoPath, unusedExports } from "./knip-run.ts";

// Every knip entry must have its exports checked (includeEntryExports), so an unused export added to
// an entry fails `knip:check`.
//
// The probe table is knip's OWN resolved entry list: `knip --debug` logs every entry glob it expands
// ("Finding entry paths", "... from plugins", "... from plugins (ignore exports)", "... from
// package.json") with the resolved `paths`, including files its plugins found run by path from
// package.json scripts and CI workflows. The test reads those paths instead of parsing commands itself.
//
// A coarse scan of package.json scripts and workflow `run:` lines cross-checks that list: any file it
// sees run by path that knip does not list as an entry fails the test. The scan can only add
// failures; it never adds or removes table rows.

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const KNIP_TIMEOUT_MS = 600_000;
const FORCED_UNCHECKED_FILE = join(import.meta.dir, "knip-entry-exports.unchecked.json");

let entriesOnce: Promise<string[]> | undefined;
const knipEntries = (): Promise<string[]> => {
  entriesOnce ??= (async () => {
    const { stdout } = await runKnip(REPO_ROOT, ["--debug"]);
    const visible = new Set(repoFiles());
    const entries = new Set<string>();
    const sections = debugEntryPaths(stdout);
    for (const path of sections.flat()) {
      if (!SOURCE_EXT.test(path)) continue;
      const rel = toRepoPath(REPO_ROOT, path);
      if (visible.has(rel)) entries.add(rel);
    }
    if (sections.length === 0) throw new Error(`knip --debug printed no "Finding entry paths" section:\n${stdout.slice(0, 2000)}`);
    return [...entries].sort();
  })();
  return entriesOnce;
};

// Coarse on purpose: per shell segment, the first source-file word is taken as run by path (all of
// them when the segment says `test`), resolved against the package dir, the repo root, and every
// `cd`/`--cwd`/`--prefix`/`working-directory` dir seen. Non-files are dropped; extra real files only over-match.
const scannedFiles = (command: string, bases: Iterable<string>, visible: ReadonlySet<string>): string[] => {
  const segments = command.split(/\n|&&|\|\||;|\|/).map((segment) =>
    segment
      .split(/\s+/)
      .map((word) => word.replace(/^["'(]+|["')]+$/g, ""))
      .filter((word) => word !== ""),
  );
  const dirs = new Set([...bases, "."]);
  for (const words of segments)
    words.forEach((word, n) => {
      if ((word === "cd" || word === "--cwd" || word === "--prefix") && words[n + 1]) dirs.add(words[n + 1] ?? ".");
      if (word.startsWith("--cwd=")) dirs.add(word.slice("--cwd=".length));
    });
  const files: string[] = [];
  for (const words of segments) {
    const sources = words.filter((word) => SOURCE_EXT.test(word));
    for (const word of words.includes("test") ? sources : sources.slice(0, 1))
      for (const dir of dirs) {
        const rel = posix.normalize(posix.join(dir, word));
        if (visible.has(rel) && statSync(join(REPO_ROOT, rel)).isFile()) files.push(rel);
      }
  }
  return files;
};

const collect = (node: unknown, key: string): string[] => {
  if (Array.isArray(node)) return node.flatMap((item) => collect(item, key));
  if (!isObject(node)) return [];
  const own = typeof node[key] === "string" ? [node[key]] : [];
  return [...own, ...Object.values(node).flatMap((value) => collect(value, key))];
};

const scanRunByPath = async (): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  const visible = new Set(repoFiles());
  const add = (file: string, source: string) => {
    if (!found.has(file)) found.set(file, source);
  };
  for (const dir of await packageDirs()) {
    const pkg: unknown = await Bun.file(join(REPO_ROOT, dir, "package.json")).json();
    const scripts = isObject(pkg) && isObject(pkg["scripts"]) ? pkg["scripts"] : {};
    for (const script of Object.values(scripts))
      if (typeof script === "string") for (const file of scannedFiles(script, [dir], visible)) add(file, `${dir}/package.json`);
  }
  for await (const name of new Glob("*.{yml,yaml}").scan({ cwd: join(REPO_ROOT, ".github/workflows") })) {
    const workflow: unknown = Bun.YAML.parse(await Bun.file(join(REPO_ROOT, ".github/workflows", name)).text());
    const dirs = collect(workflow, "working-directory");
    for (const run of collect(workflow, "run"))
      for (const file of scannedFiles(run, dirs, visible)) add(file, `.github/workflows/${name}`);
  }
  return found;
};

// A repo-sized copy is removed inside the test that made it, under that test's KNIP_TIMEOUT_MS bound: bun 1.4.4
// applies the preload's setDefaultTimeout (20 s) to an afterAll hook even when a timeout argument is passed.
const withRepoCopy = async <T>(use: (copy: string) => Promise<T>): Promise<T> => {
  const copy = await copyRepo();
  try {
    return await use(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

describe("knip export-checks every entry", () => {
  test(
    "every file run by path from scripts or workflows is a knip entry",
    async () => {
      const entries = new Set(await knipEntries());
      const notEntries = [...(await scanRunByPath())]
        .filter(([file]) => !entries.has(file))
        .map(([file, source]) => `${file} (run by path from ${source}, not a knip entry)`);
      expect(notEntries).toEqual([]);
    },
    KNIP_TIMEOUT_MS,
  );

  test(
    "a probe export appended to each knip entry is reported as unused",
    async () => {
      const entries = await knipEntries();
      expect(entries.length).toBeGreaterThan(0);

      await withRepoCopy(async (copy) => {
        const probes = entries.map((file, n) => ({ file, name: `zzKnipProbe_${n}` }));
        for (const probe of probes) appendFileSync(join(copy, probe.file), `\nexport const ${probe.name} = 1;\n`);

        // The exact CI knip.jsonc: per-symbol pre-existing rows cannot hide a new probe name.
        const { stdout, stderr } = await runKnip(copy, ["--reporter", "json"]);
        const unused = unusedExports(copy, stdout, stderr);
        // A config knip cannot load (e.g. a vitest.config.ts whose `vitest/config` import does not resolve in the copy) drops that
        // plugin's inputs, so the copy would be analyzed differently from the repo.
        const loadErrors = stderr.split(/\r?\n/).filter((line) => line.startsWith("ERROR:"));
        const missed = probes.filter((probe) => !unused.has(`${probe.file}#${probe.name}`)).map((probe) => probe.file);
        const forced: unknown = await Bun.file(FORCED_UNCHECKED_FILE).json();
        const forcedFiles = new Set(isObject(forced) && Array.isArray(forced["files"]) ? forced["files"] : []);
        const unexpected = missed.filter((file) => !forcedFiles.has(file));
        const stale = [...forcedFiles].filter((file) => typeof file !== "string" || !missed.includes(file));
        console.log(
          `knip-entry-probe: ${probes.length} entries probed, ${probes.length - missed.length} reported, ${missed.length - unexpected.length} knip-forced unchecked, ${unexpected.length} missed`,
        );
        expect({ unexpected, stale, loadErrors, stderr: unexpected.length > 0 ? stderr.slice(0, 4000) : "" }).toEqual({
          unexpected: [],
          stale: [],
          loadErrors: [],
          stderr: "",
        });
      });
    },
    KNIP_TIMEOUT_MS,
  );
});
