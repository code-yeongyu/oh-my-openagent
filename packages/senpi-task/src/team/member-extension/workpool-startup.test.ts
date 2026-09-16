import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

// Use a fresh module registry: the test preload and neighboring host tests already load workpool.
// The mock records module evaluation, not registration, so an eager import cannot hide behind
// registerProcessWorkpoolWorker's early return for an ordinary team member.
test("#given an ordinary process member #when its shared extension loads #then workpool initialization stays behind the launch identity gate", async () => {
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
    let errorCode;
    try { await register({}); } catch (error) { errorCode = error.code; }
    console.log(JSON.stringify({ evaluations, errorCode }));
  `], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", timeout: 10000 })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
  expect(JSON.parse(stdout)).toEqual({ evaluations: 0, errorCode: "missing_env" })
}, 15000)
