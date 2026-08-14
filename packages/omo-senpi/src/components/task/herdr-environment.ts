import { createHerdrCommandClient, type HerdrTaskClient } from "./herdr-command-client"

export function createHerdrCommandClientFromEnvironment(
  environment: NodeJS.ProcessEnv,
): { readonly workspaceId: string; readonly client: HerdrTaskClient } | undefined {
  const workspaceId = environment.HERDR_WORKSPACE_ID
  const testDisabled = environment.NODE_ENV === "test"
    && environment.OMO_HERDR_NATIVE_TASKS !== "1"
  if (
    environment.OMO_HERDR_NATIVE_TASKS === "0"
    || testDisabled
    || environment.HERDR_ENV !== "1"
    || workspaceId === undefined
    || workspaceId.length === 0
  ) return undefined
  return {
    workspaceId,
    client: createHerdrCommandClient({
      herdrBin: environment.HERDR_BIN_PATH ?? "herdr",
      platform: process.platform,
    }),
  }
}
