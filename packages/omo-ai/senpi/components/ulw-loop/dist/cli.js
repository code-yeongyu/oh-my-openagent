#!/usr/bin/env node

import { runComponentHookShim } from "../../_shared/hook-marker.mjs";

process.exitCode = runComponentHookShim("ulw-loop", process.argv.slice(2));
