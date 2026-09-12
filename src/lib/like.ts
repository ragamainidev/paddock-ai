// A SQL LIKE pattern as a case-insensitive anchored RegExp, for matching
// knowledge-table patterns against literal strings outside the database.
export function likeToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
}
