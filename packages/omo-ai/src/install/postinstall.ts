import { getInstallMode } from "./index.ts";

if (import.meta.main) {
  console.log(`omo-ai postinstall ${getInstallMode()}`);
}
