export const Wildcard = {
	match(value: string, pattern: string): boolean {
		if (value === "" && pattern === "") {
			return true;
		}
		if (pattern === "") {
			return false;
		}
		if (value === "" && pattern === "*") {
			return true;
		}
		if (value === "") {
			for (let i = 0; i < pattern.length; i++) {
				if (pattern[i] !== "*") {
					return false;
				}
			}
			return true;
		}

		let valueIdx = 0;
		let patternIdx = 0;
		let starIdx = -1;
		let matchIdx = 0;

		while (valueIdx < value.length) {
			const patternChar = pattern[patternIdx];
			const valueChar = value[valueIdx];

			if (patternChar === "?") {
				valueIdx++;
				patternIdx++;
			} else if (patternChar === "*") {
				starIdx = patternIdx;
				matchIdx = valueIdx;
				patternIdx++;
			} else if (patternChar === valueChar) {
				valueIdx++;
				patternIdx++;
			} else if (starIdx >= 0) {
				patternIdx = starIdx + 1;
				matchIdx++;
				valueIdx = matchIdx;
			} else {
				return false;
			}
		}

		while (patternIdx < pattern.length && pattern[patternIdx] === "*") {
			patternIdx++;
		}

		return patternIdx === pattern.length;
	},
} as const;
