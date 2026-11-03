#!/usr/bin/env bun
/**
 * Scaffold a new Python project with ultra-strict config from pyproject-strict.md.
 *
 * ─── How to run ───
 * 1. Install Bun: curl -fsSL https://bun.sh/install | bash
 * 2. Install uv:  curl -LsSf https://astral.sh/uv/install.sh | sh
 * 3. Run:
 *      bun run new-project.ts myproject
 *      bun run new-project.ts myproject --path ./workspace
 *      bun run new-project.ts myproject --lib   # library (publishable)
 * ──────────────────
 *
 * Creates via `uv init`, then injects basedpyright + ruff ALL + pytest config.
 * Exit codes: 0 created, 1 scaffold or uv failure, 2 usage error.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { assertNever, runTool } from "../shared/run-tool.ts";

const USAGE = `Usage: bun run new-project.ts <name> [--path <dir>] [--lib]

Arguments:
  name          Project name

Options:
  -p, --path    Parent directory (default: current dir)
  --lib         Create as publishable library (uv init --lib)
  -h, --help    Show this help`;

const TOOL_CONFIG = `
[dependency-groups]
dev = [
    "basedpyright>=1.21",
    "ruff>=0.8",
    "pytest>=8",
    "pytest-cov>=5",
]

[tool.basedpyright]
typeCheckingMode = "all"
pythonVersion = "3.13"
reportMissingTypeStubs = false
reportUnknownMemberType = false
reportUnknownArgumentType = false
reportUnknownVariableType = false
reportUnknownLambdaType = false
reportUnknownParameterType = false
reportMissingParameterType = false
reportUnnecessaryIsInstance = false
reportUnusedCallResult = false
reportImplicitOverride = false

[tool.ruff]
target-version = "py313"
line-length = 120

[tool.ruff.lint]
select = ["ALL"]
ignore = [
    "COM812",   # trailing comma (conflicts with formatter)
    "ISC001",   # single-line string concat (conflicts with formatter)
    "D1",       # undocumented-public-* (too noisy early on)
    "ANN101",   # deprecated: self annotation
    "ANN102",   # deprecated: cls annotation
    "S101",     # assert used (pytest needs it)
    "PLR2004",  # magic-value-comparison (test data)
    "FBT",      # boolean-trap (too strict for CLIs)
    "TD",       # flake8-todos (noisy)
    "FIX",      # fixme (noisy)
]

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = ["S101", "PLR2004", "SLF001", "D", "ARG", "ANN"]

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers --strict-config"
`;

const GITIGNORE = `__pycache__/
*.py[cod]
*.so
.venv/
dist/
*.egg-info/
.coverage
htmlcov/
.basedpyright/
.ruff_cache/
`;

type ProjectOptions = { readonly name: string; readonly path: string; readonly lib: boolean };

type Cli =
  | { readonly kind: "run"; readonly options: ProjectOptions }
  | { readonly kind: "help" }
  | { readonly kind: "usage"; readonly problem: string };

class ScaffoldError extends Error {
  constructor(
    readonly kind: "exists" | "uv-unavailable" | "uv-init-failed",
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
        path: { type: "string", short: "p", default: "." },
        lib: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) return { kind: "help" };
    const [name, ...extra] = positionals;
    if (name === undefined || extra.length > 0) return { kind: "usage", problem: "expected exactly one project name" };
    return { kind: "run", options: { name, path: values.path, lib: values.lib } };
  } catch (error) {
    if (error instanceof TypeError) return { kind: "usage", problem: error.message };
    throw error;
  }
}

function withoutDependencyGroups(pyproject: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of pyproject.split(/(?<=\n)/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[dependency-groups]")) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith("[")) skipping = false;
    if (!skipping) kept.push(line);
  }
  return `${kept.join("").replace(/\n+$/, "")}\n`;
}

function initProject(projectDir: string, lib: boolean): void {
  const init = runTool("uv", ["init", lib ? "--lib" : "--app", projectDir]);
  switch (init.kind) {
    case "ok":
      return;
    case "unavailable":
      throw new ScaffoldError(
        "uv-unavailable",
        `uv could not be started (${init.reason}); install it: curl -LsSf https://astral.sh/uv/install.sh | sh`,
      );
    case "failed":
      throw new ScaffoldError("uv-init-failed", `uv init failed: ${init.stderr}`);
    default:
      return assertNever(init);
  }
}

function addDevTools(projectDir: string): void {
  const added = runTool("uv", ["add", "--dev", "basedpyright", "ruff", "pytest", "pytest-cov"], projectDir);
  switch (added.kind) {
    case "ok":
      return;
    case "unavailable":
      console.error(`warn: uv add --dev could not start (${added.reason}); run it once uv is reachable`);
      return;
    case "failed":
      console.error(`warn: uv add --dev failed; pyproject.toml still lists the dev tools:\n${added.stderr}`);
      return;
    default:
      return assertNever(added);
  }
}

function scaffold({ name, path, lib }: ProjectOptions): void {
  const projectDir = join(path, name);
  if (existsSync(projectDir)) throw new ScaffoldError("exists", `${projectDir} already exists`);
  initProject(projectDir, lib);

  const pyprojectPath = join(projectDir, "pyproject.toml");
  writeFileSync(pyprojectPath, withoutDependencyGroups(readFileSync(pyprojectPath, "utf8")) + TOOL_CONFIG);
  addDevTools(projectDir);

  mkdirSync(join(projectDir, "tests"), { recursive: true });
  appendFileSync(join(projectDir, "tests", "__init__.py"), "");
  writeFileSync(join(projectDir, ".gitignore"), GITIGNORE);

  const srcDir = join(projectDir, "src", name.replaceAll("-", "_"));
  if (lib && existsSync(srcDir)) appendFileSync(join(srcDir, "py.typed"), "");

  console.log(`✓ Created: ${projectDir}`);
  console.log(`  cd ${name} && uv sync && uv run basedpyright . && uv run ruff check .`);
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
      console.error(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

process.exit(main());
