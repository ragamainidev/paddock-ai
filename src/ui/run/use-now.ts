'use client';

import { useEffect, useState } from 'react';

// A 1s clock as state, so components that show elapsed time stay pure at
// render (react-hooks/purity): the current time enters through state, never
// through Date.now() in the render body. Returns null until mounted.
export function useNowTicker(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0); // async first tick keeps the effect pure
    const timer = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);
  return active ? now : null;
}
