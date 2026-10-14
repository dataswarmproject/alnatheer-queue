import { describe, expect, it } from 'vitest';
import { announcementText, arabicNumber, speechTestText } from '@saraf/queue-core/speech';

describe('Arabic queue announcement wording', () => {
  it('reads the ticket number and configured counter number without padding', () => {
    expect(announcementText({ code: 'A-023', counterName: 'كاونتر ٣' })).toBe(
      'على صاحب التذكرة رقم A... ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.',
    );
  });
  it('recognizes Arabic, Persian and English counter numerals', () => {
    for (const counterName of ['الكوانتر رقم ٣', 'Counter 03', 'كاونتر ۳']) {
      expect(announcementText({ code: 'B-00023', counterName })).toContain('الكاونتر رقم ثلاثة.');
    }
  });
  it('preserves the service prefix when numbers can repeat across services', () => {
    expect(announcementText({ code: 'B-023', counterName: 'كاونتر 3' })).toBe(
      'على صاحب التذكرة رقم بي، ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.',
    );
  });
  it('uses a named counter rather than inventing a number or a floor number', () => {
    expect(announcementText({ code: 'A-023', counterName: 'خدمة الأولوية' })).toBe(
      'على صاحب التذكرة رقم A... ثلاثة وعشرين، التوجّه إلى كاونتر خدمة الأولوية.',
    );
    expect(announcementText({ code: 'A-023', counterName: 'الدور 2 كاونتر 3' })).toContain(
      'الكاونتر رقم ثلاثة.',
    );
  });
  it('uses the approved wording for numeric tickets and the same 23-to-3 audio test everywhere', () => {
    expect(announcementText({ code: '٠٢٣', counterName: 'الكاونتر رقم ٣' })).toBe(
      'على صاحب التذكرة رقم ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.',
    );
    expect(speechTestText).toBe(
      'هذا اختبار للصوت. على صاحب التذكرة رقم A... ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.',
    );
  });
  it.each([
    ['000', 'صفر'],
    ['2', 'اثنين'],
    ['11', 'أحد عشر'],
    ['12', 'اثني عشر'],
    ['23', 'ثلاثة وعشرين'],
    ['36', 'ستة وثلاثين'],
    ['100', 'مائة'],
    ['200', 'مائتين'],
    ['101', 'مائة وواحد'],
    ['999', 'تسعمائة وتسعة وتسعين'],
    ['1000', 'ألف'],
    ['2000', 'ألفين'],
    ['23000', 'ثلاثة وعشرين ألف'],
    ['200000', 'مائتي ألف'],
    [
      '2147483647',
      'مليارين ومائة وسبعة وأربعين مليون وأربعمائة وثلاثة وثمانين ألف وستمائة وسبعة وأربعين',
    ],
  ])('speaks number %s as words', (input, expected) => {
    expect(arabicNumber(input)).toBe(expected);
  });
  it('does not accept unsafe or negative numbers', () => {
    expect(() => arabicNumber('-1')).toThrow();
    expect(() => arabicNumber('9007199254740992')).toThrow();
  });
});
