#!/usr/bin/env node

import { runComponentHookShim } from "../../_shared/hook-marker.mjs";

process.exitCode = runComponentHookShim("start-work-continuation", process.argv.slice(2));
