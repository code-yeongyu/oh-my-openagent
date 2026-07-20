export class GoalAlreadyExistsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GoalAlreadyExistsError";
	}
}

export class GoalNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GoalNotFoundError";
	}
}

export class InvalidGoalStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidGoalStoreError";
	}
}

export class UnsupportedGoalStoreVersionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedGoalStoreVersionError";
	}
}
