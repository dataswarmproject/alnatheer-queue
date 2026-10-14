import type { Counter } from './index';
import { normalizeDigits } from './speech';

export function counterNumber(counter: Counter): number | null {
  if (counter.number != null) return counter.number;
  const name = normalizeDigits(counter.name);
  const explicit = /(?:كاونتر|كوانتر|كونتر|counter|رقم)\s*(?:رقم\s*)?[-:#]?\s*(\d+)/i.exec(name);
  const numbers = name.match(/\d+/g);
  const number = Number(explicit?.[1] ?? (numbers?.length === 1 ? numbers[0] : NaN));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
