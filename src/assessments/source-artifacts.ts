/** Content-addressed source captures; integrity is independent of claim truth (SPEC 48). */
import { createHash } from 'node:crypto';

export type SourceArtifact = {
  kind: 'provider_response' | 'listing_item' | 'image_manifest';
  mediaType: 'application/json';
  sha256: string;
  content: Record<string, unknown>;
};
const MAX_BYTES = 512 * 1024;
function canonical(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || !value || seen.has(value))
    throw new Error('Source artifact must contain finite JSON data');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonical(item, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new Error('Source artifact must contain plain JSON objects');
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item, seen)]),
    );
  } finally {
    seen.delete(value);
  }
}
export function captureSourceArtifact(kind: SourceArtifact['kind'], raw: unknown): SourceArtifact {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Source artifact body must be a JSON object');
  const serialized = JSON.stringify(canonical(raw));
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES)
    throw new Error('Source artifact exceeds the 512 KiB capture limit');
  return {
    kind,
    mediaType: 'application/json',
    sha256: createHash('sha256').update(serialized).digest('hex'),
    content: JSON.parse(serialized) as Record<string, unknown>,
  };
}
export function verifySourceArtifact(artifact: SourceArtifact): boolean {
  try {
    return (
      artifact.mediaType === 'application/json' &&
      captureSourceArtifact(artifact.kind, artifact.content).sha256 === artifact.sha256
    );
  } catch {
    return false;
  }
}
