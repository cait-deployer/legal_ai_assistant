-- Adds a feature flag for the soft AI retrieval hints layer.
-- The backend also defaults to true when the key is absent.

INSERT INTO public.app_settings (key, value_bool)
VALUES ('retrieval_hints_enabled', true)
ON CONFLICT (key) DO UPDATE
SET value_bool = EXCLUDED.value_bool,
    value_text = NULL,
    value_int = NULL;
