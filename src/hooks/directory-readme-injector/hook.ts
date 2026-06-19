import type { PluginInput } from "@opencode-ai/plugin";

import { createDirectoryInjectorHook } from "../directory-injector";
import { processFilePathForReadmeInjection } from "./injector";
import { clearInjectedPaths } from "./storage";

export function createDirectoryReadmeInjectorHook(ctx: PluginInput) {
  return createDirectoryInjectorHook(ctx, processFilePathForReadmeInjection, clearInjectedPaths);
}
