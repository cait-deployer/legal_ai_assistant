-- Generic retrieval budget controls. These reduce slow/noisy broad retrieval
-- without adding topic-specific rules.

INSERT INTO public.app_settings (key, value_int)
VALUES
  ('title_boost_max_pages', 2),
  ('title_boost_max_docs_per_collection', 12),
  ('doc_expansion_max_docs', 4),
  ('doc_expansion_chunks_per_doc', 2)
ON CONFLICT (key) DO UPDATE
SET value_int = EXCLUDED.value_int,
    value_text = NULL,
    value_bool = NULL;
