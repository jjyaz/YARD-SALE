REVOKE ALL ON FUNCTION public.storage_object_is_frozen(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_object_is_frozen(text, text) TO authenticated, service_role;