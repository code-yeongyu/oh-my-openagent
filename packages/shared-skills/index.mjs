import { fileURLToPath } from "node:url";

export function sharedSkillsRootPath() {
	return fileURLToPath(new URL("./skills/", import.meta.url));
}
