interface ImportMeta {
  readonly dir: string;
  readonly main: boolean;
}

declare const console: {
  log(...data: unknown[]): void;
};

declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
  };
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
}
