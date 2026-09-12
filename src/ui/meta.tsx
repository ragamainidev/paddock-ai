import type { StageStatus } from '@/lib/types';
import { stageNote } from './format';

// Degradation is visible, never silent: every failed stage becomes one meta
// line under the results that did work.
export function StageNotes({ statuses }: { statuses: StageStatus[] }) {
  const failed = statuses.filter((s) => !s.ok);
  if (failed.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {failed.map((s) => (
        <li key={s.stage} className="type-meta">
          {stageNote(s)}
        </li>
      ))}
    </ul>
  );
}
