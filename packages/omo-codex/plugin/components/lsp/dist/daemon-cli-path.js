import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OMO_LSP_DAEMON_CLI, OMO_LSP_DAEMON_VERSION, resolveDaemonRuntime } from "@code-yeongyu/lsp-daemon/client";
const requireFromHere = createRequire(import.meta.url);
const PACKAGE_LSP_DAEMON_CLI = "@code-yeongyu/lsp-daemon/cli";
export function ensureLspDaemonCliEnv(env = process.env) {
    const runtime = resolveDaemonRuntime(env, resolveLspDaemonCli());
    env[OMO_LSP_DAEMON_CLI] = runtime.cliPath;
    env[OMO_LSP_DAEMON_VERSION] = runtime.version;
}
export function resolveLspDaemonCliPath(env = process.env) {
    const runtime = resolveDaemonRuntime(env, resolveLspDaemonCli());
    if (env[OMO_LSP_DAEMON_CLI] === undefined)
        env[OMO_LSP_DAEMON_CLI] = runtime.cliPath;
    if (env[OMO_LSP_DAEMON_VERSION] === undefined)
        env[OMO_LSP_DAEMON_VERSION] = runtime.version;
    return runtime.cliPath;
}
function resolveLspDaemonCli() {
    const packageCli = resolvePackageLspDaemonCliPath();
    if (packageCli !== null)
        return resolveConfiguredLspDaemonCli(packageCli);
    const bundledCli = fileURLToPath(new URL("../../lsp-daemon/dist/cli.js", import.meta.url));
    if (existsSync(bundledCli))
        return resolveConfiguredLspDaemonCli(bundledCli);
    return resolveConfiguredLspDaemonCli(bundledCli);
}
function resolvePackageLspDaemonCliPath() {
    try {
        return requireFromHere.resolve(PACKAGE_LSP_DAEMON_CLI);
    }
    catch (error) {
        if (!(error instanceof Error))
            throw error;
        return null;
    }
}
function resolveConfiguredLspDaemonCli(cliPath) {
    const version = readDaemonPackageVersion(cliPath);
    if (version === null) {
        throw new Error(`Unable to determine packaged LSP daemon version beside ${cliPath}`);
    }
    return {
        cliPath,
        version,
    };
}
function readDaemonPackageVersion(cliPath) {
    try {
        const parsed = JSON.parse(readFileSync(join(dirname(cliPath), "package.json"), "utf8"));
        if (isRecord(parsed) && typeof parsed["version"] === "string" && parsed["version"].length > 0) {
            return parsed["version"];
        }
    }
    catch (error) {
        if (!(error instanceof Error))
            throw error;
    }
    return null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
