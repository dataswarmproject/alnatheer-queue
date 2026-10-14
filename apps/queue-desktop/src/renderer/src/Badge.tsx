import type { ReactNode } from 'react';
// Geist Badge presentation; interactive uses wrap it in a button with dialog semantics.
export function Badge({
  variant = 'gray',
  children,
}: {
  variant?: 'gray' | 'blue' | 'green' | 'amber' | 'red';
  children: ReactNode;
}) {
  return <span className={`geist-badge geist-badge-${variant}`}>{children}</span>;
}
