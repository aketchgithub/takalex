CREATE TYPE public.access_status AS ENUM (
  'submitted',
  'reviewed',
  'approved',
  'invited',
  'rejected'
);

-- PUBLIC ACCESS REQUESTS
-- Anonymous visitors may only supply: full_name, email, phone, role,
-- site_name and referral_source (see column grants below). Validation is
-- deliberately permissive so legitimate Kenyan numbers and addresses pass.
CREATE TABLE public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL
    CHECK (length(trim(full_name)) BETWEEN 2 AND 150),
  -- Basic shape only (something@domain.tld, no spaces); 254 is the
  -- practical maximum length of an email address.
  email TEXT
    CONSTRAINT access_request_email_format CHECK (
      email IS NULL OR (
        length(email) <= 254
        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  -- Accepts +254712345678, 254712345678, 0712345678 and spaced or
  -- hyphenated forms such as +254 712 345-678. 7 to 15 digits (E.164 max).
  phone TEXT
    CONSTRAINT access_request_phone_format CHECK (
      phone IS NULL OR (
        length(phone) <= 32
        AND phone ~ '^\+?[0-9 ()-]+$'
        AND length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 7 AND 15
      )
    ),
  role public.user_role NOT NULL DEFAULT 'collector',
  site_name TEXT
    CONSTRAINT access_request_site_name_length CHECK (
      site_name IS NULL OR length(trim(site_name)) BETWEEN 1 AND 120
    ),
  referral_source TEXT
    CONSTRAINT access_request_referral_source_length CHECK (
      referral_source IS NULL
      OR length(trim(referral_source)) BETWEEN 1 AND 200
    ),
  status public.access_status NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,

  CONSTRAINT access_request_contact_required
    CHECK (
      NULLIF(trim(email), '') IS NOT NULL
      OR NULLIF(trim(phone), '') IS NOT NULL
    ),
  CONSTRAINT access_request_no_admin_role
    CHECK (role <> 'admin'::public.user_role)
);

REVOKE ALL ON public.access_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX access_requests_status_idx ON public.access_requests(status);

-- ADMIN-CREATED INVITATIONS
--
-- An invitation is redeemed with a one-time code. The Edge Function generates
-- the code, emails it, and stores only its SHA-256 hash (lowercase hex). The
-- database never sees the plain code.
--
-- Expiry: an invitation is expired whenever expires_at <= NOW(). Every
-- function checks this directly; nothing relies on a job setting
-- status = 'expired' (that value is kept only for compatibility).
--
-- Lockout: after 5 wrong codes (failed_attempts >= 5) the invitation can no
-- longer be verified or consumed. An admin can revoke it and reissue.
CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES public.profiles(id),
  role public.user_role NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked', 'superseded')),
  code_hash TEXT NOT NULL UNIQUE
    CONSTRAINT invitation_code_hash_format
      CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts INTEGER NOT NULL DEFAULT 0
    CONSTRAINT invitation_failed_attempts_non_negative
      CHECK (failed_attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id),
  superseded_by UUID REFERENCES public.invitations(id),
  CONSTRAINT invitation_no_admin_role
    CHECK (role <> 'admin'::public.user_role),
  CONSTRAINT invitation_acceptance_timestamp_check
    CHECK (
      (status = 'accepted' AND accepted_at IS NOT NULL)
      OR (status <> 'accepted' AND accepted_at IS NULL)
    ),
  -- Revocation audit: a revoked row always records who and when. A
  -- superseded row keeps that audit if it was revoked before being reissued
  -- (both set), or has neither if it expired. Every other status has neither.
  CONSTRAINT invitation_revocation_audit_check
    CHECK (
      (status = 'revoked'
        AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
      OR (status = 'superseded'
        AND (revoked_at IS NULL) = (revoked_by IS NULL))
      OR (status NOT IN ('revoked', 'superseded')
        AND revoked_at IS NULL AND revoked_by IS NULL)
    ),
  CONSTRAINT invitation_superseded_by_check
    CHECK (superseded_by IS NULL OR status = 'superseded'),
  CONSTRAINT invitation_not_self_superseded
    CHECK (superseded_by IS DISTINCT FROM id)
);

REVOKE ALL ON public.invitations FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX invitations_status_idx ON public.invitations(status);
CREATE INDEX invitations_expiry_idx ON public.invitations(expires_at);
CREATE INDEX invitations_auth_user_id_idx ON public.invitations(auth_user_id);

-- At most one pending invitation per Auth user and per normalized email.
-- Earlier accepted, revoked or superseded rows stay as history.
CREATE UNIQUE INDEX invitations_one_pending_user_idx
  ON public.invitations (auth_user_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX invitations_one_pending_email_idx
  ON public.invitations (lower(trim(email)))
  WHERE status = 'pending';

-- ROW LEVEL SECURITY
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY public_submit_access_requests
  ON public.access_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'submitted'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND notes IS NULL
    AND role <> 'admin'::public.user_role
  );

-- Row access for active admins. What they can actually do is limited by the
-- grants below: SELECT, and UPDATE of status and notes only (no DELETE).
CREATE POLICY admin_manage_access_requests
  ON public.access_requests
  FOR ALL TO authenticated
  USING ((SELECT public.is_active_admin()))
  WITH CHECK ((SELECT public.is_active_admin()));

-- Reviewer fields always come from the server, whatever the caller sends.
-- With a signed-in caller, reviewed_by is that caller. Without one (for
-- example a service_role update from an Edge Function) the previous
-- reviewer is kept, so server-side status changes never erase who reviewed.
CREATE OR REPLACE FUNCTION public.set_access_request_reviewer()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.reviewed_by := auth.uid();
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
  END IF;
  NEW.reviewed_at := NOW();
  RETURN NEW;
END;
$$;

-- Trigger function: no EXECUTE for anyone (not checked when a trigger fires).
REVOKE ALL ON FUNCTION public.set_access_request_reviewer()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER access_requests_set_reviewer
  BEFORE UPDATE ON public.access_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_access_request_reviewer();

CREATE POLICY admin_view_invitations
  ON public.invitations
  FOR SELECT TO authenticated
  USING (public.is_active_admin());

-- TABLE PRIVILEGES
-- Both tables start with REVOKE ALL from PUBLIC, anon, authenticated and
-- service_role (next to CREATE TABLE), so these grants are the complete list.

-- Public submissions may only supply these columns. id, status, created_at,
-- reviewed_by, reviewed_at and notes always come from defaults or admins.
-- anon gets no SELECT, so submitted requests are never readable publicly.
GRANT INSERT (
  full_name,
  email,
  phone,
  role,
  site_name,
  referral_source
) ON public.access_requests TO anon, authenticated;

-- Row access for these is limited to active admins by RLS above.
-- Admins may only change status and notes; reviewed_by and reviewed_at are
-- set by the access_requests_set_reviewer trigger. No DELETE for anon or
-- authenticated.
GRANT SELECT ON public.access_requests TO authenticated;
GRANT UPDATE (status, notes) ON public.access_requests TO authenticated;

-- service_role (Edge Functions; bypasses RLS, so this is its only limit):
-- read the fields needed to turn a request into an invitation, and mark it
-- 'invited' afterwards. id is needed to target the UPDATE. reviewed_by and
-- reviewed_at are still set by the trigger (trigger-written columns need no
-- column privilege). No notes, no INSERT/DELETE.
GRANT SELECT (
  id,
  full_name,
  email,
  phone,
  role,
  site_name,
  status
) ON public.access_requests TO service_role;
GRANT UPDATE (status) ON public.access_requests TO service_role;

-- Invitations: no direct writes for anyone; all changes go through the
-- SECURITY DEFINER functions below. Admins read rows through
-- admin_view_invitations, and the Edge Functions (service_role) read them to
-- check for an existing pending invitation. Neither can read code_hash: the
-- definer functions read it themselves. Because these are column-level
-- grants, callers must list columns (SELECT * is denied).
GRANT SELECT (
  id,
  auth_user_id,
  email,
  invited_by,
  role,
  status,
  failed_attempts,
  expires_at,
  created_at,
  accepted_at,
  revoked_at,
  revoked_by,
  superseded_by
) ON public.invitations TO authenticated, service_role;

-- REGISTER AN INVITATION
-- p_code_hash is the lowercase hex SHA-256 of the invitation code, computed
-- by the Edge Function. The plain code is never sent to the database.
CREATE OR REPLACE FUNCTION public.register_invitation(
  p_auth_user_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_role public.user_role,
  p_site_ids UUID[],
  p_invited_by UUID,
  p_code_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitation_id UUID;
  v_site_count INTEGER;
  v_distinct_site_count INTEGER;
  v_auth_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = p_invited_by
      AND p.role = 'admin'::public.user_role
      AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Inviting administrator is not active or authorized';
  END IF;

  IF p_role NOT IN (
    'collector'::public.user_role,
    'site_manager'::public.user_role,
    'recycler'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Invalid invitation role';
  END IF;

  IF NULLIF(trim(p_email), '') IS NULL THEN
    RAISE EXCEPTION 'An email address is required';
  END IF;

  IF NULLIF(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'A full name is required';
  END IF;

  IF p_site_ids IS NULL OR cardinality(p_site_ids) = 0 THEN
    RAISE EXCEPTION 'At least one site assignment is required';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT selected_sites.site_id)
  INTO v_site_count, v_distinct_site_count
  FROM unnest(p_site_ids) AS selected_sites(site_id);

  IF v_site_count <> v_distinct_site_count THEN
    RAISE EXCEPTION 'Duplicate site assignments are not allowed';
  END IF;

  IF (
    SELECT COUNT(*) FROM public.sites AS s
    WHERE s.id = ANY(p_site_ids) AND s.active = TRUE
  ) <> v_distinct_site_count THEN
    RAISE EXCEPTION 'One or more selected sites are invalid or inactive';
  END IF;

  SELECT lower(u.email), u.email_confirmed_at
  INTO v_auth_email, v_email_confirmed_at
  FROM auth.users AS u
  WHERE u.id = p_auth_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invited Auth account does not exist';
  END IF;

  IF v_auth_email IS DISTINCT FROM lower(trim(p_email)) THEN
    RAISE EXCEPTION 'Auth account email does not match invitation email';
  END IF;

  IF v_email_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot invite an already confirmed account';
  END IF;

  UPDATE public.profiles
  SET full_name = trim(p_full_name),
      role = p_role,
      is_active = FALSE
  WHERE id = p_auth_user_id
    AND is_active = FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invited user profile is missing or already active';
  END IF;

  INSERT INTO public.user_sites (user_id, site_id, assigned_by)
  SELECT p_auth_user_id, selected_sites.site_id, p_invited_by
  FROM unnest(p_site_ids) AS selected_sites(site_id);

  INSERT INTO public.invitations (
    auth_user_id, email, invited_by, role, code_hash, expires_at
  )
  VALUES (
    p_auth_user_id, lower(trim(p_email)), p_invited_by, p_role,
    p_code_hash, NOW() + INTERVAL '7 days'
  )
  RETURNING id INTO v_invitation_id;

  RETURN v_invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_invitation(
  UUID, TEXT, TEXT, public.user_role, UUID[], UUID, TEXT
)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_invitation(
  UUID, TEXT, TEXT, public.user_role, UUID[], UUID, TEXT
)
  TO service_role;

-- VERIFY AN INVITATION CODE
-- Always returns exactly one row. On success: (TRUE, invitation id, Auth
-- user id). On any failure (unknown email, wrong code, expired, locked,
-- not pending) the same generic row (FALSE, NULL, NULL). It never raises,
-- so the failed-attempt increment is always committed.
--
-- A wrong code increments failed_attempts on that email's pending
-- invitation, if one exists. The row is locked so concurrent guesses are
-- counted exactly.
CREATE OR REPLACE FUNCTION public.verify_invitation_code(
  p_email TEXT,
  p_code_hash TEXT
)
RETURNS TABLE (is_valid BOOLEAN, invitation_id UUID, auth_user_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
  v_auth_user_id UUID;
  v_code_hash TEXT;
  v_expires_at TIMESTAMPTZ;
  v_failed_attempts INTEGER;
BEGIN
  SELECT i.id, i.auth_user_id, i.code_hash, i.expires_at, i.failed_attempts
  INTO v_id, v_auth_user_id, v_code_hash, v_expires_at, v_failed_attempts
  FROM public.invitations AS i
  WHERE lower(trim(i.email)) = lower(trim(p_email))
    AND i.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF p_code_hash IS NULL OR v_code_hash <> p_code_hash THEN
    UPDATE public.invitations AS i
    SET failed_attempts = i.failed_attempts + 1
    WHERE i.id = v_id;

    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_expires_at <= NOW() OR v_failed_attempts >= 5 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_id, v_auth_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_invitation_code(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_invitation_code(TEXT, TEXT)
  TO service_role;

-- CONSUME A VERIFIED INVITATION
-- Called by the Edge Function after verify_invitation_code succeeds and the
-- Auth user's email has been confirmed. Rechecks everything under a row
-- lock, so an invitation activates a profile at most once even under
-- concurrent calls. The Auth account checks are enforced here, not only in
-- the Edge Function.
CREATE OR REPLACE FUNCTION public.consume_invitation(p_invitation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_user_id UUID;
  v_email TEXT;
  v_role public.user_role;
  v_status TEXT;
  v_expires_at TIMESTAMPTZ;
  v_failed_attempts INTEGER;
  v_auth_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_deleted_at TIMESTAMPTZ;
  v_banned_until TIMESTAMPTZ;
BEGIN
  SELECT i.auth_user_id, i.email, i.role, i.status, i.expires_at,
         i.failed_attempts
  INTO v_auth_user_id, v_email, v_role, v_status, v_expires_at,
       v_failed_attempts
  FROM public.invitations AS i
  WHERE i.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_status <> 'pending'
    OR v_expires_at <= NOW()
    OR v_failed_attempts >= 5
  THEN
    RAISE EXCEPTION 'Invitation is not valid';
  END IF;

  SELECT u.email, u.email_confirmed_at, u.deleted_at, u.banned_until
  INTO v_auth_email, v_email_confirmed_at, v_deleted_at, v_banned_until
  FROM auth.users AS u
  WHERE u.id = v_auth_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invited Auth account does not exist';
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invited Auth account has been deleted';
  END IF;

  IF v_banned_until IS NOT NULL AND v_banned_until > NOW() THEN
    RAISE EXCEPTION 'Invited Auth account is banned';
  END IF;

  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Invited Auth account email is not confirmed';
  END IF;

  IF lower(trim(v_auth_email)) IS DISTINCT FROM lower(trim(v_email)) THEN
    RAISE EXCEPTION 'Auth account email does not match invitation email';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_sites AS us
    WHERE us.user_id = v_auth_user_id
  ) THEN
    RAISE EXCEPTION 'No site assignment exists for this invitation';
  END IF;

  UPDATE public.profiles AS p
  SET is_active = TRUE
  WHERE p.id = v_auth_user_id
    AND p.role = v_role
    AND p.role <> 'admin'::public.user_role
    AND p.is_active = FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invited profile is missing or does not match the invitation';
  END IF;

  UPDATE public.invitations AS i
  SET status = 'accepted', accepted_at = NOW()
  WHERE i.id = p_invitation_id;

  RETURN p_invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_invitation(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_invitation(UUID)
  TO service_role;

-- REISSUE AN EXPIRED OR REVOKED INVITATION
-- Atomic: the old row becomes 'superseded' (pointing at the new row), a new
-- pending row with a fresh code hash and 7-day expiry is inserted, and the
-- profile's name, role and site assignments are replaced. The old code can
-- never be accepted afterwards, because it is no longer pending.
CREATE OR REPLACE FUNCTION public.reissue_invitation(
  p_old_invitation_id UUID,
  p_invited_by UUID,
  p_code_hash TEXT,
  p_full_name TEXT,
  p_role public.user_role,
  p_site_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_id UUID;
  v_auth_user_id UUID;
  v_email TEXT;
  v_status TEXT;
  v_expires_at TIMESTAMPTZ;
  v_site_count INTEGER;
  v_distinct_site_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = p_invited_by
      AND p.role = 'admin'::public.user_role
      AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Inviting administrator is not active or authorized';
  END IF;

  IF p_role IS NULL OR p_role NOT IN (
    'collector'::public.user_role,
    'site_manager'::public.user_role,
    'recycler'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Invalid invitation role';
  END IF;

  IF NULLIF(trim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'A full name is required';
  END IF;

  IF p_site_ids IS NULL OR cardinality(p_site_ids) = 0 THEN
    RAISE EXCEPTION 'At least one site assignment is required';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT selected_sites.site_id)
  INTO v_site_count, v_distinct_site_count
  FROM unnest(p_site_ids) AS selected_sites(site_id);

  IF v_site_count <> v_distinct_site_count THEN
    RAISE EXCEPTION 'Duplicate site assignments are not allowed';
  END IF;

  IF (
    SELECT COUNT(*) FROM public.sites AS s
    WHERE s.id = ANY(p_site_ids) AND s.active = TRUE
  ) <> v_distinct_site_count THEN
    RAISE EXCEPTION 'One or more selected sites are invalid or inactive';
  END IF;

  SELECT i.auth_user_id, i.email, i.status, i.expires_at
  INTO v_auth_user_id, v_email, v_status, v_expires_at
  FROM public.invitations AS i
  WHERE i.id = p_old_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF NOT (
    v_status = 'revoked'
    OR (v_status = 'pending' AND v_expires_at <= NOW())
  ) THEN
    RAISE EXCEPTION 'Only expired or revoked invitations can be reissued';
  END IF;

  -- Lock the profile for the rest of the transaction.
  PERFORM 1 FROM public.profiles AS p
  WHERE p.id = v_auth_user_id
    AND p.is_active = FALSE
    AND p.role <> 'admin'::public.user_role
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invited user profile is missing or already active';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invitations AS i
    WHERE i.auth_user_id = v_auth_user_id
      AND i.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'This user has already accepted an invitation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invitations AS i
    WHERE i.auth_user_id = v_auth_user_id
      AND i.status = 'pending'
      AND i.id <> p_old_invitation_id
  ) THEN
    RAISE EXCEPTION 'This user already has another pending invitation';
  END IF;

  -- Leave 'pending' first so the one-pending-per-user index allows the new
  -- row; superseded_by is filled in once the new row exists.
  UPDATE public.invitations AS i
  SET status = 'superseded'
  WHERE i.id = p_old_invitation_id;

  INSERT INTO public.invitations (
    auth_user_id, email, invited_by, role, code_hash, expires_at
  )
  VALUES (
    v_auth_user_id, v_email, p_invited_by, p_role,
    p_code_hash, NOW() + INTERVAL '7 days'
  )
  RETURNING id INTO v_new_id;

  UPDATE public.invitations AS i
  SET superseded_by = v_new_id
  WHERE i.id = p_old_invitation_id;

  UPDATE public.profiles AS p
  SET full_name = trim(p_full_name),
      role = p_role
  WHERE p.id = v_auth_user_id;

  DELETE FROM public.user_sites AS us
  WHERE us.user_id = v_auth_user_id;

  INSERT INTO public.user_sites (user_id, site_id, assigned_by)
  SELECT v_auth_user_id, selected_sites.site_id, p_invited_by
  FROM unnest(p_site_ids) AS selected_sites(site_id);

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reissue_invitation(
  UUID, UUID, TEXT, TEXT, public.user_role, UUID[]
)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reissue_invitation(
  UUID, UUID, TEXT, TEXT, public.user_role, UUID[]
)
  TO service_role;

-- REVOKE A PENDING INVITATION
-- Called directly by a signed-in admin (authenticated role). The revoking
-- admin is always auth.uid(), never a parameter. Works on any pending row,
-- expired or not. The revoked row can then be reissued with
-- reissue_invitation(). Calls without a user JWT (anon, or the service
-- role key) have no auth.uid() and are refused.
CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();

  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = v_admin_id
      AND p.role = 'admin'::public.user_role
      AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Revoking administrator is not active or authorized';
  END IF;

  UPDATE public.invitations AS i
  SET status = 'revoked',
      revoked_at = NOW(),
      revoked_by = v_admin_id
  WHERE i.id = p_invitation_id
    AND i.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only pending invitations can be revoked';
  END IF;

  RETURN p_invitation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_invitation(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(UUID)
  TO authenticated;
