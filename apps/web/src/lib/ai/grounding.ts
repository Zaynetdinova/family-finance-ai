/** Digit sequences of 3+ digits, spaces/nbsp inside numbers removed ("120 000" → "120000"). */
function numbers(text: string): string[] {
  const norm = text.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, '$1');
  return norm.match(/\d[\d.,]*\d|\d/g)?.map((n) => n.replace(/[.,]$/, '')) ?? [];
}

/**
 * True when every significant number in the AI text also appears in the facts.
 * Small numbers (< 3 digits: list markers, "2 рекомендации", percentages like 12) are allowed
 * only if they appear in the facts too, except 1–3 which are commonly used as counters.
 */
export function numbersGrounded(aiText: string, facts: string): boolean {
  const allowed = new Set(numbers(facts).flatMap((n) => [n, n.replace(',', '.'), n.replace('.', ',')]));
  for (const n of numbers(aiText)) {
    if (/^[0-3]$/.test(n)) continue;
    if (!allowed.has(n)) return false;
  }
  return true;
}
