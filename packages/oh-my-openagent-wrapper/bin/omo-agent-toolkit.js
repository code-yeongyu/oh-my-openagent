#!/usr/bin/env node
// The launcher reads OMO_INVOCATION_NAME before argv[1], which names this file rather than the bin the user typed.
process.env.OMO_INVOCATION_NAME ??= "omo-agent-toolkit"
await import("oh-my-opencode/bin/oh-my-opencode.js")
