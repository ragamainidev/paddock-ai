import type { Metadata } from 'next';
import { RunView } from '@/ui/run/run-view';

// One salvage assessment run, live or archived — same run machinery as
// inspections, salvage report renderer chosen by the run's kind.

export const metadata: Metadata = { title: 'Salvage assessment' };

export default async function SalvageRunPage(props: PageProps<'/salvage/[id]'>) {
  const { id } = await props.params;
  return <RunView runId={id} />;
}
