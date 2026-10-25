import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "scripts", "check-migrations-applied.sh");
const check = async (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "omo-get-migrations-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    const p = Bun.spawn(["bash", SCRIPT, dir], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return { out, code };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("the committed ledger lists every committed migration", async () => {
  const p = Bun.spawn(["bash", SCRIPT, join(import.meta.dir, "..", "migrations")], { stdout: "pipe" });
  expect(await p.exited).toBe(0);
});

test("a migration missing from the ledger stops the deploy and names it", async () => {
  const r = await check({ "0001_a.sql": "", "0002_b.sql": "", "applied.txt": "# applied\n0001_a.sql\n" });
  expect(r.code).toBe(1);
  expect(r.out).toContain("0002_b.sql");
  expect(r.out).not.toContain("0001_a.sql");
});

test("a ledger line must match the whole file name", async () => {
  const r = await check({ "0001_a.sql": "", "applied.txt": "0001_a.sql.bak\n" });
  expect(r.code).toBe(1);
});

test("a missing ledger or a directory without migrations stops the deploy", async () => {
  expect((await check({ "0001_a.sql": "" })).code).toBe(1);
  expect((await check({ "applied.txt": "0001_a.sql\n" })).code).toBe(1);
  const p = Bun.spawn(["bash", SCRIPT, join(tmpdir(), "omo-get-no-such-dir")], { stdout: "pipe" });
  expect(await p.exited).toBe(1);
});
