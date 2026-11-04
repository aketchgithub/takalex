-- Minimal stand-ins for what the Supabase stack provides, so the migrations
-- can be applied to a plain PostgreSQL cluster. Applied to the template
-- database before migration 001.
--
-- This is NOT a faithful copy of Supabase. It only provides what the
-- migrations and tests reference: the API roles, auth.users (the columns
-- the migrations read) and auth.uid().

-- API roles (cluster-wide). service_role bypasses RLS, as on Supabase.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;

-- Only the columns the migrations and tests use.
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  phone TEXT,
  email_confirmed_at TIMESTAMPTZ,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  banned_until TIMESTAMPTZ
);

-- Same lookup order as Supabase's auth.uid(): the legacy single-claim
-- setting first, then the "sub" field of request.jwt.claims.
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Worst case for privileges: emulate Supabase's classic automatic exposure,
-- where new tables and functions in public are granted to the API roles by
-- default. The migrations must REVOKE explicitly to be safe here, so this
-- is stricter than a project with automatic exposure disabled.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
