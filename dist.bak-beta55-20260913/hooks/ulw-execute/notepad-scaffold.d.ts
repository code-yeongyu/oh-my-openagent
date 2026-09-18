export declare const NOTEPAD_FILES: readonly ["learnings.md", "decisions.md", "issues.md", "problems.md"];
export type NotepadFileName = (typeof NOTEPAD_FILES)[number];
export declare function ensureNotepadScaffold(params: {
    readonly directory: string;
    readonly planName: string;
    readonly timestamp?: string;
}): {
    created: string[];
    skipped: string[];
};
