import { join } from "node:path";

import { type DaemonPaths, daemonPaths, OMO_LSP_DAEMON_DIR } from "../src/paths.js";

export function daemonTestPaths(baseDir: string, version: string = "test"): DaemonPaths {
	return daemonPaths({ [OMO_LSP_DAEMON_DIR]: baseDir }, { cliPath: join(baseDir, "packaged-cli.js"), version });
}
