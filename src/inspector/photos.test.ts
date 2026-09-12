import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPhotoProbe,
  isPublicAddress,
  selectReachablePhotos,
  toOriginalIndex,
  toOriginalIndices,
  type AddressResolver,
  type PhotoSelection,
} from './photos';
import type { PhotoSource } from './types';

// Pre-flight is what stands between a rotted CDN link and a dead run, and
// the remap is what keeps report anchors true to the filmstrip the user
// actually sees. Both are pinned here offline.

const url = (u: string): PhotoSource => ({ kind: 'url', url: u });
const upload = (): PhotoSource => ({ kind: 'upload', mediaType: 'image/jpeg', data: 'aGk=' });

describe('selectReachablePhotos', () => {
  it('keeps reachable urls, drops dead ones, and records the mapping', async () => {
    const probe = vi.fn(async (u: string) => !u.includes('dead'));
    const photos = [
      url('https://cdn/a.jpg'),
      url('https://cdn/dead.jpg'),
      url('https://cdn/c.jpg'),
    ];
    const sel = await selectReachablePhotos(photos, probe);
    expect(sel.photos).toEqual([photos[0], photos[2]]);
    expect(sel.originalIndex).toEqual([0, 2]);
    expect(sel.dropped).toEqual([1]);
  });

  it('never probes uploads — they arrived as bytes', async () => {
    const probe = vi.fn(async () => false);
    const sel = await selectReachablePhotos([upload(), url('https://cdn/x.jpg'), upload()], probe);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sel.photos).toHaveLength(2);
    expect(sel.originalIndex).toEqual([0, 2]);
    expect(sel.dropped).toEqual([1]);
  });

  it('a throwing probe counts as unreachable, not a crash', async () => {
    const probe = vi.fn(async () => {
      throw new Error('network down');
    });
    const sel = await selectReachablePhotos([url('https://cdn/a.jpg')], probe);
    expect(sel.photos).toEqual([]);
    expect(sel.dropped).toEqual([0]);
  });
});

describe('anchor remap', () => {
  const sel: PhotoSelection = {
    photos: [url('https://cdn/a.jpg'), url('https://cdn/d.jpg')],
    originalIndex: [0, 3],
    dropped: [1, 2],
  };

  it('maps subset indices back to the original filmstrip order', () => {
    expect(toOriginalIndex(sel, 0)).toBe(0);
    expect(toOriginalIndex(sel, 1)).toBe(3);
    expect(toOriginalIndices(sel, [1, 0])).toEqual([3, 0]);
  });

  it('an out-of-range index passes through rather than exploding', () => {
    expect(toOriginalIndex(sel, 9)).toBe(9);
  });
});

describe('isPublicAddress', () => {
  it('refuses every address the server can reach but a stranger cannot', () => {
    for (const address of [
      '127.0.0.1',
      '::1',
      '0.0.0.0',
      '::',
      '169.254.169.254',
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '::ffff:7f00:1',
      'fe80::1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '100.127.255.255',
      '198.18.0.1',
      '198.19.255.255',
      'fd00::1',
      'not-an-address',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('allows public addresses, including the edges of the private blocks', () => {
    for (const address of [
      '93.184.216.34',
      '172.15.0.1',
      '172.32.0.1',
      '11.0.0.1',
      '100.63.255.255',
      '100.128.0.1',
      '198.17.255.255',
      '198.20.0.1',
      '2606:2800::1',
      '::ffff:5db8:d822', // 93.184.216.34, mapped
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});

describe('the photo probe as a request-forgery boundary', () => {
  const response = (status: number, headers: Record<string, string> = {}) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      body: null,
      headers: new Headers(headers),
    }) as unknown as Response;

  // Typed as fetch is, so a stub that ignores its arguments still records
  // them for assertions.
  type FetchImpl = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  const stubFetch = (impl: FetchImpl) => {
    const mock = vi.fn(impl);
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  const publicDns: AddressResolver = async () => ['93.184.216.34'];
  const dnsFor =
    (map: Record<string, string[]>): AddressResolver =>
    async (hostname) => {
      const found = map[hostname];
      if (!found) throw new Error(`no record for ${hostname}`);
      return found;
    };

  afterEach(() => vi.unstubAllGlobals());

  it('refuses an http url without dereferencing it', async () => {
    const fetchMock = stubFetch(async () => response(200));
    const resolver = vi.fn(publicDns);
    await expect(createPhotoProbe(resolver)('http://cdn.example.com/a.jpg')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to the metadata endpoint', async () => {
    const fetchMock = stubFetch(async () => response(200));
    const probe = createPhotoProbe(dnsFor({ 'photos.example.com': ['169.254.169.254'] }));
    await expect(probe('https://photos.example.com/a.jpg')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a host whose records are only partly public', async () => {
    const fetchMock = stubFetch(async () => response(200));
    const probe = createPhotoProbe(dnsFor({ 'cdn.example.com': ['93.184.216.34', '10.0.0.5'] }));
    await expect(probe('https://cdn.example.com/a.jpg')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('screens every redirect hop, so a public host cannot hand off a private one', async () => {
    const fetchMock = stubFetch(async () =>
      response(302, { location: 'https://internal.example.com/a.jpg' }),
    );
    const probe = createPhotoProbe(
      dnsFor({
        'cdn.example.com': ['93.184.216.34'],
        'internal.example.com': ['192.168.1.10'],
      }),
    );
    await expect(probe('https://cdn.example.com/a.jpg')).resolves.toBe(false);
    // The first hop was fetched; the private target never was.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/a.jpg');
  });

  it('follows a public redirect and answers from the final hop', async () => {
    const fetchMock = stubFetch(async (url) =>
      String(url).includes('moved')
        ? response(302, { location: 'https://cdn.example.com/a.jpg' })
        : response(200),
    );
    const probe = createPhotoProbe(publicDns);
    await expect(probe('https://cdn.example.com/moved.jpg')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on a redirect loop rather than chasing it', async () => {
    const fetchMock = stubFetch(async () =>
      response(302, { location: 'https://cdn.example.com/loop.jpg' }),
    );
    await expect(createPhotoProbe(publicDns)('https://cdn.example.com/loop.jpg')).resolves.toBe(
      false,
    );
    // One screened hop plus the three the cap allows, then the probe stops.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('never asks fetch to follow a redirect itself', async () => {
    const fetchMock = stubFetch(async () => response(200));
    await createPhotoProbe(publicDns)('https://cdn.example.com/a.jpg');
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('a public https host with a 200 HEAD is alive', async () => {
    const fetchMock = stubFetch(async () => response(200));
    await expect(createPhotoProbe(publicDns)('https://cdn.example.com/a.jpg')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 404 HEAD is dead without a second request', async () => {
    const fetchMock = stubFetch(async () => response(404));
    await expect(createPhotoProbe(publicDns)('https://cdn.example.com/a.jpg')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a host that rejects HEAD gets one range GET before judgment', async () => {
    const fetchMock = stubFetch(async (_url, init) =>
      init?.method === 'HEAD' ? response(405) : response(206),
    );
    await expect(createPhotoProbe(publicDns)('https://cdn.example.com/a.jpg')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('both attempts failing means unreachable', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(createPhotoProbe(publicDns)('https://cdn.example.com/a.jpg')).resolves.toBe(false);
  });

  it('a hostname that does not resolve is unreachable, not a crash', async () => {
    const fetchMock = stubFetch(async () => response(200));
    await expect(createPhotoProbe(dnsFor({}))('https://gone.example.com/a.jpg')).resolves.toBe(
      false,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
