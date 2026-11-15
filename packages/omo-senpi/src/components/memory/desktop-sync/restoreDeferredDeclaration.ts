// Side-effect module, imported only by inheritedPrivateChannel.ts right before senpi's capture module, so the
// restore and the capture run in one synchronous module evaluation (launchClassification.ts, #12057).
import { restoreDeferredPrivateFdDeclaration } from "./launchClassification"

restoreDeferredPrivateFdDeclaration()
