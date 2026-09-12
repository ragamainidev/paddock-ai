# auth

Username/password auth for the hosted app: enough to share it with one
other party safely, small enough to read in a sitting. App-level (Next.js
proxy), no third-party service, no user database — users live in an env
var as scrypt hashes.

## 1. Model

| Piece       | Where                                              | Runtime               |
| ----------- | -------------------------------------------------- | --------------------- |
| Gate        | `src/proxy.ts` → `src/auth/authorize.ts`           | Node (proxy)          |
| Config      | `src/auth/config.ts` (`readAuthConfig`)            | anywhere (pure)       |
| Sessions    | `src/auth/session.ts` (HMAC, WebCrypto)            | proxy + routes        |
| Credentials | `src/auth/credentials.ts` (scrypt)                 | Node routes + scripts |
| Rate limit  | `src/auth/rate-limit.ts`                           | login route           |
| Login UI    | `src/app/login/page.tsx`                           | server component      |
| Routes      | `src/app/api/auth/{login,logout,session}/route.ts` | Node                  |
| Header      | `src/app/session-control.tsx`                      | client                |

Invariants: SPEC 40 (gated, fail closed), 41 (hashing, signing, no
leaks), 42 (generic, slow, rate-limited failures; no open redirect).

## 2. Enforcement modes

`readAuthConfig(process.env)`:

| Mode            | When                                                                    | Effect                                                 |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `on`            | `AUTH_SECRET` (≥ 32 chars) and `AUTH_USERS` (≥ 1 valid `user:hash`) set | Every non-public request needs a valid session         |
| `off`           | Neither set and `VERCEL_ENV` unset                                      | Open (local dev)                                       |
| `misconfigured` | Anything else, including "neither set" on Vercel                        | Every request → 503 text with the reason (fail closed) |

Public paths (no session needed): `/login`, `/api/auth/*`, `/_next/*`,
`/favicon.ico`, `/icon.svg`, `/robots.txt`. `isPublicPath` and the proxy
`matcher` must agree; both are tested/listed in one place each.

## 3. Sessions

Token: `v1.<user-b64url>.<exp-unix>.<hmac-b64url>`, HMAC-SHA256 keyed by
`AUTH_SECRET`, verified with `crypto.subtle.verify` (constant time).
Cookie `paddock_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure`
when `NODE_ENV=production`, `Max-Age = AUTH_SESSION_DAYS × 86400`
(default 30 days). No server-side session store: the cookie is the
session, expiry is inside the signature, and rotating the secret signs
everyone out.

## 4. Credentials

`AUTH_USERS="alice:scrypt$16384$8$1$<salt>$<key>,bob:scrypt$…"` —
comma- or newline-separated. Hashes come from `pnpm auth:hash <user>
[password]` (scrypt N=16384 r=8 p=1, 16-byte salt, 32-byte key,
base64url). Verification uses `timingSafeEqual`; malformed hashes never
throw, they just fail. Usernames are exact-match, ≤ 64 chars, no `:` or
`,`.

## 5. Login flow

1. `GET /login?next=<path>` renders the form (server component). When
   auth is `off` it says so instead.
2. `POST /api/auth/login` (form or JSON) → rate limit (10 failures / 15 min
   per IP and per username, in-memory per instance) → find user → verify →
   on success sign session, set cookie, 303 to `safeNext(next)` (form) or
   200 JSON; on failure wait 300 ms, log
   `auth login failed user=<u> ip=<ip> reason=<…>`, 303 to
   `/login?error=bad|rate` (form) or 401/429 JSON.
3. `POST /api/auth/logout` clears the cookie and 303s to `/login`.
4. `GET /api/auth/session` → `{mode, user|null}` for the header control
   (public; `cache-control: no-store`).

`safeNext` accepts only paths starting with a single `/`, without `\`,
and never `/login` itself.

The IP key is `x-vercel-forwarded-for` and nothing else. Vercel overwrites
that header at its edge, so it is the one address a caller cannot choose;
`x-forwarded-for` is caller-supplied (Next fills it from the socket only
when the request arrives without one), and keying on it let anyone reset
their own counter per attempt. This Next version exposes no connection
address to a route handler, so off Vercel every attempt shares the
`unknown` bucket — stricter, not looser, and the per-username limiter is
unaffected. Both maps sweep expired windows on each hit and are capped at
`MAX_KEYS` with oldest-first eviction, so an instance keyed on caller
strings cannot grow without bound.

## 6. Runbooks

### 6.1 First setup on Vercel

```sh
pnpm auth:secret                                   # → AUTH_SECRET value
pnpm auth:hash raghav                              # prints password once + user:hash line
pnpm auth:hash guest                               # same, for the other party
vercel env add AUTH_SECRET production              # paste; mark Sensitive
vercel env add AUTH_USERS production               # paste "raghav:…,guest:…"
vercel redeploy <deployment-url>                   # env changes need a new deployment
```

### 6.2 Add or rotate a user

Generate a new line with `pnpm auth:hash <user>`, replace that user's
entry in `AUTH_USERS` (`vercel env rm AUTH_USERS production` then
`vercel env add …`), redeploy. Removing a user's line removes access on
the next request after redeploy (sessions are checked against the secret,
not the user list, so also rotate `AUTH_SECRET` to cut an existing session
immediately).

### 6.3 Sign everyone out

Rotate `AUTH_SECRET` (`pnpm auth:secret`), redeploy.

### 6.4 Locked out

Everything 503 → `vercel env ls`; a missing or short value is the cause;
re-add and redeploy. Login rejects → regenerate the hash line; check the
username has no stray whitespace.

### 6.5 Local testing with auth on

```sh
AUTH_SECRET=$(pnpm --silent auth:secret) AUTH_USERS=$(pnpm --silent auth:hash me pw 2>/dev/null) pnpm dev
```

## 7. Threat model and limits

- Protects against: anonymous access to the app and its paid model
  routes; credential guessing (scrypt + delay + rate limit); session
  forgery (HMAC); cookie theft over plain HTTP (Secure); CSRF on login
  (SameSite=Lax + POST); open redirect on `next`.
- Does not protect against: a compromised Vercel account or env; a leaked
  `AUTH_SECRET` (rotate); rate-limit evasion across many serverless
  instances (the fixed delay and scrypt cost still apply per attempt);
  a shared password being shared further (issue per-party users); a
  deployment behind some other proxy, which would need its own trusted
  header named in `clientIp` before the IP limiter means anything there.
- Sessions cannot be revoked individually without rotating the secret;
  acceptable for a two-user instance. If that changes, add a `sid` to the
  token and a denylist in Postgres, and document it here.
