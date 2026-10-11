// Registers the statically bundled OAuth flows and Bedrock/Cursor/Devin provider modules before
// senpi's CLI graph loads: Bun's compiled filesystem cannot resolve their opaque dynamic loaders.
// senpi's `./bun-runtime` export binds them to the pi-ai graph senpi itself resolves, bundled inside
// senpi or installed beside it. compile-entry calls this right before the CLI import, never at
// module scope: evaluating the provider graph costs every launch CPU time, and the answers omo gives
// itself (--version, update, doctor, setup, the RPC supervisor route) never reach pi-ai. The
// specifier stays an inline literal because bun's bundler only traces literal import() arguments.
export async function registerEngineRuntimeModules(): Promise<void> {
  const { registerBunRuntimeModules } = await import("@code-yeongyu/senpi/bun-runtime")
  registerBunRuntimeModules()
}
