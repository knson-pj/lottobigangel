create extension if not exists pgcrypto;

create table if not exists public.lotto_draws (
  round integer primary key,
  draw_date date not null,
  machine_no integer,
  n1 integer not null,
  n2 integer not null,
  n3 integer not null,
  n4 integer not null,
  n5 integer not null,
  n6 integer not null,
  bonus integer not null,
  odd_count integer,
  even_count integer,
  low_count integer,
  high_count integer,
  ac_value integer,
  end_sum integer,
  total_sum integer,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lotto_draw_features (
  round integer primary key references public.lotto_draws(round) on delete cascade,
  carryover_count integer,
  neighbor_count integer,
  consecutive_pair_count integer,
  same_ending_pair_count integer,
  same_ending_max_group integer,
  twin_count integer,
  twin_flag boolean,
  multiple_2_count integer,
  multiple_3_count integer,
  multiple_5_count integer,
  sum_123 integer,
  sum_456 integer,
  sum_123_456_gap integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prediction_runs (
  id uuid primary key default gen_random_uuid(),
  target_round integer not null,
  model_version text not null,
  model_hash text,
  feature_version text not null,
  triggered_by text not null,
  request_id text,
  status text not null default 'completed',
  top_pool_size integer,
  combo_count integer,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.prediction_number_scores (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.prediction_runs(id) on delete cascade,
  number integer not null,
  probability double precision not null,
  rank_order integer not null,
  created_at timestamptz not null default now(),
  unique(run_id, number)
);

create table if not exists public.prediction_combos (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.prediction_runs(id) on delete cascade,
  combo_rank integer not null,
  n1 integer not null,
  n2 integer not null,
  n3 integer not null,
  n4 integer not null,
  n5 integer not null,
  n6 integer not null,
  combo_score double precision not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(run_id, combo_rank)
);

create table if not exists public.app_event_logs (
  id bigint generated always as identity primary key,
  level text not null,
  event_type text not null,
  request_id text,
  route text,
  user_id uuid,
  target_round integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_prediction_runs_created_at
  on public.prediction_runs(created_at desc);

create index if not exists idx_prediction_number_scores_run_id
  on public.prediction_number_scores(run_id);

create index if not exists idx_prediction_combos_run_id
  on public.prediction_combos(run_id);

create index if not exists idx_app_event_logs_created_at
  on public.app_event_logs(created_at desc);

create index if not exists idx_app_event_logs_event_type
  on public.app_event_logs(event_type);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_lotto_draws_updated_at
before update on public.lotto_draws
for each row execute function public.set_updated_at();

create trigger trg_lotto_draw_features_updated_at
before update on public.lotto_draw_features
for each row execute function public.set_updated_at();

alter table public.lotto_draws enable row level security;
alter table public.prediction_runs enable row level security;
alter table public.prediction_number_scores enable row level security;
alter table public.prediction_combos enable row level security;
alter table public.app_event_logs enable row level security;

create policy "public read lotto_draws"
on public.lotto_draws
for select
using (true);

create policy "public read prediction_runs"
on public.prediction_runs
for select
using (status = 'completed');

create policy "public read prediction_number_scores"
on public.prediction_number_scores
for select
using (
  exists (
    select 1
    from public.prediction_runs r
    where r.id = prediction_number_scores.run_id
      and r.status = 'completed'
  )
);

create policy "public read prediction_combos"
on public.prediction_combos
for select
using (
  exists (
    select 1
    from public.prediction_runs r
    where r.id = prediction_combos.run_id
      and r.status = 'completed'
  )
);
