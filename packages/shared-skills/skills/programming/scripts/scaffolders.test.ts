import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runRoot = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), "programming-scaffolders-"));
const emptyBin = join(runRoot, "empty-bin");
mkdirSync(emptyBin);

afterAll(() => rmSync(runRoot, { recursive: true, force: true }));

async function scaffold(script: string, args: readonly string[]) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, script), ...args], {
    cwd: runRoot,
    env: { ...process.env, PATH: emptyBin },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { stderr, code };
}

function pep723Metadata(source: string): unknown {
  const block = /^# \/\/\/ script\n((?:#.*\n)*?)# \/\/\/$/m.exec(source)?.[1] ?? "";
  return Bun.TOML.parse(block.replace(/^# ?/gm, ""));
}

describe("#given the Bun scaffolders run offline", () => {
  test("#when new-script gets --deps and --py #then it writes an executable PEP 723 script declaring them", async () => {
    const dest = join(runRoot, "scripts", "tool.py");

    const result = await scaffold("python/new-script.ts", ["tool", "--output", dest, "-d", "polars", "--deps", "duckdb", "--py", "3.12"]);

    expect(result.code).toBe(0);
    expect(pep723Metadata(readFileSync(dest, "utf8"))).toEqual({ "requires-python": ">=3.12", dependencies: ["polars", "duckdb"] });
    expect(statSync(dest).mode & 0o111).toBe(process.platform === "win32" ? 0 : 0o111);
  });

  test("#when go is not on PATH #then go new-project writes the fallback go.mod and substitutes the templates", async () => {
    const project = join(runRoot, "svc");

    const result = await scaffold("go/new-project.ts", ["svc", "--path", runRoot, "--module", "example.com/acme/svc", "--purpose", "billing"]);

    expect(result.code).toBe(0);
    expect(readFileSync(join(project, "go.mod"), "utf8")).toBe("module example.com/acme/svc\n\ngo 1.23\n");
    expect(readFileSync(join(project, "cmd", "server", "main.go"), "utf8")).toContain('"example.com/acme/svc/internal/cmd"');
    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain(" billing ");
    expect(agents).not.toMatch(/\$\{?[_a-z]/i);
    expect(readFileSync(join(project, "README.md"), "utf8").split("\n")[0]).toBe("# svc");
  });

  test("#when cargo is not on PATH #then rust new-project exits 1 naming cargo", async () => {
    const result = await scaffold("rust/new-project.ts", ["rsapp", "--path", runRoot]);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/\bcargo\b/);
  });

  test("#when uv is not on PATH #then python new-project exits 1 naming uv and creates nothing", async () => {
    const result = await scaffold("python/new-project.ts", ["pyapp", "--path", runRoot]);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/\buv\b/);
    expect(existsSync(join(runRoot, "pyapp"))).toBe(false);
  });
});
