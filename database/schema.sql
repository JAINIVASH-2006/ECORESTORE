-- Run once in the chosen Supabase project's SQL editor.
-- Stores complete, versioned workspace snapshots; users can only access their own.
create table if not exists public.eco_workspaces (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 180),
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 created_at timestamptz not null default now()
);
create index if not exists eco_workspaces_owner_idx on public.eco_workspaces(user_id,created_at desc);
alter table public.eco_workspaces enable row level security;
revoke all on public.eco_workspaces from anon;
grant select,insert,delete on public.eco_workspaces to authenticated;
create policy "Read own snapshots" on public.eco_workspaces for select to authenticated using ((select auth.uid())=user_id);
create policy "Save own snapshots" on public.eco_workspaces for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Delete own snapshots" on public.eco_workspaces for delete to authenticated using ((select auth.uid())=user_id);
-- Intentionally immutable snapshots: no UPDATE grant or policy.
