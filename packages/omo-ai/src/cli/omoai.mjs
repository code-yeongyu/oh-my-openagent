#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../senpi-compat/package-root.mjs";

const DEFAULT_WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export function createSenpiLaunchRequest(argv = process.argv.slice(2), platform = process.platform, env = process.env) {
  const packageRoot = findPackageRoot(import.meta.url);
  const baseArgs = ["-e", packageRoot, ...argv];
  if (platform === "win32") {
    const resolvedSenpi = resolveWindowsPathCommand("senpi", env) ?? "senpi";
    if (isWindowsCommandShim(resolvedSenpi)) {
      const innerCommandLine = [resolvedSenpi, ...baseArgs].map(quoteWindowsCommandArg).join(" ");
      return {
        command: env.ComSpec || env.COMSPEC || "cmd.exe",
        args: ["/d", "/s", "/c", `"${innerCommandLine}"`],
        options: {
          env,
          shell: false,
          stdio: "inherit",
          windowsHide: true,
          windowsVerbatimArguments: true,
        },
      };
    }
    return {
      command: resolvedSenpi,
      args: baseArgs,
      options: {
        env,
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    };
  }
  return {
    command: "senpi",
    args: baseArgs,
    options: {
      env,
      shell: false,
      stdio: "inherit",
    },
  };
}

export function main(argv = process.argv.slice(2)) {
  const launch = createSenpiLaunchRequest(argv);
  const result = spawnSync(launch.command, launch.args, launch.options);
  if (result.error) {
    console.error(`omoai failed to launch senpi: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`omoai senpi exited from signal ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

function isMainModule() {
  const invokedPath = process.argv[1];
  return invokedPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invokedPath);
}

if (isMainModule()) {
  process.exitCode = main();
}

function resolveWindowsPathCommand(command, env) {
  const pathValue = env.PATH || env.Path || env.path || "";
  const pathDirs = pathValue.split(";").filter(Boolean);
  const pathExts = (env.PATHEXT || DEFAULT_WINDOWS_PATHEXT)
    .split(";")
    .filter(Boolean)
    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
  for (const dir of pathDirs) {
    for (const ext of pathExts) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function isWindowsCommandShim(command) {
  const lower = command.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

function quoteWindowsCommandArg(value) {
  if (value.length === 0) return "\"\"";
  if (!/[\s"&<>|^%]/.test(value)) return value;
  const escaped = value.replace(/"/g, "\"\"").replace(/%/g, "\"^%\"");
  return `"${escaped}"`;
}
