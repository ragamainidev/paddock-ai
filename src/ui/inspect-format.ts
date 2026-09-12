import type { InspectStageStatus, MarketPosition } from '@/inspector/types';
import { dollars } from '@/lib/money';

// Pure formatting for the inspector UI, unit-tested like src/ui/format.ts.

// The money grammar and the `m3forum.net` source label are shared with the
// domain code that writes the same strings into console notes and bases.
export { dollars };
export { hostOf } from '@/lib/url';

const STAGE_LABELS: Record<InspectStageStatus['stage'], string> = {
  photos: 'photos',
  vision: 'vision',
  plan: 'research plan',
  reliability: 'known failures',
  nhtsa: 'NHTSA',
  web: 'web research',
  vin: 'VIN',
  market: 'market',
  synthesis: 'synthesis',
};

export function inspectStageLabel(stage: InspectStageStatus['stage']): string {
  return STAGE_LABELS[stage];
}

// DESIGN.md: one meta line per degraded stage, naming stage and reason.
export function inspectStageNote(status: InspectStageStatus): string {
  const base = `${STAGE_LABELS[status.stage]} unavailable`;
  return status.detail ? `${base}: ${status.detail}` : base;
}

// Percent position of a price on the low→high comp rail, clamped to [0,100].
export function railPercent(value: number, market: Pick<MarketPosition, 'low' | 'high'>): number {
  if (market.high <= market.low) return 50;
  const pct = ((value - market.low) / (market.high - market.low)) * 100;
  return Math.min(100, Math.max(0, pct));
}

// `$2,300 above median` / `$900 below median` / `at market`.
export function positionLabel(market: MarketPosition): string {
  if (market.asking === undefined || market.delta === undefined || !market.position) return '';
  if (market.position === 'at') return 'at market';
  return `${dollars(Math.abs(market.delta))} ${market.position} median`;
}
