// How a reader might take a word that is written to look like another: compatibility forms folded (NFKC),
// invisible and combining marks removed (zero-width, joiners, bidi controls, U+034F), common Cyrillic and Greek
// letters that look Latin mapped to it, and case folded. Hygiene only (#10498, lead decision C): memory text
// never carries authority, so this catches look-alikes for tidiness and notices, and is not a security boundary.
const CONFUSABLES: Readonly<Record<string, string>> = {
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x",
  "\u0456": "i", "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u051b": "q", "\u051d": "w", "\u04cf": "l",
  "\u0410": "a", "\u0415": "e", "\u041e": "o", "\u0420": "p", "\u0421": "c", "\u0425": "x", "\u0406": "i",
  "\u0408": "j", "\u0405": "s", "\u041a": "k", "\u041c": "m", "\u041d": "h", "\u0422": "t", "\u0412": "b",
  "\u03b1": "a", "\u03b5": "e", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03bd": "v",
  "\u03ba": "k", "\u03b9": "i", "\u039f": "o", "\u0391": "a", "\u0392": "b", "\u0395": "e", "\u0397": "h",
  "\u0399": "i", "\u039a": "k", "\u039c": "m", "\u039d": "n", "\u03a1": "p", "\u03a4": "t", "\u03a5": "y", "\u03a7": "x",
  "\u0131": "i", "\u0130": "i",
}

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Mn}]/gu
const CONFUSABLE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu")

export function lookAlikeSkeleton(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "").replace(CONFUSABLE, (letter) => CONFUSABLES[letter] ?? letter).toLowerCase()
}
