import type { PluginInput } from "@opencode-ai/plugin";

import { createDirectoryInjectorHook } from "../directory-injector";
import { processFilePathForAgentsInjection } from "./injector";
import { clearInjectedPaths } from "./storage";

export function createDirectoryAgentsInjectorHook(ctx: PluginInput) {
  return createDirectoryInjectorHook(ctx, processFilePathForAgentsInjection, clearInjectedPaths);
}
