create table if not exists public.model_probability_exports (
  id bigint generated always as identity primary key,
  target_round integer not null,
  model_version text not null,
  feature_version text not null,
  number integer not null,
  probability double precision not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(target_round, model_version, feature_version, number)
);

create index if not exists idx_model_probability_exports_target_round
  on public.model_probability_exports(target_round desc);

create index if not exists idx_model_probability_exports_versions
  on public.model_probability_exports(model_version, feature_version);

alter table public.model_probability_exports enable row level security;

create policy "public read model probability exports"
on public.model_probability_exports
for select
using (true);
