import { useEffect, useState } from 'react';
import { saudiDates } from '@saraf/queue-core/dates';
export function SaudiDate() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const dates = saudiDates(now);
  return (
    <time className="saudi-date" dateTime={new Date(now).toISOString()}>
      <span data-calendar="gregorian">{dates.gregorian}</span>
      <small data-calendar="hijri">{dates.hijri}</small>
    </time>
  );
}
