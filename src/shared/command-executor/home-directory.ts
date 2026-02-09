import { homedir } from "node:os"

export function getHomeDirectory(): string {
	return process.env.HOME || process.env.USERPROFILE || homedir()
}
