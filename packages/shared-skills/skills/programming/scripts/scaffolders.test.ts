import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

  test("#when the go templates were checked out with CRLF #then every generated file is LF", async () => {
    // A CRLF checkout (git autocrlf) must not leak into the scaffolded project: its own .editorconfig says end_of_line = lf.
    const scriptsCopy = join(runRoot, "crlf-scripts");
    for (const dir of ["go", "shared"]) cpSync(join(import.meta.dir, dir), join(scriptsCopy, dir), { recursive: true });
    const templatesDir = join(scriptsCopy, "go", "templates");
    for (const file of readdirSync(templatesDir)) {
      const path = join(templatesDir, file);
      writeFileSync(path, readFileSync(path, "utf8").replace(/\r?\n/g, "\r\n"));
    }
    const project = join(runRoot, "crlf-svc");

    const child = Bun.spawn([process.execPath, join(scriptsCopy, "go", "new-project.ts"), "crlf-svc", "--path", runRoot, "--module", "example.com/acme/crlf", "--purpose", "billing"], {
      cwd: runRoot,
      env: { ...process.env, PATH: emptyBin },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);

    expect(code, stderr).toBe(0);
    const generated = readdirSync(project, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(generated.length).toBe(11);
    const withCr = generated.filter((file) => readFileSync(file, "utf8").includes("\r"));
    expect(withCr).toEqual([]);
    expect(readFileSync(join(project, "README.md"), "utf8").split("\n")[0]).toBe("# crlf-svc");
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
