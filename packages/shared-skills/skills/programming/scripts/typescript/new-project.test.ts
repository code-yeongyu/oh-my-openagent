import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const runRoot = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), "programming-scaffold-"));
const project = join(runRoot, "example");

async function run(args: string[], cwd = project) {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

describe("#given a newly scaffolded TypeScript project", () => {
  beforeAll(async () => {
    const result = await run(
      [process.execPath, join(import.meta.dir, "new-project.ts"), "example", "--path", runRoot],
      runRoot,
    );
    expect(result.code).toBe(0);
  });

  afterAll(() => rmSync(runRoot, { recursive: true, force: true }));

  test("#when scaffolding offline #then OXC configs and the local plugin are generated", async () => {
    for (const file of [
      ".oxlintrc.json",
      ".oxfmtrc.json",
      "package.json",
      "tsconfig.json",
      "src/index.ts",
      ".gitignore",
      "lint/oxlint-plugin/index.js",
      "lint/oxlint-plugin/no-em-dash-copy.js",
      "lint/oxlint-plugin/require-suppression-reason.js",
      "lint/oxlint-plugin/LICENSE",
    ]) {
      expect(existsSync(join(project, file))).toBe(true);
    }
    expect(existsSync(join(project, "biome.json"))).toBe(false);
    const pkg = await Bun.file(join(project, "package.json")).json();
    expect(pkg.devDependencies.oxlint).toBeDefined();
    expect(pkg.devDependencies.oxfmt).toBeDefined();
    expect(pkg.devDependencies["oxlint-tsgolint"]).toBeDefined();
    expect(pkg.scripts.lint).toBe("oxlint --type-aware --deny-warnings");
    const config = await Bun.file(join(project, ".oxlintrc.json")).json();
    expect(config.jsPlugins).toContainEqual({
      name: "programming",
      specifier: "./lint/oxlint-plugin/index.js",
    });
    expect(config.rules["programming/require-suppression-reason"]).toBe("error");
    expect(config.overrides[0].rules["programming/no-em-dash-copy"]).toBe("error");
    const tsconfig = await Bun.file(join(project, "tsconfig.json")).json();
    expect(tsconfig.include).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
  });

  test("#when visiting copy offline #then the generated plugin reports em dashes", async () => {
    const { default: plugin } = await import(
      pathToFileURL(join(project, "lint/oxlint-plugin/index.js")).href
    );
    const reports: unknown[] = [];
    const visitors = plugin.rules["no-em-dash-copy"].create({
      report: (report: unknown) => reports.push(report),
    });
    const literal = { type: "Literal", value: "Hello\u2014world" };
    const template = { type: "TemplateElement", value: { cooked: "Hello\u2014world" } };
    const jsx = { type: "JSXText", value: "Hello\u2014world" };
    visitors.Literal(literal);
    visitors.TemplateElement(template);
    visitors.JSXText(jsx);
    expect(reports).toHaveLength(3);
    expect(reports).toEqual([
      expect.objectContaining({ node: literal }),
      expect.objectContaining({ node: template }),
      expect.objectContaining({ node: jsx }),
    ]);
    visitors.Literal({ type: "Literal", value: "Hello, world" });
    visitors.Literal({ type: "Literal", value: /Hello\u2014world/ });
    visitors.TemplateElement({ type: "TemplateElement", value: { cooked: null } });
    visitors.JSXText({ type: "JSXText", value: "Hello, world" });
    expect(reports).toHaveLength(3);
  });

  // Opt in to registry-dependent install + lint/format/typecheck coverage:
  // OMO_TEST_SCAFFOLD_INSTALL=1 bun test packages/shared-skills/skills/programming/scripts/typescript/new-project.test.ts
  test.skipIf(process.env.OMO_TEST_SCAFFOLD_INSTALL !== "1")(
    "#when linting seeded product copy #then the installed generated rule rejects it",
    async () => {
      // given the dependencies and configuration emitted by the real scaffold
      const pkg = await Bun.file(join(project, "package.json")).json();
      expect(pkg.devDependencies.oxlint).toBeDefined();
      const install = await run([process.execPath, "install", "--ignore-scripts"]);
      expect(install.code).toBe(0);
      const clean = await run([process.execPath, "run", "lint"]);
      expect(clean.stdout + clean.stderr).not.toContain("Unknown rule");
      expect(clean.code).toBe(0);
      const formatted = await run([process.execPath, "run", "fmt:check"]);
      expect(formatted.code).toBe(0);
      const typed = await run([process.execPath, "run", "typecheck"]);
      expect(typed.code).toBe(0);
      writeFileSync(join(project, "src/copy.ts"), 'export const copy = "Hello\\u2014world"\n');

      // when the generated project's own lint command runs
      const result = await run([process.execPath, "run", "lint"]);

      // then it fails for the copy rule, rather than a missing tool or invalid configuration
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).toContain("programming(no-em-dash-copy)");

      // given cooked template text and JSX copy, not only string literals
      writeFileSync(
        join(project, "src/copy.tsx"),
        "export const template = `Hello\\u2014world`\nexport const view = <p>Hello\u2014world</p>\n",
      );
      const jsx = await run([process.execPath, "run", "lint", "--", "src/copy.tsx"]);
      expect(jsx.code).toBe(1);
      expect((jsx.stdout + jsx.stderr).match(/programming\(no-em-dash-copy\)/g)).toHaveLength(2);

      // given comments, regexes, and test fixtures outside the copy policy
      writeFileSync(
        join(project, "src/clean.ts"),
        "// Hello\u2014world\nexport const pattern = /Hello\u2014world/\n",
      );
      writeFileSync(join(project, "src/copy.test.ts"), 'export const copy = "Hello\\u2014world"\n');
      const exempt = await run([
        process.execPath,
        "run",
        "lint",
        "--",
        "src/clean.ts",
        "src/copy.test.ts",
      ]);
      expect(exempt.code).toBe(0);

      // given lint suppressions without a reason, the local reason rule reports them
      writeFileSync(
        join(project, "src/suppression.ts"),
        "// oxlint-disable-next-line no-unused-vars\nconst hidden = 1\n",
      );
      const unexplained = await run([process.execPath, "run", "lint", "--", "src/suppression.ts"]);
      expect(unexplained.code).toBe(1);
      expect(unexplained.stdout + unexplained.stderr).toContain(
        "programming(require-suppression-reason)",
      );

      writeFileSync(
        join(project, "src/suppression.ts"),
        "// Synthetic legacy interop fixture.\n// oxlint-disable-next-line no-unused-vars\nconst hidden = 1\n",
      );
      const explained = await run([process.execPath, "run", "lint", "--", "src/suppression.ts"]);
      expect(explained.code).toBe(0);
    },
    120_000,
  );
});
