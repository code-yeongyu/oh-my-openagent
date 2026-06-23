let impitModule: unknown = null

export async function getImpit(): Promise<unknown> {
  if (impitModule) return impitModule
  try {
    const moduleName = "impit"
    impitModule = await import(moduleName)
    return impitModule
  } catch {
    throw new Error(
      "impit is not installed. Run: bun add impit"
    )
  }
}

export function isImpitAvailable(): boolean {
  return impitModule !== null
}
