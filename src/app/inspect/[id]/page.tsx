import type { Metadata } from 'next';
import { RunView } from '@/ui/run/run-view';

// One inspection run, live or archived. The client component attaches to
// the run's event stream by id; everything else — replay, tail, reconnect,
// choreography — lives in RunView.

export const metadata: Metadata = { title: 'Inspection' };

export default async function InspectRunPage(props: PageProps<'/inspect/[id]'>) {
  const { id } = await props.params;
  return <RunView runId={id} />;
}
