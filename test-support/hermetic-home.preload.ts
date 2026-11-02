// For a package whose runner does not load the root test-setup.ts: its tests still discover skills,
// agents and config through the user's home, so they get the same per-process temp home (#10632).
import { installHermeticHome } from "../test-hermetic-home"

installHermeticHome()
