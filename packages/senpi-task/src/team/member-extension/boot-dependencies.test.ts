import { expect, test } from "bun:test"

// Boot dependency isolation requires a real new module registry, just like each RPC child.
// Nothing is mocked: the child imports the actual entry and reports the modules it evaluated.
test("#given a cold member extension #when its module loads #then host utilities, schema builders and the workpool graph are not on RPC readiness", async () => {
  const entry = new URL("./index.ts", import.meta.url).href
  const child = Bun.spawn([process.execPath, "--eval", `
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const member = await import(${JSON.stringify(entry)});
    const modules = Object.keys(require.cache).map(path => path.replaceAll("\\\\", "/"));
    const hostUtilities = modules.filter(path => path.endsWith("/utils/src/index.ts"));
    const schemaBuilders = modules.filter(path => path.endsWith("/typebox/build/index.mjs"));
    const workpoolGraph = modules.filter(path => path.includes("/senpi-task/src/workpool/"));
    let errorCode;
    try { member.parseMemberExtensionEnv({}); } catch (error) { errorCode = error.code; }
    console.log(JSON.stringify({ hostUtilities, schemaBuilders, workpoolGraph, errorCode }));
  `], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe", timeout: 10000 })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
  expect(JSON.parse(stdout)).toEqual({ hostUtilities: [], schemaBuilders: [], workpoolGraph: [], errorCode: "missing_env" })
}, 15000)
