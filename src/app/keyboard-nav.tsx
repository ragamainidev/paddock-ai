'use client';

import { useEffect } from 'react';

// Arrow keys walk every element marked data-nav (vehicle cards, listing
// rows) in DOM order; enter opens the focused link natively. ArrowUp from
// the first result returns focus to the search field.
export function KeyboardNav() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const t = e.target;
      if (t instanceof HTMLTextAreaElement) return;
      if (t instanceof HTMLInputElement && e.key === 'ArrowUp') return;

      const items = Array.from(document.querySelectorAll<HTMLElement>('[data-nav]'));
      if (items.length === 0) return;

      const current = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowUp' && current === 0) {
        document.querySelector<HTMLElement>('input[name="q"]')?.focus();
        e.preventDefault();
        return;
      }
      const next =
        current === -1
          ? e.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : e.key === 'ArrowDown'
            ? Math.min(current + 1, items.length - 1)
            : current - 1;
      items[next].focus();
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
