const questionMarkers = [
  "?",
  "？",
  "幾多",
  "多少",
  "點解",
  "為什麼",
  "點樣",
  "怎樣",
  "即係",
  "咩",
  "嗎",
  "有冇",
  "有沒有",
  "狀況",
  "擔心",
  "稅",
  "why",
  "how much",
  "what",
  "worth"
];

export function looksLikeQuestion(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;

  return questionMarkers.some((word) => text.includes(word.toLowerCase()));
}
