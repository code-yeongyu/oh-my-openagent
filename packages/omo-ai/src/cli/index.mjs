#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doctorSenpiInstall } from "../doctor/index.mjs";
import { repairSenpiInstall, uninstallSenpiInstall } from "../install/index.mjs";
import { OMO_AI_PACKAGE_VERSION } from "../senpi-compat/package-root.mjs";

export function main(argv = process.argv.slice(2)) {
  const command = normalizeCommand(argv[0]);
  const json = argv.includes("--json");
  try {
    switch (command) {
      case "version":
        console.log(`omo-ai ${OMO_AI_PACKAGE_VERSION}`);
        return 0;
      case "doctor":
        return printReport(doctorSenpiInstall(), json);
      case "repair":
        return printReport(repairSenpiInstall(), json);
      case "uninstall":
        return printReport(uninstallSenpiInstall(), json);
      case "help":
        printHelp();
        return 0;
      default:
        console.error(`Unknown omo-ai command: ${command}`);
        printHelp();
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ ok: false, problems: [message] }, null, 2));
    } else {
      console.error(`omo-ai ${command} failed: ${message}`);
    }
    return 1;
  }
}

function normalizeCommand(command) {
  if (command === undefined || command === "--help" || command === "-h") {
    return "help";
  }
  if (command === "--version" || command === "-v") {
    return "version";
  }
  return command;
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`omo-ai ${report.action} ok: ${report.packageRoot}`);
  } else {
    console.log(`omo-ai ${report.action} found problems:`);
    for (const problem of report.problems) {
      console.log(`- ${problem}`);
    }
  }
  return report.ok ? 0 : 1;
}

function printHelp() {
  console.log("Usage: omo-ai <doctor|repair|uninstall|version> [--json]");
}

function isMainModule() {
  const invokedPath = process.argv[1];
  return invokedPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invokedPath);
}

if (isMainModule()) {
  process.exitCode = main();
}
