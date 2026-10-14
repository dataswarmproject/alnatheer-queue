export function saudiDates(value: Date | number = new Date()) {
  return {
    gregorian: new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
      timeZone: 'Asia/Riyadh',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value),
    hijri: new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      timeZone: 'Asia/Riyadh',
      dateStyle: 'medium',
    }).format(value),
  };
}
