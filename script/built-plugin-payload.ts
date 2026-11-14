// Plugin files only a build writes (#13192): staging copies what exists, so a binary staged from an unbuilt tree would
// embed a plugin without them and still compare equal to its own stage. The release build fails here instead.
export const BUILT_PLUGIN_PAYLOAD = ["plugin/extensions/omo.js", "plugin/scripts/install.mjs"] as const

export function assertBuiltPluginStaged(staged: ReadonlySet<string>): void {
  const missing = BUILT_PLUGIN_PAYLOAD.filter((relPath) => !staged.has(relPath))
  if (missing.length > 0) {
    throw new Error(
      `the plugin payload is not built: ${missing.join(", ")} missing from the stage; run \`bun script/build-generated.ts\` first`,
    )
  }
}
