-- Knowledge Funnel — Supabase Schema
-- Run this in the Supabase SQL editor to set up all tables.

-- Cycles table (must be created first — referenced by submissions)
create table cycles (
  id uuid default gen_random_uuid() primary key,
  cycle_number int not null,
  started_at timestamptz default now(),
  ended_at timestamptz,
  status text default 'collecting' check (status in ('collecting', 'converging', 'complete'))
);

-- Profiles table (populated manually from Google Form responses)
create table profiles (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  role text,
  institution text,
  research_focus text,
  curious_about text,
  research_style text,
  recent_paper text,
  cv_url text,
  additional_context text,
  discord_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Submissions table (core funnel data)
create table submissions (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid references profiles(id) on delete cascade,
  content_type text not null check (content_type in ('paper', 'link', 'note', 'idea')),
  title text,
  body text not null,
  file_path text,
  cycle_id uuid references cycles(id),
  created_at timestamptz default now()
);

-- Pitches table (for module 2 — create now so schema is ready)
create table pitches (
  id uuid default gen_random_uuid() primary key,
  cycle_id uuid references cycles(id),
  title text not null,
  summary text not null,
  agent_pair text[],
  seed_submissions uuid[],
  convergence_log jsonb,
  feedback int,
  feedback_comment text,
  created_at timestamptz default now()
);

-- Seed cycle 1
insert into cycles (cycle_number, status) values (1, 'collecting');

-- Storage policy: allow anyone with anon key to upload PDFs
-- Run this AFTER creating the funnel-uploads bucket in the Storage UI.
insert into storage.policies (name, bucket_id, operation, definition)
select
  'Allow public uploads',
  id,
  'INSERT',
  'true'
from storage.buckets
where name = 'funnel-uploads'
on conflict do nothing;
