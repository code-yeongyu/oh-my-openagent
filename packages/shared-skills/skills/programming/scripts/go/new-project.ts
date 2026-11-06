#!/usr/bin/env bun
/**
 * Scaffold a new Go project with the canonical strict layout: go.mod (go 1.23),
 * .golangci.yml (v2 strict bundle), Taskfile.yml, cmd/server/main.go,
 * internal/{cmd,config,api,domain,obs} skeletons, and .github/workflows/ci.yml.
 *
 * ─── How to run ───
 * 1. Install Bun: curl -fsSL https://bun.sh/install | bash
 * 2. Run:
 *      bun run new-project.ts myservice
 *      bun run new-project.ts myservice --module github.com/your-org/myservice
 * ──────────────────
 *
 * Templates live in ./templates/. `.tmpl` files take Python string.Template
 * placeholders ($name, ${name}, $$ for a literal $); every other file is copied verbatim.
 * Exit codes: 0 created, 1 scaffold failure, 2 usage error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { assertNever, runTool } from "../shared/run-tool.ts";

const USAGE = `Usage: bun run new-project.ts <name> [--path <dir>] [--module <path>] [--purpose <text>]

Arguments:
  name          Project directory and default module name

Options:
  --path        Parent dir (default: current dir)
  --module      Go module path (default: <name>)
  --purpose     Short purpose for AGENTS.md (default: HTTP)
  -h, --help    Show this help`;

const TEMPLATES_DIR = join(import.meta.dir, "templates");

const LAYOUT = [
  "cmd/server",
  "internal/cmd",
  "internal/config",
  "internal/api",
  "internal/domain",
  "internal/obs",
  ".github/workflows",
] as const;

const FILES = [
  { template: ".golangci.yml", output: ".golangci.yml", substitute: false },
  { template: "Taskfile.yml", output: "Taskfile.yml", substitute: false },
  { template: ".editorconfig", output: ".editorconfig", substitute: false },
  { template: "gitignore", output: ".gitignore", substitute: false },
  { template: "ci.yml", output: ".github/workflows/ci.yml", substitute: false },
  { template: "run.go", output: "internal/cmd/run.go", substitute: false },
  { template: "config.go", output: "internal/config/config.go", substitute: false },
  { template: "main.go.tmpl", output: "cmd/server/main.go", substitute: true },
  { template: "AGENTS.md.tmpl", output: "AGENTS.md", substitute: true },
  { template: "README.md.tmpl", output: "README.md", substitute: true },
] as const;

// Python string.Template grammar: $$ escape, $identifier, ${identifier}, or a bare $ (invalid).
const PLACEHOLDER = /\$(?:(\$)|([_a-z][_a-z0-9]*)|\{([_a-z][_a-z0-9]*)\}|())/gi;

type ProjectOptions = {
  readonly name: string;
  readonly path: string;
  readonly module: string;
  readonly purpose: string;
};

type Cli =
  | { readonly kind: "run"; readonly options: ProjectOptions }
  | { readonly kind: "help" }
  | { readonly kind: "usage"; readonly problem: string };

class ScaffoldError extends Error {
  constructor(
    readonly kind: "exists" | "template",
    message: string,
  ) {
    super(message);
    this.name = "ScaffoldError";
  }
}

function parseCli(): Cli {
  try {
    const { values, positionals } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        path: { type: "string", default: "." },
        module: { type: "string", default: "" },
        purpose: { type: "string", default: "HTTP" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) return { kind: "help" };
    const [name, ...extra] = positionals;
    if (name === undefined || extra.length > 0) return { kind: "usage", problem: "expected exactly one project name" };
    const options = { name, path: values.path, module: values.module || name, purpose: values.purpose };
    return { kind: "run", options };
  } catch (error) {
    if (error instanceof TypeError) return { kind: "usage", problem: error.message };
    throw error;
  }
}

function substitute(template: string, file: string, values: ReadonlyMap<string, string>): string {
  return template.replace(
    PLACEHOLDER,
    (match: string, escaped: string | undefined, named: string | undefined, braced: string | undefined) => {
      if (escaped !== undefined) return "$";
      const key = named ?? braced;
      if (key === undefined) throw new ScaffoldError("template", `${file}: invalid placeholder near "${match}"`);
      const value = values.get(key);
      if (value === undefined) throw new ScaffoldError("template", `${file}: unknown placeholder $${key}`);
      return value;
    },
  );
}

function initGoModule(projectDir: string, module: string): void {
  const init = runTool("go", ["mod", "init", module], projectDir);
  switch (init.kind) {
    case "ok":
      console.error(`  ran go mod init ${module}`);
      return;
    case "unavailable":
    case "failed": {
      const detail = init.kind === "unavailable" ? init.reason : `exit ${init.status}: ${init.stderr.trim()}`;
      console.error(`  warn go mod init failed (${detail}); writing fallback go.mod`);
      writeFileSync(join(projectDir, "go.mod"), `module ${module}\n\ngo 1.23\n`);
      return;
    }
    default:
      return assertNever(init);
  }
}

function writeFiles(projectDir: string, { name, module, purpose }: ProjectOptions): void {
  const values = new Map([
    ["name", name],
    ["module", module],
    ["short_purpose", purpose],
  ]);
  for (const { template, output, substitute: render } of FILES) {
    // The generated project is LF (its .editorconfig says end_of_line = lf); a CRLF checkout of the templates must not leak in.
    const raw = readFileSync(join(TEMPLATES_DIR, template), "utf8").replace(/\r\n/g, "\n");
    const outPath = join(projectDir, output);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, render ? substitute(raw, template, values) : raw);
    console.error(`  wrote ${output}`);
  }
}

function scaffold(options: ProjectOptions): void {
  const projectDir = join(options.path, options.name);
  if (existsSync(projectDir)) throw new ScaffoldError("exists", `✗ ${projectDir} already exists`);

  mkdirSync(projectDir, { recursive: true });
  for (const dir of LAYOUT) mkdirSync(join(projectDir, dir), { recursive: true });
  initGoModule(projectDir, options.module);
  writeFiles(projectDir, options);

  console.error(`\nDone! cd ${projectDir}`);
  console.error("  go get github.com/caarlos0/env/v11");
  console.error("  task        # fmt + lint + test");
}

function main(): number {
  const cli = parseCli();
  switch (cli.kind) {
    case "help":
      console.log(USAGE);
      return 0;
    case "usage":
      console.error(`Error: ${cli.problem}\n\n${USAGE}`);
      return 2;
    case "run":
      break;
    default:
      return assertNever(cli);
  }
  try {
    scaffold(cli.options);
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exit(main());
