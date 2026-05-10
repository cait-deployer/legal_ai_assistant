-- Caps broad Qdrant title-search keyword fanout.
-- Lower values reduce latency and noise; hints still add exact title probes.

INSERT INTO public.app_settings (key, value_int)
VALUES ('title_boost_max_keywords', 8)
ON CONFLICT (key) DO UPDATE
SET value_int = EXCLUDED.value_int,
    value_text = NULL,
    value_bool = NULL;
