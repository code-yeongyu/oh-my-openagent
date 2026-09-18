import type { KeyEvent } from "@opentui/core";
import type { KeyInputContext } from "@opentui/keymap";
export declare function createBtwEscapeReturn(args: {
    isCurrentSideIdle: () => boolean;
    isDialogOpen: () => boolean;
    clearPending: () => void;
    returnToParent: () => void;
    now?: () => number;
}): {
    handle: (context: KeyInputContext<KeyEvent>) => void;
    reset: () => void;
};
