const built = await Bun.build({
  entrypoints: [new URL("./adapter.ts", import.meta.url).pathname],
  outdir: new URL(".", import.meta.url).pathname,
  target: "bun",
})
if (!built.success) throw new AggregateError(built.logs, "QA adapter build failed")
console.log("QA PluginModule bundled")
