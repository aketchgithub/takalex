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

CREATE INDEX access_requests_status_idx ON public.access_requests(status);

-- ADMIN-CREATED INVITATIONS
CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES public.profiles(id),
  role public.user_role NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  CONSTRAINT invitation_no_admin_role
    CHECK (role <> 'admin'::public.user_role),
  CONSTRAINT invitation_acceptance_timestamp_check
    CHECK (
      (status = 'accepted' AND accepted_at IS NOT NULL)
      OR (status <> 'accepted' AND accepted_at IS NULL)
    )
);

CREATE INDEX invitations_status_idx ON public.invitations(status);
CREATE INDEX invitations_expiry_idx ON public.invitations(expires_at);
CREATE INDEX invitations_auth_user_id_idx ON public.invitations(auth_user_id);

-- Prevent multiple pending invitations for the same normalized email.
-- A new invitation is allowed after the previous one is accepted, expired, or revoked.
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

CREATE POLICY admin_manage_access_requests
  ON public.access_requests
  FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

CREATE POLICY admin_view_invitations
  ON public.invitations
  FOR SELECT TO authenticated
  USING (public.is_active_admin());

-- Remove any privileges added by default-privilege settings so the
-- column-level INSERT grant below is the only public write path.
REVOKE ALL ON public.access_requests FROM anon, authenticated;

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
GRANT SELECT, UPDATE, DELETE ON public.access_requests TO authenticated;
GRANT SELECT ON public.invitations TO authenticated;

-- REGISTER AN INVITATION
CREATE OR REPLACE FUNCTION public.register_invitation(
  p_auth_user_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_role public.user_role,
  p_site_ids UUID[],
  p_invited_by UUID
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
    auth_user_id, email, invited_by, role, expires_at
  )
  VALUES (
    p_auth_user_id, lower(trim(p_email)), p_invited_by, p_role,
    NOW() + INTERVAL '7 days'
  )
  RETURNING id INTO v_invitation_id;

  RETURN v_invitation_id;
END;
$$;

-- ACCEPT THE SIGNED-IN USER'S INVITATION
CREATE OR REPLACE FUNCTION public.accept_my_invitation()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_invitation_id UUID;
  v_invitation_role public.user_role;
  v_invitation_email TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept an invitation';
  END IF;

  SELECT i.id, i.role, i.email, i.expires_at
  INTO v_invitation_id, v_invitation_role, v_invitation_email, v_expires_at
  FROM public.invitations AS i
  WHERE i.auth_user_id = v_user_id
    AND i.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation was found for this account';
  END IF;

  IF v_expires_at <= NOW() THEN
    RAISE EXCEPTION 'This invitation has expired';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_user_id
      AND lower(u.email) = lower(v_invitation_email)
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Verify the invited email address before accepting';
  END IF;

  UPDATE public.profiles
  SET is_active = TRUE
  WHERE id = v_user_id
    AND role = v_invitation_role
    AND role <> 'admin'::public.user_role
    AND is_active = FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invited profile is missing or does not match the invitation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_sites AS us
    WHERE us.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'No site assignment exists for this invitation';
  END IF;

  UPDATE public.invitations
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_invitation_id;

  RETURN v_invitation_id;
END;
$$;

-- FUNCTION EXECUTION PERMISSIONS
REVOKE ALL ON FUNCTION public.register_invitation(
  UUID, TEXT, TEXT, public.user_role, UUID[], UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_invitation(
  UUID, TEXT, TEXT, public.user_role, UUID[], UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.accept_my_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invitation() TO authenticated;
