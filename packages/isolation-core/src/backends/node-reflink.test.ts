import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { fixture } from "../test-fixture"

test("Node-hosted caller without bun:ffi reaches the cp reflink tier", async () => {
  const f = await fixture(), module = join(f.root, "reflink.mjs"), merged = join(f.root, "merged")
  await writeFile(join(f.repoRoot, "content"), "source")
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "reflink.ts")], target: "node", external: ["bun:ffi"] })
  expect(built.success).toBe(true)
  await writeFile(module, await built.outputs[0]!.text())
  const script = `
    import { ReflinkBackend } from ${JSON.stringify(pathToFileURL(module).href)};
    import { cp } from 'node:fs/promises';
    const calls = [];
    const io = { platform: 'linux', which: () => true, device: async () => 1,
      run: async (argv) => { calls.push(argv); await cp(argv[3], argv[4], { recursive: true }); return { code: 0, stdout: '', stderr: '' }; } };
    const backend = new ReflinkBackend(io);
    const lower = ${JSON.stringify(f.repoRoot)}, merged = ${JSON.stringify(merged)};
    if (!(await backend.probe(lower, { id: 'node', baseDir: ${JSON.stringify(f.root)}, crossDevice: false })).available) throw new Error('probe unavailable');
    await backend.start(lower, merged, { id: 'node', baseDir: ${JSON.stringify(f.root)}, crossDevice: false });
    console.log(JSON.stringify(calls.at(-1)));
    await backend.stop(merged);
  `
  const { stdout } = await promisify(execFile)("node", ["--input-type=module", "-e", script], { timeout: 10000 })
  expect(JSON.parse(stdout.trim())).toEqual(["cp", "-a", "--reflink=always", f.repoRoot, merged])
})
