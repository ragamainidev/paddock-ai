/**
 * Form state that survives a background revision. A form is seeded from the
 * saved record and re-seeded whenever the record changes, until someone types
 * into it: from then on the seed is pinned to the revision the edit started
 * from, so a poll can never discard what a reader is in the middle of writing.
 */
import { useState } from 'react';

/** The interface line a form shows when the record moved under an edit. */
export const SEED_CHANGED = 'Saved values changed on the server; reopen to see them';

export type SeededForm = {
  // Remount key for the seeded fields: it moves only when re-seeding is safe.
  key: number;
  // The saved record moved while this form was being edited.
  stale: boolean;
  onEdit: () => void;
  settle: () => void;
};

export function useSeededForm(revision: number): SeededForm {
  // The revision an in-progress edit started from; null while nobody is typing.
  const [editing, setEditing] = useState<number | null>(null);
  return {
    key: editing ?? revision,
    stale: editing !== null && editing !== revision,
    onEdit: () => setEditing((started) => started ?? revision),
    settle: () => setEditing(null),
  };
}
