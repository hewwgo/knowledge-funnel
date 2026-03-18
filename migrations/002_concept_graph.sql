-- Migration: Concept Graph tables
-- Run this in Supabase SQL Editor

-- Concepts: unique concept labels extracted from submissions
CREATE TABLE IF NOT EXISTS concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Edges between concepts (co-occurrence or explicit relationship)
CREATE TABLE IF NOT EXISTS concept_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relation TEXT DEFAULT 'co-occurs',
  weight INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_id, target_id)
);

-- Junction: which submissions reference which concepts
CREATE TABLE IF NOT EXISTS submission_concepts (
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  PRIMARY KEY (submission_id, concept_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_concept_edges_source ON concept_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_concept_edges_target ON concept_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_submission_concepts_concept ON submission_concepts(concept_id);
CREATE INDEX IF NOT EXISTS idx_submission_concepts_submission ON submission_concepts(submission_id);

-- Enable RLS but allow service role full access
ALTER TABLE concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON concepts FOR ALL USING (true);
CREATE POLICY "Service role full access" ON concept_edges FOR ALL USING (true);
CREATE POLICY "Service role full access" ON submission_concepts FOR ALL USING (true);
