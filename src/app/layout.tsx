import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import { Nav } from './nav';
import { SessionControl } from './session-control';
import './globals.css';

const sans = Instrument_Sans({
  variable: '--font-instrument-sans',
  subsets: ['latin'],
});

const mono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'paddock',
    template: '%s · paddock',
  },
  description:
    'Search like an enthusiast, inspect like an appraiser, buy like an underwriter. Chassis codes resolve to real cars; an agent inspects the actual listing: photos, provenance, federal data, market position, with every claim sourced.',
};

export const viewport: Viewport = {
  themeColor: '#0A0A0B',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-border">
          <div className="mx-auto flex min-h-12 w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-4 px-4">
            <Link href="/" className="py-3 font-mono text-[13px] font-medium text-text sm:py-0">
              paddock
            </Link>
            <div className="flex h-12 w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:gap-6">
              <Nav />
              <SessionControl />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
