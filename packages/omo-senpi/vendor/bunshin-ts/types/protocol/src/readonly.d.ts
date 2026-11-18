export type DeepReadonly<T> = T extends (...args: readonly unknown[]) => unknown ? T : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[] : T extends object ? {
    readonly [Key in keyof T]: DeepReadonly<T[Key]>;
} : T;
