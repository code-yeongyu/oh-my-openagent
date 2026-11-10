import { onTestFinished } from "bun:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { createMobius } from "../skills/mobius-loop/scripts/mobius.d.mts";

type Event = Parameters<ReturnType<typeof createMobius>["record"]>[0]["event"];

const source = fileURLToPath(new URL("../", import.meta.url));

export async function installedArtifact() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mobius-artifact-")));
  const active = new Set<{ readonly close: () => Promise<void> }>();
  onTestFinished(async () => {
    await Promise.all([...active].map(child => child.close()));
    await rm(root, { recursive: true, force: true });
    assert.equal(await Bun.file(join(root, "consumer/package.json")).exists(), false);
  });
  assert(!root.startsWith(`${resolve(source)}${sep}`), "Consumer must be outside the checkout");
  const consumer = join(root, "consumer");
  const project = join(root, "project");
  await mkdir(consumer);
  await mkdir(project);
  const env = { ...process.env, TMPDIR: root, NODE_COMPILE_CACHE: join(root, "node-cache"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "bun-cache"), BUN_INSTALL_CACHE_DIR: join(root, "install-cache") };

  async function command(argv: string[], cwd = consumer) {
    const child = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    async function close() {
      if (child.exitCode === null) child.kill();
      await child.exited;
    }
    const resource = { close };
    active.add(resource);
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    } finally {
      await close();
      active.delete(resource);
    }
  }

  const tarball = join(root, "mobius.tgz");
  const packed = await command([process.execPath, "pm", "pack", "--ignore-scripts",
    "--filename", tarball], source);
  assert.equal(packed.code, 0, packed.stderr);
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "artifact-consumer", private: true, type: "module", dependencies: { "mobius-loop": tarball },
  }));
  const installed = await command([process.execPath, "install", "--ignore-scripts"]);
  assert.equal(installed.code, 0, installed.stderr);
  const packageRoot = join(consumer, "node_modules/mobius-loop");
  assert(!(await lstat(packageRoot)).isSymbolicLink(), "Tarball install must not be a workspace link");
  assert((await realpath(packageRoot)).startsWith(`${consumer}${sep}`));
  const moduleFile = join(packageRoot, "skills/mobius-loop/scripts/mobius.mjs");
  const moduleUrl = pathToFileURL(moduleFile).href;
  const candidate = process.env.NODE_BIN ?? Bun.which("node");
  assert(candidate, "Node is required; set NODE_BIN to Node 24");
  const node = candidate;
  const version = await command([node, "-p", "process.versions.node"]);
  assert.equal(version.code, 0, version.stderr);
  assert.equal(Number(version.stdout.trim().split(".")[0]), 24, "Exercise the installed engine under Node 24");

  async function invoke(method: string, input?: unknown, preload?: string) {
    const code = `const {createMobius}=await import(${JSON.stringify(moduleUrl)});
      const sdk=createMobius(${JSON.stringify({ cwd: project, slug: "artifact" })});
      console.log(JSON.stringify(await sdk[${JSON.stringify(method)}](${input === undefined ? "" : JSON.stringify(input)})));`;
    return command([node, ...(preload ? ["--import", preload] : []), "--input-type=module", "--eval", code]);
  }

  async function call(method: string, input?: unknown): Promise<unknown> {
    const output = await invoke(method, input);
    assert.equal(output.code, 0, output.stderr);
    assert.equal(output.stderr, "");
    const value: unknown = JSON.parse(output.stdout);
    return value;
  }

  let revision = 0;
  async function record(event: Event) {
    const output = await call("record", { expectedRevision: revision, event });
    revision += 1;
    return output;
  }
  return { root, packageRoot, project, tarball, moduleFile, moduleUrl, call, invoke, record,
    validate: () => command([process.execPath, fileURLToPath(new URL("../script/validate.ts", import.meta.url)), packageRoot]) };
}
