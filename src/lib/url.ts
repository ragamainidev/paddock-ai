/**
 * URL formatting shared by the citation surfaces. A source is credited by
 * its host (`m3forum.net`), never its path, and an unparseable string is
 * shown as it arrived rather than dropped: a citation the reader cannot
 * click still tells them where a claim came from.
 */

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The address a lot's own data came from: its listing when one was recorded,
 * and otherwise the first photo the user pasted, because a lot the user
 * brought has no page of its own (SPEC 61). Absent when the lot states
 * neither, which every reader states rather than reads through.
 */
export function lotProvenanceUrl(lot: { url?: string; photos: string[] }): string | undefined {
  return lot.url ?? lot.photos[0];
}

/**
 * What a reader states when a lot cites no address at all. Every observation
 * carries the source it came from, so a lot with neither a listing nor a
 * photo leaves one with nothing to cite; that absence is stated rather than
 * read through (SPEC 10–11 spirit).
 */
export const NO_LOT_ADDRESS =
  'The lot states neither a listing address nor a photo address, so an observation about it has no source to cite';
