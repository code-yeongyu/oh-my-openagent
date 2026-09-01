export interface DepersonalizationViolation {
	label: string;
	file: string;
	line: number;
	text: string;
}

export function runDepersonalizationGate(
	scanDirs?: string[],
	baseDir?: string,
): Promise<DepersonalizationViolation[]>;
