// Biome parity for the rules ported to oxlint (script/oxlint/biome-ports.ts). Each has a probe corpus in
// script/oxlint/parity/<rule>.corpus, one case per line. `--update` lints every corpus with the Biome rule
// it replaces (Biome 2.5.14 through bunx) and records the flagged lines in biome-verdicts.json;
// script/oxlint/biome-parity.test.ts fails when an oxlint port flags different lines.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
export const parityDir = join(import.meta.dir, "parity");
export const verdictsPath = join(parityDir, "biome-verdicts.json");
export const BIOME = "@biomejs/biome@2.5.14";

export const PORTS: Readonly<Record<string, { readonly corpus: string; readonly rules: Record<string, Record<string, string>> }>> = {
  "omo/no-enum": { corpus: "no-enum", rules: { style: { noEnum: "error" } } },
  "omo/no-implicit-any-let": { corpus: "no-implicit-any-let", rules: { suspicious: { noImplicitAnyLet: "error" } } },
  "omo/no-string-case-mismatch": { corpus: "no-string-case-mismatch", rules: { correctness: { noStringCaseMismatch: "error" } } },
};

const linesIn = (text: string, pattern: RegExp): number[] =>
  [...new Set([...text.matchAll(pattern)].map((match) => Number(match[1])))].sort((left, right) => left - right);

const biomeLines = (corpus: string, rules: Record<string, Record<string, string>>): number[] => {
  const dir = mkdtempSync(join(tmpdir(), "omo-biome-parity-"));
  try {
    copyFileSync(join(parityDir, `${corpus}.corpus`), join(dir, "corpus.ts"));
    writeFileSync(
      join(dir, "biome.json"),
      JSON.stringify({ linter: { enabled: true, rules: { recommended: false, ...rules } }, formatter: { enabled: false } }),
    );
    const result = Bun.spawnSync(["bunx", BIOME, "lint", "--max-diagnostics=500", "corpus.ts"], { cwd: dir });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    if (!/Checked 1 file/.test(output)) throw new Error(`Biome did not lint the ${corpus} corpus:\n${output}`);
    return linesIn(output, /^corpus\.ts:(\d+):\d+ lint\//gm);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Lines the repo's root oxlint config flags for `rule` when the corpus is linted as a .ts file.
export const oxlintLines = (rule: string, corpus: string): number[] => {
  const dir = mkdtempSync(join(tmpdir(), "omo-oxlint-parity-"));
  try {
    const file = join(dir, "corpus.ts");
    copyFileSync(join(parityDir, `${corpus}.corpus`), file);
    // JSON output, not unix lines: a Windows path (D:\...) has its own colon before the line number.
    const result = Bun.spawnSync([join(root, "node_modules/.bin/oxlint"), "-c", join(root, ".oxlintrc.json"), "-f", "json", file], { cwd: root });
    const code = rule.replace(/^([^/]+)\/(.+)$/, "$1($2)");
    const { diagnostics }: { diagnostics: { code?: string; labels: { span: { line: number } }[] }[] } = JSON.parse(result.stdout.toString());
    const lines = diagnostics.filter((diagnostic) => diagnostic.code === code).flatMap((diagnostic) => diagnostic.labels.map((label) => label.span.line));
    return [...new Set(lines)].sort((left, right) => left - right);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  if (process.argv.includes("--update")) {
    const rules = Object.fromEntries(Object.entries(PORTS).map(([rule, port]) => [rule, biomeLines(port.corpus, port.rules)]));
    writeFileSync(verdictsPath, `${JSON.stringify({ biome: BIOME, rules }, null, 2)}\n`);
    console.log(`biome-verdicts.json written from ${BIOME}`);
  } else {
    const verdicts: { rules: Record<string, number[]> } = await Bun.file(verdictsPath).json();
    let differs = false;
    for (const [rule, port] of Object.entries(PORTS)) {
      const biome = verdicts.rules[rule];
      const oxlint = oxlintLines(rule, port.corpus);
      const same = JSON.stringify(biome) === JSON.stringify(oxlint);
      differs ||= !same;
      console.log(`${same ? "same" : "DIFFERENT"} ${rule}: Biome ${JSON.stringify(biome)} oxlint ${JSON.stringify(oxlint)}`);
    }
    process.exitCode = differs ? 1 : 0;
  }
}
