export type RuleScanCache = {
  get: (key: string) => string[] | undefined;
  set: (key: string, value: string[]) => void;
  clear: () => void;
};

export function createRuleScanCache(): RuleScanCache {
  const cache = new Map<string, string[]>();

  return {
    get(key: string): string[] | undefined {
      return cache.get(key);
    },
    set(key: string, value: string[]): void {
      cache.set(key, value);
    },
    clear(): void {
      cache.clear();
    },
  };
}
