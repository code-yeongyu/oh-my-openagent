import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

// Use a fresh module registry: the test preload and neighboring host tests already load workpool.
// The mock records module evaluation, not registration, so an eager import cannot hide behind
// registerProcessWorkpoolWorker's early return for an ordinary team member.
// SPEC CHANGE (shared daemon): the member bundle is loaded for EVERY session of the daemon, so a
// session with no member identity registers nothing and returns - it no longer throws `missing_env`.
test("#given a session with no member identity #when its shared extension loads #then it registers nothing, throws nothing, and never evaluates the workpool graph", async () => {
  const worker = fileURLToPath(new URL("../../workpool/process-worker.ts", import.meta.url))
  const entry = new URL("./index.ts", import.meta.url).href
  const child = Bun.spawn([process.execPath, "--eval", `
    import { mock } from "bun:test";
    let evaluations = 0;
    mock.module(${JSON.stringify(worker)}, () => {
      evaluations += 1;
      return { registerProcessWorkpoolWorker: () => false };
    });
    const { default: register } = await import(${JSON.stringify(entry)});
    delete process.env.OMO_WORKPOOL_STATE_DIR;
    delete process.env.OMO_WORKPOOL_TASK_ID;
    delete process.env.SENPI_TASK_MEMBER;
    let errorCode = null;
    try { await register({}); } catch (error) { errorCode = error.code; }
    console.log(JSON.stringify({ evaluations, errorCode }));
  `], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", timeout: 10000 })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
  expect(JSON.parse(stdout)).toEqual({ evaluations: 0, errorCode: null })
}, 15000)
