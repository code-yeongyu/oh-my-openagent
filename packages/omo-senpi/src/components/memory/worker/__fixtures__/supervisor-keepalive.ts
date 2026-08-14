// Register the unrelated ref'ed handle before importing the top-level supervisor entrypoint.
setInterval(() => {}, 60_000)
await import("../memory-run-supervisor")

export {}
