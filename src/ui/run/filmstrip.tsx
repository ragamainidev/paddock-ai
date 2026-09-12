'use client';

/* eslint-disable @next/next/no-img-element -- inspection photos come from
   arbitrary listing hosts and data: URLs; next/image can optimize neither. */

import { useEffect } from 'react';

// DESIGN.md photo filmstrip: the photos are the primary artifact. Indexed
// tiles, active-finding tiles get the accent border, click opens the one
// popover in the system. Uploads on revisited runs are placeholders — the
// bytes were never stored (SPEC 29) and the tile says so.

export type FilmstripPhoto = { src: string } | { placeholder: true };

export function Filmstrip({
  photos,
  active,
  onOpen,
  onRemove,
  columns = 'grid-cols-3 sm:grid-cols-4',
}: {
  photos: FilmstripPhoto[];
  active: number[];
  onOpen: (i: number) => void;
  onRemove?: (i: number) => void;
  columns?: string;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {photos.map((photo, i) => (
        <div key={i} className="relative">
          {'src' in photo ? (
            <button
              onClick={() => onOpen(i)}
              aria-label={`open photo ${i}`}
              className={`block aspect-square w-full overflow-hidden rounded-[2px] border transition-colors duration-[120ms] ease-out ${
                active.includes(i) ? 'border-accent' : 'border-border hover:border-border-strong'
              }`}
            >
              <img
                src={photo.src}
                alt={`photo ${i}`}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ) : (
            <div
              className={`flex aspect-square w-full items-center justify-center rounded-[2px] border ${
                active.includes(i) ? 'border-accent' : 'border-border'
              }`}
            >
              <span className="type-meta px-2 text-center">upload · not stored</span>
            </div>
          )}
          <span className="type-meta absolute left-1 top-1 rounded-[2px] bg-bg px-1 font-mono">
            {i}
          </span>
          {onRemove && (
            <button
              onClick={() => onRemove(i)}
              aria-label={`remove photo ${i}`}
              className="type-meta absolute right-1 top-1 rounded-[2px] bg-bg px-1 font-mono text-danger"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function Lightbox({
  src,
  index,
  onClose,
}: {
  src: string;
  index: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <button
      onClick={onClose}
      aria-label="close photo"
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-bg/80 p-6"
    >
      <img
        src={src}
        alt={`photo ${index}`}
        className="max-h-[85vh] max-w-full rounded-[2px] border border-border-strong shadow-popover"
      />
    </button>
  );
}
