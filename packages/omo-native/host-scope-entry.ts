// Imported first by the compiled entry so the scope hop runs before any engine module is evaluated: the engine's
// startup beacon consumes its hand-off variable and releases its filler descriptors at load, and an exec after that
// would hand the scoped supervisor a launch the ensure can no longer hear from.
import { enterOwnHostScope } from "./host-scope"

enterOwnHostScope(process.argv.slice(2))
