-- FIRST ADMINISTRATOR BOOTSTRAP
--
-- Promotes one existing, email-confirmed Auth user to the first active
-- administrator. Run manually by the database owner only (Supabase SQL Editor
-- or psql as postgres):
--
--   SELECT public.bootstrap_first_admin('admin@example.org');
--
-- It refuses to run once any admin profile exists, active or inactive.
-- It creates no Auth users, passwords or other credentials.
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT;
  v_match_count BIGINT;
  v_user_id UUID;
  v_email_confirmed_at TIMESTAMPTZ;
BEGIN
  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'An email address is required';
  END IF;

  -- Serialise bootstrap attempts and block concurrent profile writes until
  -- this transaction ends, so the "no admin exists" check cannot race.
  -- SHARE ROW EXCLUSIVE conflicts with itself and with INSERT/UPDATE/DELETE.
  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.role = 'admin'::public.user_role
  ) THEN
    RAISE EXCEPTION
      'An administrator profile already exists; bootstrap_first_admin can only create the first administrator';
  END IF;

  -- Eligible Auth users only: not soft-deleted, and not currently banned.
  -- A NULL banned_until (never banned) or an expired ban is eligible.
  -- The same conditions are used in both queries below.
  SELECT pg_catalog.count(*)
  INTO v_match_count
  FROM auth.users AS u
  WHERE pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= NOW());

  IF v_match_count = 0 THEN
    RAISE EXCEPTION 'No eligible Auth user (not deleted or banned) exists with email %', v_email;
  END IF;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'More than one Auth user matches email %', v_email;
  END IF;

  SELECT u.id, u.email_confirmed_at
  INTO v_user_id, v_email_confirmed_at
  FROM auth.users AS u
  WHERE pg_catalog.lower(pg_catalog.btrim(u.email)) = v_email
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= NOW());

  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'The Auth user with email % has not confirmed their email', v_email;
  END IF;

  -- Only role and is_active change; name, phone and other fields are kept.
  UPDATE public.profiles AS p
  SET
    role = 'admin'::public.user_role,
    is_active = TRUE
  WHERE p.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile exists for the Auth user with email %', v_email;
  END IF;

  RETURN v_user_id;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_first_admin(TEXT) IS
  'Manual, owner-only: promotes one confirmed Auth user to the first active admin. Fails if any admin profile exists.';

-- Not callable through the API. Only the owner (postgres) can execute it.
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
