import { createHerdrExtension } from "../components/herdr/extension"

// The file name is the integration seam: senpi's builtin herdr reporter inspects
// ctx.loadedExtensionPaths and defers to any loaded `herdr-*` extension file that does not carry
// a `HERDR_INTEGRATION_ID=` marker, so this entry (bundled to `extensions/herdr-omo.js`) replaces
// the builtin reporter with the omo-branded one.
export default createHerdrExtension()
