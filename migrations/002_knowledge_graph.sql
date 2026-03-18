-- Knowledge Graph tables (replacing UMAP/embedding approach)
-- Run this in the Supabase SQL editor.

-- Concepts extracted from submissions by LLM
create table if not exists concepts (
  id uuid default gen_random_uuid() primary key,
  label text not null unique,
  created_at timestamptz default now()
);

-- Junction: which submissions reference which concepts
create table if not exists submission_concepts (
  id uuid default gen_random_uuid() primary key,
  submission_id uuid references submissions(id) on delete cascade,
  concept_id uuid references concepts(id) on delete cascade,
  created_at timestamptz default now(),
  unique(submission_id, concept_id)
);

-- Edges between concepts (co-occurrence in same submission)
create table if not exists concept_edges (
  id uuid default gen_random_uuid() primary key,
  source_id uuid references concepts(id) on delete cascade,
  target_id uuid references concepts(id) on delete cascade,
  relation text default 'co-occurs',
  weight int default 1,
  created_at timestamptz default now(),
  unique(source_id, target_id)
);

-- Indexes
create index if not exists idx_submission_concepts_sub on submission_concepts(submission_id);
create index if not exists idx_submission_concepts_concept on submission_concepts(concept_id);
create index if not exists idx_concept_edges_source on concept_edges(source_id);
create index if not exists idx_concept_edges_target on concept_edges(target_id);
create index if not exists idx_concepts_label on concepts(label);
