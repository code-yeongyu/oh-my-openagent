#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, getPackageDir, VERSION } from "./config.js";
import { handleBootstrapSelfUpdate } from "./self-update-bootstrap.js";
process.title = APP_NAME;
process.env.PI_CODING_AGENT = "true";
process.emitWarning = (() => { });
const args = process.argv.slice(2);
const PACKAGE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);
function isRootCommand(args) {
    const firstArg = args[0];
    return firstArg === undefined || !PACKAGE_COMMANDS.has(firstArg);
}
function isPackageManagerInstall(packageDir) {
    return packageDir.replace(/\\/g, "/").includes("/node_modules/@code-yeongyu/senpi");
}
function isMissingBundledWorkspaceDependencies(packageDir) {
    if (!isPackageManagerInstall(packageDir)) {
        return false;
    }
    const bundledPackages = ["pi-agent-core", "pi-ai", "pi-tui"];
    return bundledPackages.some((name) => {
        return !existsSync(join(packageDir, "node_modules", "@earendil-works", name, "dist", "index.js"));
    });
}
async function runFullCli() {
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const fullCliPath = fileURLToPath(new URL(`./cli-main${extension}`, import.meta.url));
    return await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, fullCliPath, ...args], {
            env: process.env,
            stdio: "inherit",
        });
        child.on("error", (error) => {
            reject(error);
        });
        child.on("close", (code, signal) => {
            if (signal) {
                process.kill(process.pid, signal);
                resolve(1);
                return;
            }
            resolve(code ?? 1);
        });
    });
}
if (isRootCommand(args) && (args.includes("--version") || args.includes("-v"))) {
    console.log(VERSION);
    process.exit();
}
if (isMissingBundledWorkspaceDependencies(getPackageDir())) {
    if (await handleBootstrapSelfUpdate(args)) {
        process.exit();
    }
}
process.exitCode = await runFullCli();
//# sourceMappingURL=cli.js.map