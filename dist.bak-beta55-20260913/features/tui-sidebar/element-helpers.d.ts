export type ViewNodeKind = "box" | "text";
export type ViewNode = {
    readonly kind: ViewNodeKind;
    readonly props: Readonly<Record<string, unknown>>;
    readonly text?: string;
    readonly children?: readonly ViewNode[];
};
export declare function box(props: Readonly<Record<string, unknown>>, children?: readonly ViewNode[]): ViewNode;
export declare function text(props: Readonly<Record<string, unknown>>, value: string): ViewNode;
