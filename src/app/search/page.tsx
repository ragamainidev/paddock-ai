import { Suspense } from 'react';
import { Results } from '@/ui/results';
import { KeyboardNav } from '../keyboard-nav';
import { SearchField } from '../search-field';

// The whole page is server-rendered from the URL: `q` is the query, `v`
// selects a vehicle for enrichment. Interpret + resolve stream in behind
// one Suspense boundary; enrichment streams behind its own, inside Results.
export default async function Home(props: PageProps<'/search'>) {
  const sp = await props.searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim();
  const v = typeof sp.v === 'string' ? sp.v : undefined;

  return (
    <>
      <KeyboardNav />
      <SearchField initialQuery={q} />
      <div className="mt-6">
        {q ? (
          <Suspense key={`${q}|${v ?? ''}`} fallback={<p className="type-meta">resolving</p>}>
            <Results query={q} selection={v} />
          </Suspense>
        ) : (
          <p className="type-body text-dim">
            Type how enthusiasts talk: chassis codes, engine codes, trim shorthand, negations.
          </p>
        )}
      </div>
    </>
  );
}
