import { describe, expect, test } from "bun:test";
import { appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyRepo, isObject, knipConfig, REPO_ROOT, repoFiles, runKnip, unusedExports } from "./knip-run.ts";

// Coverage never shrinks: every file whose exports knip checks under the baseline config must still
// have them checked under knip.jsonc.
//
// Baseline: the committed copy script/knip-coverage-baseline.jsonc (origin/dev had no knip config, so it
// is this check's first knip.jsonc, commit 65be072d06), read at test time. It is a floor; lowering it is a
// reviewed edit of that file.
//
// "Checked" is measured, not inferred: in a temp copy, `export const zzCov_<n> = 1;` is appended to
// every source file knip can see (.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs, minus .d.*), knip runs once per
// config with `--reporter json`, and a file is checked when its probe is reported.
//
// Pre-existing unused exports are named per symbol in knip.jsonc `preprocessorOptions.preExistingExports` and dropped by
// script/knip-preexisting-exports.ts, shared byte for byte with sisyphuslabs/omo-relay-daemon (scripts/ there; its header
// comment names that repo's test path). The sha256 pin below keeps the copies equal; update both repos together.

const SOURCE = /\.[cm]?[jt]sx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const KNIP_TIMEOUT_MS = 600_000;
// sha256 of scripts/knip-preexisting-exports.ts at omo-relay-daemon main 398f750f73 (also omo-service's copy).
const SHARED_PREPROCESSOR_SHA256 = "a92ddf4eaa74dcb54aacc5a3eb975d6c5f7ffec3897cd9ee31857bbd0ca19d22";

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

const preExistingRows = (config: Record<string, unknown>): string[] => {
  const options = config["preprocessorOptions"];
  const table = isObject(options) ? options["preExistingExports"] : undefined;
  if (!isObject(table)) return [];
  return Object.entries(table).flatMap(([file, names]) => (Array.isArray(names) ? names.map((name) => `${file}#${String(name)}`) : []));
};

const fileWideExportIgnores = (config: Record<string, unknown>): string[] => {
  const blocks: Array<[string, unknown]> = [[".", config["ignoreIssues"]]];
  const workspaces = config["workspaces"];
  if (isObject(workspaces)) for (const [dir, ws] of Object.entries(workspaces)) if (isObject(ws)) blocks.push([dir, ws["ignoreIssues"]]);
  return blocks.flatMap(([dir, issues]) =>
    isObject(issues)
      ? Object.entries(issues)
          .filter(([, types]) => Array.isArray(types) && types.includes("exports"))
          .map(([file]) => (dir === "." ? file : `${dir}/${file}`))
      : [],
  );
};

describe("knip coverage never shrinks", () => {
  test("no file-wide exports ignore: a pre-existing unused export is named in preExistingExports instead", async () => {
    expect(fileWideExportIgnores(await knipConfig())).toEqual([]);
  });

  test("the preprocessor is byte-identical to omo-relay-daemon's copy", async () => {
    const bytes = await Bun.file(join(REPO_ROOT, "script/knip-preexisting-exports.ts")).bytes();
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(SHARED_PREPROCESSOR_SHA256);
  });

  test(
    "every file export-checked by the baseline config is export-checked by knip.jsonc",
    async () => {
      const files = repoFiles().filter((file) => SOURCE.test(file) && !DECLARATION.test(file));
      expect(files.length).toBeGreaterThan(0);
      await withRepoCopy(async (copy) => {
        files.forEach((file, n) => appendFileSync(join(copy, file), `\nexport const zzCov_${n} = 1;\n`));
        const baseline: unknown = Bun.JSONC.parse(await Bun.file(join(REPO_ROOT, "script/knip-coverage-baseline.jsonc")).text());
        await Bun.write(join(copy, "knip.coverage-baseline.json"), JSON.stringify(baseline));

        const checked = async (args: string[]): Promise<string[]> => {
          const { stdout, stderr } = await runKnip(copy, [...args, "--reporter", "json"]);
          const unused = unusedExports(copy, stdout, stderr);
          return files.filter((file, n) => unused.has(`${file}#zzCov_${n}`));
        };
        const base = await checked(["--config", "knip.coverage-baseline.json"]);
        const head = new Set(await checked([]));
        const lost = base.filter((file) => !head.has(file));
        console.log(
          `knip-coverage: ${files.length} files probed, baseline checks ${base.length}, knip.jsonc checks ${head.size}, lost ${lost.length}, gained ${head.size - (base.length - lost.length)}`,
        );
        expect(base.length).toBeGreaterThan(0);
        expect(lost.map((file) => `${file} (export-checked by the baseline config, not by knip.jsonc)`)).toEqual([]);
      });
    },
    KNIP_TIMEOUT_MS,
  );

  test(
    "every preExistingExports row is still an unused export knip reports",
    async () => {
      const config = await knipConfig();
      const rows = preExistingRows(config);
      expect(rows.length).toBeGreaterThan(0);
      delete config["preprocessor"];
      delete config["preprocessorOptions"];
      await withRepoCopy(async (copy) => {
        await Bun.write(join(copy, "knip.no-preprocessor.json"), JSON.stringify(config));
        const { stdout, stderr } = await runKnip(copy, ["--config", "knip.no-preprocessor.json", "--reporter", "json"]);
        const unused = unusedExports(copy, stdout, stderr);
        expect(rows.filter((row) => !unused.has(row))).toEqual([]);
      });
    },
    KNIP_TIMEOUT_MS,
  );
});
