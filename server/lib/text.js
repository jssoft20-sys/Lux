const STOPWORDS = new Set([
  "и", "а", "но", "в", "во", "на", "с", "со", "за", "по", "из", "от", "до", "для",
  "как", "что", "чтобы", "это", "этот", "эта", "эти", "там", "тут", "где", "когда",
  "он", "она", "оно", "они", "его", "её", "их", "ему", "ей", "им", "я", "ты", "мы", "вы",
  "был", "была", "было", "были", "быть", "есть", "не", "ни", "же", "ли", "бы", "или",
  "очень", "фильм", "фильме", "кино", "кадр", "момент", "сцена", "помню", "который",
  "которая", "которое", "которые", "потом", "затем", "там", "какой", "какая", "такой",
  "the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "is", "was", "were",
  "movie", "film", "scene", "about", "with", "that", "this", "there", "where", "when",
  "remember", "guy", "man", "woman",
]);

export function tokenize(value) {
  if (!value) return [];
  return String(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token && token.length > 2 && !STOPWORDS.has(token));
}

/** Грубый «стеммер»: обрезает окончания, чтобы «корабля» и «корабль» совпали. */
export function stem(token) {
  return token.length > 5 ? token.slice(0, 5) : token;
}

export function stemAll(value) {
  return tokenize(value).map(stem);
}
