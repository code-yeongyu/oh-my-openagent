import { runCodegraphSessionStartWorker } from "../../../packages/omo-codex/plugin/components/codegraph/src/hook.ts";
const result = await runCodegraphSessionStartWorker({
  config: { codegraph: { auto_provision: false, enabled: true }, sources: [], warnings: [] },
  cwd: process.env.QA_NORMAL_CWD,
  env: { ...process.env, HOME: process.env.QA_ISOLATED_HOME, OMO_CODEGRAPH_BIN: process.env.QA_FAKE_CODEGRAPH_BIN },
});
console.log(JSON.stringify(result, null, 2));
