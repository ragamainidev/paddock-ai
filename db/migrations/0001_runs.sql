-- Up Migration
-- Runs are the unit of persistence: one inspection or salvage assessment,
-- its full typed event stream (which includes trace spans as events), and
-- the finished report. The event log is the source of truth for replay;
-- the report column is a convenience for list views and finished pages.

create table runs (
  id uuid primary key,
  kind text not null check (kind in ('inspect', 'salvage')),
  status text not null check (status in ('running', 'done', 'error')),
  title text not null,
  vehicle jsonb not null,
  input jsonb not null,
  report jsonb,
  verdict text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index runs_created_idx on runs (created_at desc);
create index runs_kind_created_idx on runs (kind, created_at desc);

create table run_events (
  run_id uuid not null references runs (id) on delete cascade,
  seq integer not null,
  at timestamptz not null default now(),
  event jsonb not null,
  primary key (run_id, seq)
);
