CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- ENUMS
CREATE TYPE public.user_role AS ENUM (
  'collector',
  'site_manager',
  'recycler',
  'admin'
);

CREATE TYPE public.material_type AS ENUM (
  'PET',
  'HDPE',
  'LDPE',
  'MIXED'
);

CREATE TYPE public.collection_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

-- SITES
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  location extensions.geography(POINT, 4326),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sites_location_idx
  ON public.sites USING GIST (location);

-- USER PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  role public.user_role NOT NULL DEFAULT 'collector',
  group_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GROUPS
CREATE TABLE public.sme_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  site_id UUID REFERENCES public.sites(id),
  leader_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.sme_groups(id);

-- MANY-TO-MANY USER/SITE ASSIGNMENTS
CREATE TABLE public.user_sites (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES public.profiles(id),
  PRIMARY KEY (user_id, site_id)
);

CREATE INDEX user_sites_site_id_idx ON public.user_sites(site_id);

-- COLLECTION RECORDS
-- Collectors may only supply: client_record_id, site_id, material,
-- reported_weight_kg and captured_at (see column grants below).
-- Everything else is set by defaults, triggers or review_collection().
CREATE TABLE public.collection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Client-generated offline idempotency key.
  client_record_id UUID NOT NULL,
  collector_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES public.profiles(id),
  site_id UUID NOT NULL REFERENCES public.sites(id),
  material public.material_type NOT NULL,
  -- Collector-reported weight. Never used for payout.
  reported_weight_kg NUMERIC(10,2) NOT NULL
    CHECK (reported_weight_kg > 0),
  -- Site-manager-verified weight. Set only by review_collection().
  verified_weight_kg NUMERIC(10,2)
    CHECK (verified_weight_kg IS NULL OR verified_weight_kg > 0),
  status public.collection_status NOT NULL DEFAULT 'pending',
  payment_eligible BOOLEAN NOT NULL DEFAULT false,
  -- Device-reported capture time (untrusted; useful for offline records).
  -- submitted_at and created_at are server-set trusted timestamps.
  captured_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by UUID REFERENCES public.profiles(id),
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collection_client_record_unique
    UNIQUE (collector_id, client_record_id),
  CONSTRAINT collection_review_consistency CHECK (
    (
      status = 'pending'
      AND verified_weight_kg IS NULL
      AND verified_by IS NULL
      AND verified_at IS NULL
      AND rejection_reason IS NULL
      AND payment_eligible = false
    )
    OR
    (
      status = 'approved'
      AND verified_weight_kg IS NOT NULL
      AND verified_by IS NOT NULL
      AND verified_at IS NOT NULL
      AND rejection_reason IS NULL
      AND payment_eligible = true
    )
    OR
    (
      status = 'rejected'
      AND verified_by IS NOT NULL
      AND verified_at IS NOT NULL
      AND rejection_reason IS NOT NULL
      AND length(trim(rejection_reason)) > 0
      AND payment_eligible = false
    )
  )
);

CREATE INDEX collection_logs_collector_idx
  ON public.collection_logs(collector_id);

CREATE INDEX collection_logs_site_status_idx
  ON public.collection_logs(site_id, status);

CREATE INDEX collection_logs_submitted_at_idx
  ON public.collection_logs(submitted_at DESC);

-- PHOTO EVIDENCE
CREATE TABLE public.collection_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL
    REFERENCES public.collection_logs(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  captured_at TIMESTAMPTZ,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX collection_evidence_collection_idx
  ON public.collection_evidence(collection_id);

-- AUDIT HISTORY
CREATE TABLE public.collection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL
    REFERENCES public.collection_logs(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL
    CHECK (action IN ('submitted', 'approved', 'rejected')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX collection_events_collection_idx
  ON public.collection_events(collection_id, created_at);

-- COLLECTION INTEGRITY TRIGGERS
-- Force workflow fields and trusted timestamps on every insert,
-- whatever the caller supplied.
CREATE OR REPLACE FUNCTION public.enforce_collection_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.status := 'pending'::public.collection_status;
  NEW.verified_weight_kg := NULL;
  NEW.verified_by := NULL;
  NEW.verified_at := NULL;
  NEW.rejection_reason := NULL;
  NEW.payment_eligible := false;
  NEW.submitted_at := NOW();
  NEW.created_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_collection_insert() FROM PUBLIC;

CREATE TRIGGER collection_logs_enforce_insert
  BEFORE INSERT ON public.collection_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_collection_insert();

-- Submitted details are immutable, and reviewed collections are final.
-- review_collection() only changes review fields on pending rows.
CREATE OR REPLACE FUNCTION public.protect_collection_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.client_record_id IS DISTINCT FROM OLD.client_record_id
    OR NEW.collector_id IS DISTINCT FROM OLD.collector_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.material IS DISTINCT FROM OLD.material
    OR NEW.reported_weight_kg IS DISTINCT FROM OLD.reported_weight_kg
    OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Submitted collection details cannot be changed';
  END IF;

  IF OLD.status <> 'pending'::public.collection_status THEN
    RAISE EXCEPTION 'Reviewed collections cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_collection_update() FROM PUBLIC;

CREATE TRIGGER collection_logs_protect_update
  BEFORE UPDATE ON public.collection_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_collection_update();

-- Audit every submission automatically. SECURITY DEFINER because clients
-- have no INSERT privilege on collection_events.
CREATE OR REPLACE FUNCTION public.record_collection_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.collection_events (
    collection_id,
    actor_id,
    action,
    details
  )
  VALUES (
    NEW.id,
    NEW.collector_id,
    'submitted',
    jsonb_build_object(
      'new_status', NEW.status,
      'client_record_id', NEW.client_record_id,
      'site_id', NEW.site_id,
      'material', NEW.material,
      'reported_weight_kg', NEW.reported_weight_kg,
      'captured_at', NEW.captured_at
    )
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_collection_submitted() FROM PUBLIC;

CREATE TRIGGER collection_logs_record_submitted
  AFTER INSERT ON public.collection_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.record_collection_submitted();

-- SECURITY HELPERS
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'admin'::public.user_role
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_site_member(p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_sites us ON us.user_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active = true
      AND us.site_id = p_site_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_review_site(p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    public.is_active_admin()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_sites us ON us.user_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'site_manager'::public.user_role
        AND p.is_active = true
        AND us.site_id = p_site_id
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_site_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_review_site(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_site_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_review_site(UUID) TO authenticated;

-- SERVER-SIDE COLLECTION REVIEW
CREATE OR REPLACE FUNCTION public.review_collection(
  p_collection_id UUID,
  p_approved BOOLEAN,
  p_verified_weight_kg NUMERIC DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_collection public.collection_logs%ROWTYPE;
  v_new_status public.collection_status;
  v_verified_weight_kg NUMERIC;
  v_rejection_reason TEXT;
BEGIN
  SELECT *
  INTO v_collection
  FROM public.collection_logs
  WHERE id = p_collection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection not found';
  END IF;

  IF NOT public.can_review_site(v_collection.site_id) THEN
    RAISE EXCEPTION 'You are not authorised to review this collection';
  END IF;

  IF v_collection.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending collections can be reviewed';
  END IF;

  IF p_approved AND (
    p_verified_weight_kg IS NULL OR p_verified_weight_kg <= 0
  ) THEN
    RAISE EXCEPTION 'A valid verified weight is required for approval';
  END IF;

  IF NOT p_approved AND (
    p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0
  ) THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  IF p_approved THEN
    v_new_status := 'approved'::public.collection_status;
    v_verified_weight_kg := p_verified_weight_kg;
    v_rejection_reason := NULL;
  ELSE
    v_new_status := 'rejected'::public.collection_status;
    v_verified_weight_kg := NULL;
    v_rejection_reason := trim(p_rejection_reason);
  END IF;

  UPDATE public.collection_logs
  SET
    status = v_new_status,
    verified_weight_kg = v_verified_weight_kg,
    verified_by = (SELECT auth.uid()),
    verified_at = NOW(),
    rejection_reason = v_rejection_reason,
    payment_eligible = p_approved
  WHERE id = p_collection_id;

  INSERT INTO public.collection_events (
    collection_id,
    actor_id,
    action,
    details
  )
  VALUES (
    p_collection_id,
    (SELECT auth.uid()),
    v_new_status::TEXT,
    jsonb_build_object(
      'previous_status', v_collection.status,
      'new_status', v_new_status,
      'reported_weight_kg', v_collection.reported_weight_kg,
      'verified_weight_kg', v_verified_weight_kg,
      'rejection_reason', v_rejection_reason,
      'payment_eligible', p_approved
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_collection(UUID, BOOLEAN, NUMERIC, TEXT)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.review_collection(UUID, BOOLEAN, NUMERIC, TEXT)
  TO authenticated;

-- ROW LEVEL SECURITY
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sme_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_events ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY profiles_read_self_or_admin
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_active_admin());

-- SITES
CREATE POLICY sites_read_assigned
  ON public.sites FOR SELECT TO authenticated
  USING (
    public.is_active_admin()
    OR public.is_active_site_member(id)
  );

CREATE POLICY sites_admin_manage
  ON public.sites FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- USER SITE ASSIGNMENTS
CREATE POLICY user_sites_read_self_or_admin
  ON public.user_sites FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_active_admin()
  );

CREATE POLICY user_sites_admin_manage
  ON public.user_sites FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- GROUPS
CREATE POLICY groups_read_authenticated
  ON public.sme_groups FOR SELECT TO authenticated
  USING (
    public.is_active_admin()
    OR public.is_active_site_member(site_id)
  );

CREATE POLICY groups_admin_manage
  ON public.sme_groups FOR ALL TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

-- COLLECTIONS
CREATE POLICY collections_read_permitted
  ON public.collection_logs FOR SELECT TO authenticated
  USING (
    collector_id = (SELECT auth.uid())
    OR public.is_active_admin()
    OR public.can_review_site(site_id)
    OR (
      status = 'approved'
      AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND p.role = 'recycler'::public.user_role
          AND p.is_active = true
          AND public.is_active_site_member(site_id)
      )
    )
  );

CREATE POLICY collectors_submit_collections
  ON public.collection_logs FOR INSERT TO authenticated
  WITH CHECK (
    collector_id = (SELECT auth.uid())
    AND status = 'pending'
    AND payment_eligible = false
    AND verified_weight_kg IS NULL
    AND verified_by IS NULL
    AND verified_at IS NULL
    AND rejection_reason IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'collector'::public.user_role
        AND p.is_active = true
    )
    AND public.is_active_site_member(site_id)
  );

-- No direct UPDATE or DELETE policy on collection_logs.
-- Reviews must go through review_collection().

-- EVIDENCE
CREATE POLICY evidence_read_permitted
  ON public.collection_evidence FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.collection_logs c
      WHERE c.id = collection_id
    )
  );

CREATE POLICY collectors_add_evidence
  ON public.collection_evidence FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.collection_logs c
      WHERE c.id = collection_id
        AND c.collector_id = (SELECT auth.uid())
        AND c.status = 'pending'
    )
  );

-- EVENTS
CREATE POLICY events_read_permitted
  ON public.collection_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.collection_logs c
      WHERE c.id = collection_id
    )
  );

-- TABLE PRIVILEGES
-- Remove any privileges added by default-privilege settings so the
-- column-level INSERT grant below is the only write path for clients.
REVOKE ALL ON public.collection_logs FROM anon, authenticated;
REVOKE ALL ON public.collection_events FROM anon, authenticated;

GRANT SELECT ON
  public.sites,
  public.profiles,
  public.sme_groups,
  public.user_sites,
  public.collection_logs,
  public.collection_evidence,
  public.collection_events
TO authenticated;

-- Collectors may only supply these columns. id, collector_id, status,
-- verification fields, payment_eligible and timestamps are server-set.
GRANT INSERT (
  client_record_id,
  site_id,
  material,
  reported_weight_kg,
  captured_at
) ON public.collection_logs TO authenticated;
GRANT INSERT ON public.collection_evidence TO authenticated;
