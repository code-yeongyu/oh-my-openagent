export class InjectionCache {
	private readonly sessions = new Map<string, Set<string>>();

	private getOrCreate(sessionKey: string): Set<string> {
		let set = this.sessions.get(sessionKey);
		if (!set) {
			set = new Set<string>();
			this.sessions.set(sessionKey, set);
		}
		return set;
	}

	hasInjected(sessionKey: string, canonicalDir: string): boolean {
		return this.sessions.get(sessionKey)?.has(canonicalDir) ?? false;
	}

	markInjected(sessionKey: string, canonicalDir: string): void {
		this.getOrCreate(sessionKey).add(canonicalDir);
	}

	getCacheSize(sessionKey: string): number {
		return this.sessions.get(sessionKey)?.size ?? 0;
	}

	listInjected(sessionKey: string): string[] {
		const set = this.sessions.get(sessionKey);
		return set ? Array.from(set) : [];
	}

	clearSession(sessionKey: string): void {
		this.sessions.delete(sessionKey);
	}

	clearAll(): void {
		this.sessions.clear();
	}
}
