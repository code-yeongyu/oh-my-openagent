import { expect, test } from "bun:test"
import { insertAfterProlog } from "./probe-placement"

const P = "<script>probe</script>"

test.each([
	["a head", "<!doctype html><html><head><title>t</title></head>", `<!doctype html><html><head>${P}<title>t</title></head>`],
	["no head", "<!doctype html><html lang=en><body><p>x</p>", `<!doctype html><html lang=en>${P}<body><p>x</p>`],
	["only a doctype", "<!DOCTYPE html><header>h</header>", `<!DOCTYPE html>${P}<header>h</header>`],
	["no prolog", "<header>h</header><p>x</p>", `${P}<header>h</header><p>x</p>`],
	["a <head> inside a leading comment", "<!-- <head> --><!doctype html><p>x</p>", `<!-- <head> --><!doctype html>${P}<p>x</p>`],
	["a <head> inside a later script string", "<!doctype html><body><script>var s = \"<head>\"</script>", `<!doctype html>${P}<body><script>var s = \"<head>\"</script>`],
	["a > inside a quoted attribute", '<!doctype html><html><head data-x="a>b"><title>t</title>', `<!doctype html><html><head data-x="a>b">${P}<title>t</title>`],
	["a <header> where the head would be", "<html><header>h</header>", `<html>${P}<header>h</header>`],
	["a leading XML declaration", '<?xml version="1.0"?>\n<!DOCTYPE html><html><head>', `<?xml version="1.0"?>\n<!DOCTYPE html><html><head>${P}`],
	["comments and whitespace between prolog tags", "<!doctype html>\n<!-- c -->\n<html>\n<head>", `<!doctype html>\n<!-- c -->\n<html>\n<head>${P}`],
])("#given %s #then the probe lands right after the prolog", (_name, html, expected) => {
	expect(insertAfterProlog(html, P)).toBe(expected)
})
