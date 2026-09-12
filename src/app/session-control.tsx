'use client';

import { useEffect, useState } from 'react';

// Header control: who is signed in and a sign-out action. Fetches the
// public /api/auth/session on mount so pages stay static and the layout
// never reads request state. Renders nothing when auth is off.
export function SessionControl() {
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((data: { user: string | null }) => {
        if (alive) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!user) return null;
  return (
    <form method="post" action="/api/auth/logout" className="flex items-center gap-3">
      <span className="type-meta font-mono">{user}</span>
      <button
        type="submit"
        className="type-label text-dim transition-colors duration-[120ms] ease-out hover:text-text"
      >
        sign out
      </button>
    </form>
  );
}
