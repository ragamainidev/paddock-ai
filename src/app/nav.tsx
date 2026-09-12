'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// DESIGN.md header nav: the active tab is --text with a 1px --accent
// underline sitting on the header's bottom rule. One amber underline is the
// whole selection language.

const TABS = [
  { href: '/search', label: 'Search' },
  { href: '/inspect', label: 'Inspect' },
  { href: '/salvage', label: 'Salvage' },
  { href: '/assessments', label: 'Assessments' },
  { href: '/evals', label: 'Evals' },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main navigation"
      className="flex h-full min-w-0 gap-3 overflow-x-auto sm:gap-5"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex h-full shrink-0 items-center border-b transition-colors duration-[120ms] ease-out ${
              active ? 'border-accent text-text' : 'border-transparent text-dim hover:text-text'
            } type-label`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
