import Link from 'next/link';
import { Fragment } from 'react';
import type { ResolvedVehicle } from '@/lib/types';
import { vehicleSpecs, yearRange } from './format';

// DESIGN.md vehicle card: surface, 1px border, 4px radius, 16px padding,
// title in h1 with the year range beside it — sibling cards from one query
// often share a name, and the years are what tell them apart at a glance.
// Match reasons are explanations (SPEC 9), so they read as sentences, not
// uppercase metadata. The whole card is a link that selects the vehicle
// for enrichment; the selected card sits on accent-wash.
export function VehicleCard({
  vehicle,
  href,
  selected,
}: {
  vehicle: ResolvedVehicle;
  href: string;
  selected: boolean;
}) {
  return (
    <Link
      href={href}
      data-nav
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      className={`block rounded-[4px] border p-4 transition-colors duration-[120ms] ease-out ${
        selected
          ? 'border-border-strong bg-accent-wash'
          : 'border-border bg-surface hover:bg-raised'
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="type-h1 min-w-0">
          {vehicle.make} {vehicle.model}{' '}
          <span className="font-mono text-[16px] font-normal text-dim">
            {yearRange(vehicle.yearMin, vehicle.yearMax)}
            {vehicle.catalogYears ? ' catalog years' : ''}
          </span>
        </h3>
        <span className="type-meta shrink-0 font-mono">{vehicle.rowCount} catalog records</span>
      </div>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {vehicleSpecs(vehicle).map(([label, value]) => (
          <Fragment key={label}>
            <dt className="type-label">{label}</dt>
            <dd className="type-spec text-text">{value}</dd>
          </Fragment>
        ))}
      </dl>
      {!!vehicle.unresolved?.length && (
        <p className="mt-3 type-meta">Unresolved: {vehicle.unresolved.join(' · ')}</p>
      )}
      {vehicle.reasons.length > 0 && (
        <p className="mt-3 font-mono text-[12px] leading-[18px] text-dim">
          {vehicle.reasons.join(' · ')}
        </p>
      )}
    </Link>
  );
}
