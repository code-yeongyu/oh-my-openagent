// Delegates to compiled postinstall (npm install) or exits silently (dev/CI)
import("./bin-dist/postinstall.js").catch(() => {})
