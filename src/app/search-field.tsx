'use client';

import Form from 'next/form';
import { useEffect, useRef, useState } from 'react';

// Real queries from evals/queries.jsonl — every one of these resolves.
const PLACEHOLDERS = [
  'e46 m3',
  '996 turbo',
  '992 gt3 touring',
  '2jz',
  'c7',
  'miata na',
  'f80 m3',
  '996 no turbo',
];

const CYCLE_MS = 4000;
const FADE_MS = 150;

export function SearchField({ initialQuery }: { initialQuery: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialQuery);
  const [phIndex, setPhIndex] = useState(0);
  const [phHidden, setPhHidden] = useState(false);

  // `/` refocuses from anywhere, unless the user is already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Placeholder cycles through real enthusiast queries every 4s, fading at
  // 150ms. Under prefers-reduced-motion the CSS fade is disabled and the
  // text simply swaps.
  useEffect(() => {
    let swap: ReturnType<typeof setTimeout> | undefined;
    const cycle = setInterval(() => {
      setPhHidden(true);
      swap = setTimeout(() => {
        setPhIndex((i) => (i + 1) % PLACEHOLDERS.length);
        setPhHidden(false);
      }, FADE_MS);
    }, CYCLE_MS);
    return () => {
      clearInterval(cycle);
      if (swap) clearTimeout(swap);
    };
  }, []);

  return (
    <Form action="/search">
      <input
        ref={inputRef}
        type="text"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setValue('');
        }}
        placeholder={PLACEHOLDERS[phIndex]}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Search vehicles"
        className={`h-14 w-full rounded-[4px] border border-border bg-surface px-4 font-mono text-[14px] text-text outline-none transition-[border-color] duration-[120ms] ease-out focus:border-accent-dim focus:shadow-[inset_0_0_0_1px_var(--accent-wash)] ${
          phHidden ? 'ph-hidden' : ''
        }`}
      />
    </Form>
  );
}
