// Simple embedding generation using term frequency hashing
// In production, this should be replaced with a real embedding model API

const COMMON_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "during", "before", "after", "above",
  "below", "between", "under", "again", "further", "then", "once", "and",
  "but", "if", "or", "because", "until", "while", "so", "than", "too",
  "very", "just", "now", "only", "also", "back", "after", "other", "many",
  "some", "time", "way", "years", "work", "good", "new", "first", "well",
  "even", "want", "here", "look", "down", "most", "long", "last", "find",
  "give", "does", "made", "part", "such", "take", "come", "these", "know",
  "see", "get", "through", "back", "much", "go", "good", "new", "write",
  "our", "me", "too", "any", "day", "same", "right", "look", "think",
  "also", "around", "another", "came", "come", "work", "three", "must",
  "because", "does", "part", "even", "place", "well", "such", "here",
  "take", "why", "things", "help", "put", "years", "different", "away",
  "again", "off", "went", "old", "number", "great", "tell", "men", "say",
  "small", "every", "found", "still", "between", "name", "should", "home",
  "big", "give", "air", "line", "set", "own", "under", "read", "last",
  "never", "us", "left", "end", "along", "while", "might", "next", "sound",
  "below", "saw", "something", "thought", "both", "few", "those", "always",
  "look", "show", "large", "often", "together", "asked", "house", "don't",
  "world", "going", "want", "school", "important", "until", "form", "food",
  "keep", "children", "feet", "land", "side", "without", "boy", "once",
  "animal", "life", "enough", "took", "four", "head", "above", "kind",
  "began", "almost", "live", "page", "got", "built", "grow", "cut",
  "earth", "father", "head", "stand", "own", "course", "stay", "wheel",
  "full", "force", "blue", "object", "decide", "surface", "deep", "moon",
  "island", "foot", "system", "busy", "test", "record", "boat", "common",
  "gold", "possible", "plane", "stead", "dry", "wonder", "laugh",
  "thousands", "ago", "ran", "check", "game", "shape", "equate", "hot",
  "miss", "brought", "heat", "snow", "tire", "bring", "yes", "distant",
  "fill", "east", "paint", "language", "among", "grand", "ball", "yet",
  "wave", "drop", "heart", "am", "present", "heavy", "dance", "engine",
  "position", "arm", "wide", "sail", "material", "size", "vary", "settle",
  "speak", "weight", "general", "ice", "matter", "circle", "pair",
  "include", "divide", "syllable", "felt", "perhaps", "pick", "sudden",
  "count", "square", "reason", "length", "represent", "art", "subject",
  "region", "energy", "hunt", "probable", "bed", "brother", "egg", "ride",
  "cell", "believe", "fraction", "forest", "sit", "race", "window",
  "store", "summer", "train", "sleep", "prove", "lone", "leg", "exercise",
  "wall", "catch", "mount", "wish", "sky", "board", "joy", "winter",
  "sat", "written", "wild", "instrument", "kept", "glass", "grass",
  "cow", "job", "edge", "sign", "visit", "past", "soft", "fun", "bright",
  "gas", "weather", "month", "million", "bear", "finish", "happy", "hope",
  "flower", "clothes", "strange", "gone", "jump", "baby", "eight",
  "village", "meet", "root", "buy", "raise", "solve", "metal", "whether",
  "push", "seven", "paragraph", "third", "shall", "held", "hair",
  "describe", "cook", "floor", "either", "result", "burn", "hill",
  "safe", "cat", "century", "consider", "type", "law", "bit", "coast",
  "copy", "phrase", "silent", "tall", "sand", "soil", "roll", "temperature",
  "finger", "industry", "value", "fight", "lie", "beat", "excite", "natural",
  "view", "sense", "ear", "else", "quite", "broke", "case", "middle",
  "kill", "son", "lake", "moment", "scale", "loud", "spring", "observe",
  "child", "straight", "consonant", "nation", "dictionary", "milk",
  "speed", "method", "organ", "pay", "age", "section", "dress", "cloud",
  "surprise", "quiet", "stone", "tiny", "climb", "cool", "design", "poor",
  "lot", "experiment", "bottom", "key", "iron", "single", "stick", "flat",
  "twenty", "skin", "smile", "crease", "hole", "trade", "melody", "trip",
  "office", "receive", "row", "mouth", "exact", "symbol", "die", "least",
  "trouble", "shout", "except", "wrote", "seed", "tone", "join", "suggest",
  "clean", "break", "lady", "yard", "rise", "bad", "blow", "oil", "blood",
  "touch", "grew", "cent", "mix", "team", "wire", "cost", "lost", "brown",
  "wear", "garden", "equal", "sent", "choose", "fell", "fit", "flow",
  "fair", "bank", "collect", "save", "control", "decimal", "gentle",
  "woman", "captain", "practice", "separate", "difficult", "doctor",
  "please", "protect", "noon", "whose", "locate", "ring", "character",
  "insect", "caught", "period", "indicate", "radio", "spoke", "atom",
  "human", "history", "effect", "electric", "expect", "crop", "modern",
  "element", "hit", "student", "corner", "party", "supply", "bone",
  "rail", "imagine", "provide", "agree", "thus", "capital", "won't",
  "chair", "danger", "fruit", "rich", "thick", "soldier", "process",
  "operate", "guess", "necessary", "sharp", "wing", "create", "neighbor",
  "wash", "bat", "rather", "crowd", "corn", "compare", "poem", "string",
  "bell", "depend", "meat", "rub", "tube", "famous", "dollar", "stream",
  "fear", "sight", "thin", "triangle", "planet", "hurry", "chief",
  "colony", "clock", "mine", "tie", "enter", "major", "fresh", "search",
  "send", "yellow", "gun", "allow", "print", "dead", "spot", "desert",
  "suit", "current", "lift", "rose", "continue", "block", "chart",
  "hat", "sell", "success", "company", "subtract", "event", "particular",
  "deal", "swim", "term", "opposite", "wife", "shoe", "shoulder", "spread",
  "arrange", "camp", "invent", "cotton", "born", "determine", "quart",
  "nine", "truck", "noise", "level", "chance", "gather", "shop",
  "stretch", "throw", "shine", "property", "column", "molecule", "select",
  "wrong", "gray", "repeat", "require", "broad", "prepare", "salt", "nose",
  "plural", "anger", "claim", "continent", "oxygen", "sugar", "death",
  "pretty", "skill", "women", "season", "solution", "magnet", "silver",
  "thank", "branch", "match", "suffix", "especially", "fig", "afraid",
  "huge", "sister", "steel", "discuss", "forward", "similar", "guide",
  "experience", "score", "apple", "bought", "led", "pitch", "coat",
  "mass", "card", "band", "rope", "slip", "win", "dream", "evening",
  "condition", "feed", "tool", "total", "basic", "smell", "valley",
  "nor", "double", "seat", "arrive", "master", "track", "parent", "shore",
  "division", "sheet", "substance", "favor", "connect", "post", "spend",
  "chord", "fat", "glad", "original", "share", "station", "dad", "bread",
  "charge", "proper", "bar", "offer", "segment", "slave", "duck",
  "instant", "market", "degree", "populate", "chick", "dear", "enemy",
  "reply", "drink", "occur", "support", "speech", "nature", "range",
  "steam", "motion", "path", "liquid", "log", "meant", "quotient",
  "teeth", "shell", "neck",
])

const EMBEDDING_DIM = 128

export function generateEmbedding(text: string): number[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !COMMON_WORDS.has(w))

  const embedding = new Array(EMBEDDING_DIM).fill(0)

  for (const word of words) {
    const hash = hashString(word)
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      embedding[i] += Math.sin(hash * (i + 1)) / words.length
    }
  }

  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0))
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      embedding[i] /= norm
    }
  }

  return embedding
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}
