export const MAX_OBJECTIVE_LENGTH = 4_000;
const GOAL_TOO_LONG_FILE_HINT =
	"Put longer instructions in a file and refer to that file in the goal, for example: /goal follow the instructions in docs/goal.md.";

export function validateObjective(value: string): string {
	const objective = value.trim();
	if (objective.length === 0) throw new Error("objective must not be empty");
	const objectiveCharacters = [...objective].length;
	if (objectiveCharacters > MAX_OBJECTIVE_LENGTH) {
		throw new Error(
			`Goal objective is too long: ${objectiveCharacters.toLocaleString()} characters. Limit: ${MAX_OBJECTIVE_LENGTH.toLocaleString()} characters. ${GOAL_TOO_LONG_FILE_HINT}`,
		);
	}
	return objective;
}
