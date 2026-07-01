-- Run this in Supabase SQL Editor if you want T&M sheets saved online.

create table if not exists time_material_sheets (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  sheet_number text,
  project text,
  requested_by text,
  location text,
  work_performed text not null,
  crew text,
  employees jsonb,
  labor_hours numeric,
  labor_rate numeric,
  materials text,
  material_items jsonb,
  equipment_items jsonb,
  material_cost numeric,
  other_cost numeric,
  send_to text,
  notes text,
  signature_data text,
  email_sent boolean not null default false,
  created_at timestamptz not null default now()
);


-- Safe updates for existing T&M tables.
alter table time_material_sheets add column if not exists employees jsonb;
alter table time_material_sheets add column if not exists material_items jsonb;
alter table time_material_sheets add column if not exists equipment_items jsonb;
alter table time_material_sheets add column if not exists signature_data text;

alter table time_material_sheets enable row level security;

drop policy if exists "tm sheets read" on time_material_sheets;
drop policy if exists "tm sheets insert" on time_material_sheets;
drop policy if exists "tm sheets update" on time_material_sheets;
drop policy if exists "tm sheets delete" on time_material_sheets;

create policy "tm sheets read" on time_material_sheets for select using (true);
create policy "tm sheets insert" on time_material_sheets for insert with check (true);
create policy "tm sheets update" on time_material_sheets for update using (true) with check (true);
create policy "tm sheets delete" on time_material_sheets for delete using (true);
