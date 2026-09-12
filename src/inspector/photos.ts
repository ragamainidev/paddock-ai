import { lookup } from 'node:dns/promises';
import type { PhotoSource } from './types';

/**
 * Photo pre-flight. Listing photos rot: CDNs expire signed URLs, auction
 * pages come down, hosts block hotlinking. A dead URL otherwise surfaces as
 * a mid-run vision failure; probing first turns it into a named, visible
 * decision ("photo 3 unreachable, skipped") before any model money is spent.
 *
 * The probe is also the one place a caller-supplied URL is dereferenced by
 * the server, so it is the server-side request forgery boundary: https only,
 * every resolved address must be public, and redirects are followed by hand
 * so each hop is screened again. A host that resolves to the metadata
 * endpoint or a service on the private network is unreachable by definition.
 *
 * Anchoring invariant: every photo index in the final report refers to the
 * ORIGINAL input order — the filmstrip the user sees. The vision model only
 * receives the reachable subset, so its indices are remapped back through
 * the selection before they touch a report.
 */

const PROBE_TIMEOUT_MS = 5_000;
// A photo host that needs more hops than this is not serving an image.
const MAX_REDIRECTS = 3;

export type PhotoProbe = (url: string) => Promise<boolean>;

// Hostname → every address it resolves to. Injected so the screen is
// testable without DNS.
export type AddressResolver = (hostname: string) => Promise<string[]>;

export const defaultAddressResolver: AddressResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((r) => r.address);
};

// -- Address screen ------------------------------------------------------------

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// IPv4-mapped IPv6 is the same address wearing a different notation, in
// either spelling (`::ffff:169.254.169.254`, `::ffff:a9fe:a9fe`); screen it
// as the v4 address it carries.
const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

function unwrapMapped(address: string): string {
  if (!/^::ffff:/i.test(address)) return address;
  const tail = address.slice(address.lastIndexOf(':') + 1);
  if (V4.test(tail)) return tail;
  const hex = MAPPED_HEX.exec(address);
  if (!hex) return address;
  const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// Everything the public internet does not route to a stranger: loopback,
// link-local (169.254/16 and fe80::/10, which carry the cloud metadata
// endpoint), private ranges (10/8, 172.16/12, 192.168/16, fc00::/7),
// carrier-grade NAT (100.64/10, the shared space a hosted runtime's
// neighbours sit in), the benchmarking range (198.18/15, routed inside some
// networks), and the unspecified address.
export function isPublicAddress(raw: string): boolean {
  const address = unwrapMapped(raw.trim().toLowerCase());
  const v4 = V4.exec(address);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b] = octets;
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (!address.includes(':')) return false; // neither a v4 nor a v6 literal
  const v6 = address.replace(/%.*$/, ''); // drop a zone index
  if (v6 === '::' || v6 === '::1') return false;
  if (/^fe[89ab]/.test(v6)) return false; // fe80::/10
  if (/^f[cd]/.test(v6)) return false; // fc00::/7
  return true;
}

// A URL the server is willing to dereference: https, and no resolved
// address inside the network the server itself sits on. One private answer
// among many rejects the host — a rebinding record is still a private one.
// The connection resolves the name a second time, which a TTL-0 record can
// win; pinning the screened address would need a custom dispatcher, and the
// probe reads at most one byte either way.
async function screen(url: string, resolve: AddressResolver): Promise<URL | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:') return null;
  let addresses: string[];
  try {
    addresses = await resolve(target.hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return null;
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) return null;
  return target;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Redirects are followed here, not by fetch, so every hop is screened.
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
    await res.body?.cancel().catch(() => undefined);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// One screened request, following redirects by hand. Null means the URL was
// refused (not https, private address, too many hops), which reads the same
// as unreachable to the caller.
async function screenedRequest(
  url: string,
  init: RequestInit,
  resolve: AddressResolver,
): Promise<Response | null> {
  let next = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await screen(next, resolve);
    if (!target) return null;
    const res = await request(target.href, init);
    if (!REDIRECT_STATUS.has(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    try {
      next = new URL(location, target).href;
    } catch {
      return null;
    }
  }
  return null;
}

// HEAD first (cheap), then a 1-byte range GET for hosts that reject HEAD.
export function createPhotoProbe(resolve: AddressResolver = defaultAddressResolver): PhotoProbe {
  return async (url) => {
    try {
      const head = await screenedRequest(url, { method: 'HEAD' }, resolve);
      if (head === null) return false; // refused, not flaky: no second attempt
      if (head.ok) return true;
      if (head.status === 404 || head.status === 410) return false;
    } catch {
      // fall through to the range GET — some CDNs drop HEAD entirely
    }
    try {
      const get = await screenedRequest(
        url,
        { method: 'GET', headers: { range: 'bytes=0-0' } },
        resolve,
      );
      return get?.ok === true; // 206 (range honored) or 200 (range ignored) both prove life
    } catch {
      return false;
    }
  };
}

export const defaultPhotoProbe: PhotoProbe = createPhotoProbe();

export type PhotoSelection = {
  photos: PhotoSource[]; // reachable subset, original order preserved
  originalIndex: number[]; // subset position → original input index
  dropped: number[]; // original indices that failed the probe
};

// Uploads are always kept — they arrived as bytes, there is nothing to probe.
export async function selectReachablePhotos(
  photos: PhotoSource[],
  probe: PhotoProbe,
): Promise<PhotoSelection> {
  const alive = await Promise.all(
    photos.map((p) => (p.kind === 'url' ? probe(p.url).catch(() => false) : Promise.resolve(true))),
  );
  const selection: PhotoSelection = { photos: [], originalIndex: [], dropped: [] };
  alive.forEach((ok, i) => {
    if (ok) {
      selection.photos.push(photos[i]);
      selection.originalIndex.push(i);
    } else {
      selection.dropped.push(i);
    }
  });
  return selection;
}

export function toOriginalIndex(selection: PhotoSelection, subsetIndex: number): number {
  return selection.originalIndex[subsetIndex] ?? subsetIndex;
}

export function toOriginalIndices(selection: PhotoSelection, indices: number[]): number[] {
  return indices.map((i) => toOriginalIndex(selection, i));
}
