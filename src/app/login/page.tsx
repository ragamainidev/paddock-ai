import type { Metadata } from 'next';
import { safeNext } from '@/auth/authorize';
import { readAuthConfig } from '@/auth/config';

export const metadata: Metadata = { title: 'sign in' };

// The one gate page. Server-rendered; the form posts to /api/auth/login
// which sets the cookie and redirects to `next`. Errors arrive as ?error=.
export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : undefined);
  const error = typeof sp.error === 'string' ? sp.error : undefined;
  const mode = readAuthConfig(process.env).mode;

  const inputClass =
    'h-10 w-full min-w-0 rounded-[2px] border border-border bg-surface px-3 text-[13px] outline-none transition-colors duration-[120ms] ease-out focus:border-accent-dim';

  return (
    <div className="mx-auto mt-16 w-full max-w-[360px]">
      <h1 className="type-h1 mb-1">Sign in</h1>
      <p className="type-meta mb-6">private instance · credentials from the owner</p>

      {mode === 'off' && (
        <p className="type-body text-dim">
          Authentication is off in this environment; nothing to sign into.
        </p>
      )}

      {mode === 'on' && (
        <form method="post" action="/api/auth/login" className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <label className="flex flex-col gap-1">
            <span className="type-label">Username</span>
            <input
              name="user"
              type="text"
              autoComplete="username"
              autoFocus
              required
              maxLength={64}
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="type-label">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={`${inputClass} font-mono`}
            />
          </label>
          {error && (
            <p className="type-meta text-warn">
              {error === 'rate'
                ? 'too many attempts · wait 15 minutes'
                : 'invalid username or password'}
            </p>
          )}
          <button
            type="submit"
            className="h-12 w-full rounded-[2px] border border-accent-dim font-mono text-[14px] text-accent transition-colors duration-[120ms] ease-out hover:border-accent hover:bg-accent-wash"
          >
            sign in
          </button>
        </form>
      )}
    </div>
  );
}
