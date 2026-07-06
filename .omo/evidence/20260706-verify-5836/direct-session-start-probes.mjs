import { Readable } from "node:stream";
import { executeCodegraphSessionStartHook } from "../../../packages/omo-codex/plugin/components/codegraph/src/hook.ts";
const result = await executeCodegraphSessionStartHook({
  config: { codegraph: { enabled: true }, sources: [], warnings: [] },
  cwd: process.env.QA_TARGET_CWD,
  env: { ...process.env, HOME: process.env.QA_ISOLATED_HOME },
  stdin: Readable.from(["{}"]),
  stdout: { write: () => { throw new Error("excluded hook must not write SessionStart output"); } },
  spawnWorker: () => { throw new Error("excluded hook must not spawn worker"); },
  statusProbe: () => { throw new Error("excluded hook must not probe status"); },
});
console.log(JSON.stringify(result, null, 2));
