#!/usr/bin/env node

import { ensureOmoHookTrust } from "./index.mjs";

try {
  const report = ensureOmoHookTrust();
  if (report.ok) {
    console.log(`omo-ai postinstall ok: trusted hooks for ${report.packageRoot}`);
  } else {
    console.log(`omo-ai postinstall completed with ${report.problems.length} problem(s). Run omo-ai doctor --json.`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`omo-ai postinstall skipped: ${message}`);
}
