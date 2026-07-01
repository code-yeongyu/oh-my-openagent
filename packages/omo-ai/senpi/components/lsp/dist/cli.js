#!/usr/bin/env node

import { runComponentHookShim } from "../../_shared/hook-marker.mjs";

process.exitCode = runComponentHookShim("lsp", process.argv.slice(2));
