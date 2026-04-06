import { isOckBeadFirstProject } from "./ock-bead-first-project";

export interface TaskSystemConfig {
	experimental?: {
		task_system?: boolean;
	};
}

export function isTaskSystemEnabled(config: TaskSystemConfig): boolean {
	return config.experimental?.task_system ?? false;
}

export function isTaskSystemEnabledForDirectory(
	config: TaskSystemConfig,
	directory?: string,
): boolean {
	return (
		isTaskSystemEnabled(config) &&
		(!directory || !isOckBeadFirstProject(directory))
	);
}
