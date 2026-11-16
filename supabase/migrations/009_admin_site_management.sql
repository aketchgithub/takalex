-- ADMIN SITE MANAGEMENT
--
-- Active administrators add sites, rename them, and deactivate or reactivate
-- them, only through admin_create_site() and admin_update_site(). Clients
-- still have no INSERT, UPDATE or DELETE on public.sites (001), and sites are
-- never deleted: deliveries, assignments and invitations refer to them.
--
-- What "inactive" means (decided 16 Nov 2026): no new people. An inactive
-- site is left out of public_site_options() (access requests) and refused by
-- register_invitation() and reissue_invitation(). Collectors already assigned
-- to it can still submit, and its deliveries can still be reviewed and still
-- count in recycler totals, so nothing waiting offline on a phone gets stuck.
--
-- Coordinates are not handled here: location stays NULL until Chemolex
-- supplies real ones (do not invent them).
--
-- Every change is recorded in public.site_events (who, when, old and new
-- values), in the same transaction as the change.

-- SITE NAMES
-- A name is 1-80 characters, with no leading, trailing or repeated
-- whitespace and no control characters, and is unique ignoring case. The
-- functions below normalise input to this form; the constraint and the index
-- are the hard guard (and close the race between two admins). The 8 real
-- sites (005) already satisfy both.
ALTER TABLE public.sites
  ADD CONSTRAINT sites_name_format CHECK (
    char_length(name) BETWEEN 1 AND 80
    AND name = btrim(name)
    AND name !~ '\s\s'
    AND name !~ '[[:cntrl:]]'
  );

CREATE UNIQUE INDEX sites_name_lower_key ON public.sites (lower(name));

-- AUDIT HISTORY
-- action 'created': old_name and old_active are NULL.
-- action 'updated': one row per call, with the values before and after (the
-- name, the active flag or both changed).
CREATE TABLE public.site_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id),
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('created', 'updated')),
  old_name TEXT,
  new_name TEXT NOT NULL,
  old_active BOOLEAN,
  new_active BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_events_old_values CHECK (
    (action = 'created' AND old_name IS NULL AND old_active IS NULL)
    OR (action = 'updated' AND old_name IS NOT NULL AND old_active IS NOT NULL)
  )
);

REVOKE ALL ON public.site_events FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX site_events_site_idx ON public.site_events (site_id, created_at);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;

-- Only active admins read it. Nobody writes it directly: the two functions
-- below (SECURITY DEFINER, owner postgres) are the only writers.
CREATE POLICY site_events_read_admin
  ON public.site_events FOR SELECT TO authenticated
  USING (public.is_active_admin());

GRANT SELECT ON public.site_events TO authenticated;

-- ADD A SITE
-- Returns the new site's id. The site starts active, with no location.
--   42501  the caller is not an active admin
--   22023  the name is empty, too long or contains control characters
--   23505  a site with that name exists (ignoring case)
CREATE OR REPLACE FUNCTION public.admin_create_site(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_name TEXT;
  v_site_id UUID;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can manage sites'
      USING ERRCODE = '42501';
  END IF;

  -- Trim, and turn any run of whitespace (tabs, newlines) into one space.
  v_name := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));

  IF v_name = '' OR pg_catalog.char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'A site name must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A site name cannot contain control characters'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sites AS s
    WHERE pg_catalog.lower(s.name) = pg_catalog.lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A site named "%" already exists', v_name
      USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO public.sites (name, location, active)
    VALUES (v_name, NULL, TRUE)
    RETURNING id INTO v_site_id;
  EXCEPTION WHEN unique_violation THEN
    -- Another admin added the same name since the check above.
    RAISE EXCEPTION 'A site named "%" already exists', v_name
      USING ERRCODE = '23505';
  END;

  INSERT INTO public.site_events (site_id, actor_id, action, new_name, new_active)
  VALUES (v_site_id, v_admin_id, 'created', v_name, TRUE);

  RETURN v_site_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_site(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_site(TEXT)
  TO authenticated;

-- RENAME, DEACTIVATE OR REACTIVATE A SITE
-- Sets both the name and the active flag; pass the current value for the one
-- that should not change. Returns the site's id.
--   42501  the caller is not an active admin
--   P0002  no such site
--   22023  bad name, a NULL active flag, or nothing would change
--   23505  another site has that name (ignoring case); a change of case on
--          the same site's own name is allowed
CREATE OR REPLACE FUNCTION public.admin_update_site(
  p_site_id UUID,
  p_name TEXT,
  p_active BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_name TEXT;
  v_old_name TEXT;
  v_old_active BOOLEAN;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can manage sites'
      USING ERRCODE = '42501';
  END IF;

  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Say whether the site is active'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the row so two admins editing the same site are applied one after
  -- the other, each recording the values it actually replaced.
  SELECT s.name, s.active INTO v_old_name, v_old_active
  FROM public.sites AS s
  WHERE s.id = p_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_name := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));

  IF v_name = '' OR pg_catalog.char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'A site name must be 1 to 80 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A site name cannot contain control characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_name = v_old_name AND p_active = v_old_active THEN
    RAISE EXCEPTION 'Nothing to change'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sites AS s
    WHERE pg_catalog.lower(s.name) = pg_catalog.lower(v_name)
      AND s.id <> p_site_id
  ) THEN
    RAISE EXCEPTION 'A site named "%" already exists', v_name
      USING ERRCODE = '23505';
  END IF;

  BEGIN
    UPDATE public.sites AS s
    SET name = v_name,
        active = p_active
    WHERE s.id = p_site_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A site named "%" already exists', v_name
      USING ERRCODE = '23505';
  END;

  INSERT INTO public.site_events (
    site_id, actor_id, action, old_name, new_name, old_active, new_active
  )
  VALUES (
    p_site_id, v_admin_id, 'updated', v_old_name, v_name, v_old_active, p_active
  );

  RETURN p_site_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_site(UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_site(UUID, TEXT, BOOLEAN)
  TO authenticated;
