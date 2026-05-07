-- Add query_rewritten column to query_analytics
-- Stores the backend-rewritten query (formal legal Ukrainian) that RAG actually searched on.
-- NULL for old rows and for queries where rewrite returned nothing different.

ALTER TABLE query_analytics
  ADD COLUMN IF NOT EXISTS query_rewritten TEXT;
