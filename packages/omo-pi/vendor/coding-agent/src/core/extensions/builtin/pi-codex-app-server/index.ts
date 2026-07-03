import type { ExtensionAPI } from "../../types.ts";
import { registerPiCodexAppServerExtension } from "./extension.ts";

export default function piCodexAppServerExtension(pi: ExtensionAPI): void {
	registerPiCodexAppServerExtension(pi);
}
