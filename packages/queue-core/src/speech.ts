import { z } from 'zod';

const letters = [
  'إيه',
  'بي',
  'سي',
  'دي',
  'إي',
  'إف',
  'جي',
  'إتش',
  'آي',
  'جاي',
  'كي',
  'إل',
  'إم',
  'إن',
  'أو',
  'پي',
  'كيو',
  'آر',
  'إس',
  'تي',
  'يو',
  'في',
  'دبليو',
  'إكس',
  'واي',
  'زد',
];
const units = ['صفر', 'واحد', 'اثنين', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const tens = ['', '', 'عشرين', 'ثلاثين', 'أربعين', 'خمسين', 'ستين', 'سبعين', 'ثمانين', 'تسعين'];
const hundreds = [
  '',
  'مائة',
  'مائتين',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];
const scales = [
  { one: 'ألف', two: 'ألفين', plural: 'آلاف' },
  { one: 'مليون', two: 'مليونين', plural: 'ملايين' },
  { one: 'مليار', two: 'مليارين', plural: 'مليارات' },
];
export function normalizeDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, digit =>
    String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)),
  );
}
function small(n: number): string {
  if (n < 10) return units[n];
  if (n === 10) return 'عشرة';
  if (n === 11) return 'أحد عشر';
  if (n === 12) return 'اثني عشر';
  if (n < 20) return `${units[n - 10]} عشر`;
  if (n < 100) return n % 10 ? `${units[n % 10]} و${tens[Math.floor(n / 10)]}` : tens[n / 10];
  return hundreds[Math.floor(n / 100)] + (n % 100 ? ` و${small(n % 100)}` : '');
}
/** Masculine numeral after "رقم"; branch sequences are PostgreSQL positive integers. */
export function arabicNumber(value: string): string {
  const normalized = normalizeDigits(value);
  const n = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(n) || n > 2147483647)
    throw new Error('Unsupported queue number');
  if (!n) return units[0];
  const parts: string[] = [];
  let remaining = n;
  for (let i = 2; i >= 0; i--) {
    const divisor = 1000 ** (i + 1),
      group = Math.floor(remaining / divisor);
    remaining %= divisor;
    if (!group) continue;
    const scale = scales[i];
    parts.push(
      group === 1
        ? scale.one
        : group === 2
          ? scale.two
          : `${group === 200 ? 'مائتي' : small(group)} ${group >= 3 && group <= 10 ? scale.plural : scale.one}`,
    );
  }
  if (remaining) parts.push(small(remaining));
  return parts.join(' و');
}
export function announcementParts(call: { code: string; counterName: string }) {
  const code = normalizeDigits(call.code);
  const ticket = /^([A-Z]{1,3})[-\s]?(\d+)$/.exec(code);
  // Match the user's auditioned A23 take: a literal A with a distinct pause.
  // Other service prefixes retain their existing Arabic letter pronunciations.
  const spoken = ticket
    ? `${ticket[1] === 'A' ? 'A...' : [...ticket[1]].map(letter => letters[letter.charCodeAt(0) - 65]).join(' ') + '،'} ${arabicNumber(ticket[2])}`
    : /^\d+$/.test(code)
      ? arabicNumber(code)
      : code;
  const name = normalizeDigits(call.counterName);
  const explicit = /(?:كاونتر|كوانتر|كونتر|counter|رقم)\s*(?:رقم\s*)?[-:#]?\s*(\d+)/i.exec(name);
  const numbers = name.match(/\d+/g);
  const number = explicit?.[1] ?? (numbers?.length === 1 ? numbers[0] : null);
  let destination = `كاونتر ${name}`;
  if (number && Number(number) <= 2147483647) destination = `الكاونتر رقم ${arabicNumber(number)}`;
  return [`على صاحب التذكرة رقم ${spoken}،`, `التوجّه إلى ${destination}.`] as const;
}
export function announcementText(call: { code: string; counterName: string }) {
  return announcementParts(call).join(' ');
}
/** One shared, fixed sample for the TV, host endpoint and offline audio preparation. */
export const speechTestText = `هذا اختبار للصوت. ${announcementText({ code: 'A-023', counterName: 'كاونتر 3' })}`;
export const speechRequestSchema = z.union([
  z.object({ sequence: z.number().int().positive() }).strict(),
  z.object({ test: z.literal(true) }).strict(),
]);
export const speechStatusSchema = z
  .object({ configured: z.boolean(), cachedOnly: z.boolean() })
  .strict();
const audioFields = { audio: z.string().max(2800000), mime: z.literal('audio/mpeg') };
export const speechAudioSchema = z.union([
  z.object({ text: z.string().max(600), ...audioFields, cached: z.boolean() }).strict(),
  z
    .object({
      text: z.string().max(600),
      segments: z.array(z.object(audioFields).strict()).length(2),
      cached: z.literal(true),
    })
    .strict(),
]);
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export type SpeechAudio = z.infer<typeof speechAudioSchema>;
