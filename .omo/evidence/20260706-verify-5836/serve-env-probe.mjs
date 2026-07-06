import { Readable, Writable } from "node:stream";
import { runCodegraphServe } from "../../../packages/omo-codex/plugin/components/codegraph/src/serve.ts";
const captured = [];
await runCodegraphServe({
  cwd: process.env.QA_NORMAL_CWD,
  env: { ...process.env, HOME: process.env.QA_ISOLATED_HOME, OMO_CODEGRAPH_BIN: process.env.QA_FAKE_CODEGRAPH_BIN },
  homeDir: process.env.QA_ISOLATED_HOME,
  config: { codegraph: { enabled: true }, sources: [], warnings: [] },
  stdin: Readable.from([]),
  stdout: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
  stderr: { write: () => {} },
  resolve: () => ({ argsPrefix: [], command: process.env.QA_FAKE_CODEGRAPH_BIN, exists: true, source: "env" }),
  runProcess: async (command, args, options) => {
    captured.push({ args, command, cwd: options.cwd, env: {
      CODEGRAPH_INSTALL_DIR: options.env.CODEGRAPH_INSTALL_DIR,
      CODEGRAPH_NO_DAEMON: options.env.CODEGRAPH_NO_DAEMON,
      CODEGRAPH_NO_DOWNLOAD: options.env.CODEGRAPH_NO_DOWNLOAD,
      CODEGRAPH_TELEMETRY: options.env.CODEGRAPH_TELEMETRY,
      DO_NOT_TRACK: options.env.DO_NOT_TRACK,
      HOME: options.env.HOME,
    } });
    return 0;
  },
});
console.log(JSON.stringify(captured, null, 2));
