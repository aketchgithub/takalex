CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- ENUMS
CREATE TYPE public.user_role AS ENUM (
  'collector',
  'site_manager',
  'recycler',
  'admin'
);

CREATE TYPE public.collection_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

-- MATERIALS (lookup table, so types can be added without a schema change)
--   is_reportable       collectors may report it for a whole delivery
--   is_verifiable       site managers may use it in a verified breakdown
--   is_recycler_visible shown in recycler totals (only verified lines are
--                       counted, so it requires is_verifiable)
-- Clients can read it; nobody but the owner can change it.
CREATE TABLE public.materials (
  code TEXT PRIMARY KEY
    CONSTRAINT materials_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  display_name TEXT NOT NULL
    CONSTRAINT materials_display_name_length
      CHECK (length(trim(display_name)) BETWEEN 1 AND 60),
  is_reportable BOOLEAN NOT NULL DEFAULT false,
  is_verifiable BOOLEAN NOT NULL DEFAULT false,
  is_recycler_visible BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT materials_recycler_visible_requires_verifiable
    CHECK (NOT is_recycler_visible OR is_verifiable)
);

REVOKE ALL ON public.materials FROM PUBLIC, anon, authenticated, service_role;

-- Reference data (not test data): reaches every environment with this
-- migration. MIXED may be reported but never verified or shown to recyclers.
-- No OTHER/residue type until Chemolex confirms it is needed.
INSERT INTO public.materials
  (code, display_name, is_reportable, is_verifiable, is_recycler_visible, sort_order)
VALUES
  ('PET',          'PET',          true, true,  true,  10),
  ('PP',           'PP',           true, true,  true,  20),
  ('HDPE',         'HDPE',         true, true,  true,  30),
  ('LDPE',         'LDPE',         true, true,  true,  40),
  ('PLASTIC_BAGS', 'Plastic bags', true, true,  true,  50),
  ('MIXED',        'Mixed',        true, false, false, 60);

-- SITES
-- Each waste picker group has the same name as its site (confirmed with
-- Chemolex, 7 Nov), so a collector's site is their group: there is no
-- separate groups table. The real sites are inserted by 005_sites.sql.
-- location stays NULL until real coordinates are supplied.
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  location extensions.geography(POINT, 4326),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON public.sites FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX sites_location_idx
  ON public.sites USING GIST (location);

-- USER PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  role public.user_role NOT NULL DEFAULT 'collector',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated, service_role;

-- MANY-TO-MANY USER/SITE ASSIGNMENTS
CREATE TABLE public.user_sites (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES public.profiles(id),
  PRIMARY KEY (user_id, site_id)
);

REVOKE ALL ON public.user_sites FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX user_sites_site_id_idx ON public.user_sites(site_id);

-- COLLECTION RECORDS
-- Collectors may only supply: client_record_id, site_id, material_code,
-- reported_weight_kg, captured_at and the device location fields (see
-- column grants below). Everything else is set by defaults, triggers or
-- review_collection().
CREATE TABLE public.collection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Client-generated offline idempotency key.
  client_record_id UUID NOT NULL,
  collector_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES public.profiles(id),
  site_id UUID NOT NULL REFERENCES public.sites(id),
  -- Collector-reported material for the whole delivery (may be MIXED).
  -- Must be active and reportable (enforce_collection_insert).
  material_code TEXT NOT NULL REFERENCES public.materials(code),
  -- Collector-reported weight. Never used for payout.
  reported_weight_kg NUMERIC(10,2) NOT NULL
    CHECK (reported_weight_kg > 0),
  -- Site-manager-verified total: the sum of this collection's
  -- collection_verified_items lines. Set only by review_collection().
  verified_weight_kg NUMERIC(10,2)
    CHECK (verified_weight_kg IS NULL OR verified_weight_kg > 0),
  status public.collection_status NOT NULL DEFAULT 'pending',
  payment_eligible BOOLEAN NOT NULL DEFAULT false,
  -- Device-reported capture time (untrusted; useful for offline records).
  -- submitted_at and created_at are server-set trusted timestamps.
  captured_at TIMESTAMPTZ,
  -- Device location at capture (untrusted device-provided evidence, NOT a
  -- verified site location). Optional: NULL when permission is denied.
  device_latitude DOUBLE PRECISION
    CONSTRAINT collection_device_latitude_range
      CHECK (device_latitude IS NULL OR device_latitude BETWEEN -90 AND 90),
  device_longitude DOUBLE PRECISION
    CONSTRAINT collection_device_longitude_range
      CHECK (device_longitude IS NULL OR device_longitude BETWEEN -180 AND 180),
  -- Reported accuracy radius in metres. Finite and >= 0 (rejects NaN and
  -- Infinity), and only meaningful together with coordinates.
  device_accuracy_m DOUBLE PRECISION
    CONSTRAINT collection_device_accuracy_range
      CHECK (device_accuracy_m IS NULL
             OR (device_accuracy_m >= 0 AND device_accuracy_m < 'Infinity'::DOUBLE PRECISION)),
  CONSTRAINT collection_device_coordinates_pair
    CHECK ((device_latitude IS NULL) = (device_longitude IS NULL)),
  CONSTRAINT collection_device_accuracy_needs_coordinates
    CHECK (device_accuracy_m IS NULL OR device_latitude IS NOT NULL),
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

REVOKE ALL ON public.collection_logs FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX collection_logs_collector_idx
  ON public.collection_logs(collector_id);

CREATE INDEX collection_logs_site_status_idx
  ON public.collection_logs(site_id, status);

CREATE INDEX collection_logs_submitted_at_idx
  ON public.collection_logs(submitted_at DESC);

-- PHOTO EVIDENCE
-- Device location lives on collection_logs (one per delivery), not here.
-- Collectors may only supply collection_id, storage_path, content_type and
-- captured_at (see column grants below); uploaded_at is always server-set
-- (enforce_collection_evidence_insert). The INSERT policy
-- (collectors_add_evidence) is created in 006_evidence_storage.sql, next to
-- the storage bucket it depends on: until then no client can insert.
CREATE TABLE public.collection_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL
    REFERENCES public.collection_logs(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  captured_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON public.collection_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX collection_evidence_collection_idx
  ON public.collection_evidence(collection_id);

-- VERIFIED BREAKDOWN
-- One line per verified material per collection, recorded by the site
-- manager after sorting and weighing. Written only by review_collection()
-- (no client write grants); lines are never updated (see trigger below).
-- The collector's reported material and weight on collection_logs are
-- separate and unchanged.
CREATE TABLE public.collection_verified_items (
  collection_id UUID NOT NULL
    REFERENCES public.collection_logs(id) ON DELETE CASCADE,
  material_code TEXT NOT NULL REFERENCES public.materials(code),
  weight_kg NUMERIC(10,2) NOT NULL
    CONSTRAINT collection_verified_items_weight_positive CHECK (weight_kg > 0),
  CONSTRAINT collection_verified_items_pkey
    PRIMARY KEY (collection_id, material_code)
);

REVOKE ALL ON public.collection_verified_items FROM PUBLIC, anon, authenticated, service_role;

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

REVOKE ALL ON public.collection_events FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX collection_events_collection_idx
  ON public.collection_events(collection_id, created_at);

-- COLLECTION INTEGRITY TRIGGERS
-- Force workflow fields and trusted timestamps on every insert,
-- whatever the caller supplied, and only accept an active, reportable
-- material. (A NULL material is left to the NOT NULL constraint.)
CREATE OR REPLACE FUNCTION public.enforce_collection_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.material_code IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.materials AS m
    WHERE m.code = NEW.material_code
      AND m.is_active
      AND m.is_reportable
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format('Material %s cannot be reported', NEW.material_code);
  END IF;

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

-- Trigger function: no EXECUTE for anyone (not checked when a trigger fires).
REVOKE ALL ON FUNCTION public.enforce_collection_insert()
  FROM PUBLIC, anon, authenticated, service_role;

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
    OR NEW.material_code IS DISTINCT FROM OLD.material_code
    OR NEW.reported_weight_kg IS DISTINCT FROM OLD.reported_weight_kg
    OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
    OR NEW.device_latitude IS DISTINCT FROM OLD.device_latitude
    OR NEW.device_longitude IS DISTINCT FROM OLD.device_longitude
    OR NEW.device_accuracy_m IS DISTINCT FROM OLD.device_accuracy_m
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

-- Trigger function: no EXECUTE for anyone (not checked when a trigger fires).
REVOKE ALL ON FUNCTION public.protect_collection_update()
  FROM PUBLIC, anon, authenticated, service_role;

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
      'material_code', NEW.material_code,
      'reported_weight_kg', NEW.reported_weight_kg,
      'captured_at', NEW.captured_at,
      'device_latitude', NEW.device_latitude,
      'device_longitude', NEW.device_longitude,
      'device_accuracy_m', NEW.device_accuracy_m
    )
  );

  RETURN NULL;
END;
$$;

-- Trigger function: no EXECUTE for anyone (not checked when a trigger fires).
REVOKE ALL ON FUNCTION public.record_collection_submitted()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER collection_logs_record_submitted
  AFTER INSERT ON public.collection_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.record_collection_submitted();

-- Verified breakdown lines are never changed once written, and can only be
-- added to a collection that is still pending (review_collection() inserts
-- them before it changes the status) with an active, verifiable material.
-- This applies to every role, including the owner; clients have no write
-- privileges at all.
CREATE OR REPLACE FUNCTION public.protect_collection_verified_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Verified breakdown lines cannot be changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.collection_logs AS c
    WHERE c.id = NEW.collection_id
      AND c.status = 'pending'::public.collection_status
  ) THEN
    RAISE EXCEPTION 'Verified breakdown lines can only be added to a pending collection';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.materials AS m
    WHERE m.code = NEW.material_code
      AND m.is_active
      AND m.is_verifiable
  ) THEN
    RAISE EXCEPTION 'Material % cannot be used in a verified breakdown',
      NEW.material_code;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger function: no EXECUTE for anyone (not checked when a trigger fires).
REVOKE ALL ON FUNCTION public.protect_collection_verified_item()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER collection_verified_items_protect
  BEFORE INSERT OR UPDATE ON public.collection_verified_items
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_collection_verified_item();

-- Evidence upload time is always the server's, whatever the caller (even the
-- owner) supplied. Clients cannot supply it anyway (no column grant).
CREATE OR REPLACE FUNCTION public.enforce_collection_evidence_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.uploaded_at := NOW();
  RETURN NEW;
END;
$$;

-- Trigger function: no EXECUTE for anyone (not checked when a trigger fires).
REVOKE ALL ON FUNCTION public.enforce_collection_evidence_insert()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER collection_evidence_enforce_insert
  BEFORE INSERT ON public.collection_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_collection_evidence_insert();

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

REVOKE ALL ON FUNCTION public.is_active_admin()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_admin()
  TO authenticated;

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

REVOKE ALL ON FUNCTION public.is_active_site_member(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_site_member(UUID)
  TO authenticated;

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

REVOKE ALL ON FUNCTION public.can_review_site(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_review_site(UUID)
  TO authenticated;

-- SERVER-SIDE COLLECTION REVIEW
-- p_verified_items: JSON array of {"material_code": text, "weight_kg": number}.
--   Approval: at least one line; each line has exactly those two keys; the
--   material exists, is active and verifiable, and appears once; the weight
--   is a JSON number > 0 with at most 2 decimal places (never rounded).
--   At least one evidence row must exist. verified_weight_kg is computed
--   here as the sum of the stored lines; no client total is accepted.
--   Rejection: no lines (NULL or []) and a non-blank reason.
-- Everything runs in the caller's single transaction: any error rolls back
-- the status change, the lines and the audit event together.
CREATE OR REPLACE FUNCTION public.review_collection(
  p_collection_id UUID,
  p_approved BOOLEAN,
  p_verified_items JSONB DEFAULT NULL,
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
  v_item JSONB;
  v_code TEXT;
  v_weight NUMERIC;
  v_seen TEXT[] := '{}';
  v_material public.materials%ROWTYPE;
  v_items_detail JSONB;
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

  IF p_approved IS NULL THEN
    RAISE EXCEPTION 'An approval decision is required';
  END IF;

  IF p_approved THEN
    IF p_verified_items IS NULL
      OR jsonb_typeof(p_verified_items) <> 'array'
    THEN
      RAISE EXCEPTION 'The verified breakdown must be a JSON array of lines';
    END IF;

    IF jsonb_array_length(p_verified_items) = 0 THEN
      RAISE EXCEPTION 'At least one verified breakdown line is required for approval';
    END IF;

    FOR v_item IN
      SELECT e.value FROM jsonb_array_elements(p_verified_items) AS e(value)
    LOOP
      IF jsonb_typeof(v_item) <> 'object'
        OR NOT (v_item ? 'material_code' AND v_item ? 'weight_kg')
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_item) AS k(key)
          WHERE k.key NOT IN ('material_code', 'weight_kg')
        )
      THEN
        RAISE EXCEPTION 'Each verified breakdown line must have exactly material_code and weight_kg';
      END IF;

      IF jsonb_typeof(v_item -> 'material_code') <> 'string' THEN
        RAISE EXCEPTION 'material_code must be a string';
      END IF;
      v_code := v_item ->> 'material_code';

      IF jsonb_typeof(v_item -> 'weight_kg') <> 'number' THEN
        RAISE EXCEPTION 'weight_kg for % must be a number', v_code;
      END IF;
      v_weight := (v_item ->> 'weight_kg')::NUMERIC;

      IF v_weight <= 0 THEN
        RAISE EXCEPTION 'weight_kg for % must be greater than zero', v_code;
      END IF;

      IF v_weight <> round(v_weight, 2) THEN
        RAISE EXCEPTION 'weight_kg for % must have at most 2 decimal places', v_code;
      END IF;

      IF v_weight > 99999999.99 THEN
        RAISE EXCEPTION 'weight_kg for % is too large', v_code;
      END IF;

      IF v_code = ANY (v_seen) THEN
        RAISE EXCEPTION 'Material % appears more than once in the verified breakdown', v_code;
      END IF;
      v_seen := v_seen || v_code;

      SELECT * INTO v_material FROM public.materials AS m WHERE m.code = v_code;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown material code %', v_code;
      END IF;
      IF NOT (v_material.is_active AND v_material.is_verifiable) THEN
        RAISE EXCEPTION 'Material % cannot be used in a verified breakdown', v_code;
      END IF;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM public.collection_evidence AS ev
      WHERE ev.collection_id = p_collection_id
    ) THEN
      RAISE EXCEPTION 'At least one photo evidence record is required for approval';
    END IF;

    v_new_status := 'approved'::public.collection_status;
    v_rejection_reason := NULL;
  ELSE
    IF p_verified_items IS NOT NULL AND p_verified_items <> '[]'::JSONB THEN
      RAISE EXCEPTION 'A rejected collection cannot have a verified breakdown';
    END IF;

    IF p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0 THEN
      RAISE EXCEPTION 'A rejection reason is required';
    END IF;

    v_new_status := 'rejected'::public.collection_status;
    v_rejection_reason := trim(p_rejection_reason);
  END IF;

  -- Lines first (the protect trigger requires a pending collection), then
  -- the total from what was actually stored.
  IF p_approved THEN
    INSERT INTO public.collection_verified_items (
      collection_id,
      material_code,
      weight_kg
    )
    SELECT
      p_collection_id,
      e.value ->> 'material_code',
      (e.value ->> 'weight_kg')::NUMERIC
    FROM jsonb_array_elements(p_verified_items) AS e(value);

    SELECT sum(vi.weight_kg)
    INTO v_verified_weight_kg
    FROM public.collection_verified_items AS vi
    WHERE vi.collection_id = p_collection_id;

    IF v_verified_weight_kg > 99999999.99 THEN
      RAISE EXCEPTION 'The verified total is too large';
    END IF;
  ELSE
    v_verified_weight_kg := NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('material_code', vi.material_code, 'weight_kg', vi.weight_kg)
      ORDER BY m.sort_order, vi.material_code
    ),
    '[]'::JSONB
  )
  INTO v_items_detail
  FROM public.collection_verified_items AS vi
  JOIN public.materials AS m ON m.code = vi.material_code
  WHERE vi.collection_id = p_collection_id;

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
      'reported_material_code', v_collection.material_code,
      'reported_weight_kg', v_collection.reported_weight_kg,
      'verified_items', v_items_detail,
      'verified_weight_kg', v_verified_weight_kg,
      'rejection_reason', v_rejection_reason,
      'payment_eligible', p_approved
    )
  );
END;
$$;

-- Only this signature exists; no other review_collection overload is
-- created anywhere.
REVOKE ALL ON FUNCTION public.review_collection(UUID, BOOLEAN, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_collection(UUID, BOOLEAN, JSONB, TEXT)
  TO authenticated;

-- ROW LEVEL SECURITY
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_verified_items ENABLE ROW LEVEL SECURITY;

-- MATERIALS
-- Reference data: every signed-in user may read every row (inactive rows
-- are still needed to label historical records). No write policies.
CREATE POLICY materials_read_authenticated
  ON public.materials FOR SELECT TO authenticated
  USING (true);

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

-- COLLECTIONS
-- Readable by the owning collector, managers who can review the site and
-- active admins. Recyclers read no individual collection, evidence, event
-- or verified line; they will only see aggregate totals (later migration).
CREATE POLICY collections_read_permitted
  ON public.collection_logs FOR SELECT TO authenticated
  USING (
    collector_id = (SELECT auth.uid())
    OR public.can_review_site(site_id)
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
-- Same audience as the parent collection, stated explicitly rather than
-- inherited from collection_logs RLS. Recyclers have no access.
CREATE POLICY evidence_read_permitted
  ON public.collection_evidence FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.collection_logs c
      WHERE c.id = collection_id
        AND (
          c.collector_id = (SELECT auth.uid())
          OR public.can_review_site(c.site_id)
        )
    )
  );

-- INSERT: collectors_add_evidence, in 006_evidence_storage.sql.

-- VERIFIED BREAKDOWN
-- Readable by the owning collector, managers who can review the site and
-- active admins (can_review_site includes them). Recyclers have no access:
-- they will only see aggregate totals. No write policies.
CREATE POLICY verified_items_read_permitted
  ON public.collection_verified_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.collection_logs c
      WHERE c.id = collection_id
        AND (
          c.collector_id = (SELECT auth.uid())
          OR public.can_review_site(c.site_id)
        )
    )
  );

-- EVENTS
-- Same audience as the parent collection, stated explicitly. No recyclers.
CREATE POLICY events_read_permitted
  ON public.collection_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.collection_logs c
      WHERE c.id = collection_id
        AND (
          c.collector_id = (SELECT auth.uid())
          OR public.can_review_site(c.site_id)
        )
    )
  );

-- TABLE PRIVILEGES
-- Every table above starts with REVOKE ALL from PUBLIC, anon, authenticated
-- and service_role, so these grants are the complete list, whatever the
-- project's default privileges are. RLS policies then limit the rows.

-- authenticated: read, limited by RLS.
GRANT SELECT ON
  public.sites,
  public.profiles,
  public.user_sites,
  public.collection_logs,
  public.collection_evidence,
  public.collection_events,
  public.materials,
  public.collection_verified_items
TO authenticated;

-- Collectors may only supply these columns. id, collector_id, status,
-- verification fields, payment_eligible and timestamps are server-set.
GRANT INSERT (
  client_record_id,
  site_id,
  material_code,
  reported_weight_kg,
  captured_at,
  device_latitude,
  device_longitude,
  device_accuracy_m
) ON public.collection_logs TO authenticated;
-- Evidence: id and uploaded_at are server-set.
GRANT INSERT (
  collection_id,
  storage_path,
  content_type,
  captured_at
) ON public.collection_evidence TO authenticated;

-- service_role (Edge Functions). It bypasses RLS, so these grants are its
-- only limit. Read-only: every write goes through a SECURITY DEFINER RPC.
--   profiles   - confirm the caller is an active admin; read an invitee's
--                profile state before reissue/accept.
--   sites      - validate requested site ids and name sites in emails.
--   user_sites - read an invitee's current assignments for reissue/accept.
-- Nothing on collection_logs, collection_evidence, collection_events,
-- materials or collection_verified_items: no Edge Function needs them.
GRANT SELECT ON
  public.profiles,
  public.sites,
  public.user_sites
TO service_role;

-- DEFAULT PRIVILEGES
-- Removes schema-level default EXECUTE grants to anon, authenticated and
-- service_role for functions this role creates later in public.
-- It does NOT remove PostgreSQL's built-in PUBLIC EXECUTE default (a
-- schema-scoped REVOKE cannot override it), so every new function must
-- REVOKE/GRANT explicitly beside its definition; 60_privileges fails if one
-- doesn't.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
-- Tables and sequences this role creates later in public get no grants for
-- anon, authenticated or service_role (Supabase's local stack grants them
-- ALL by default). PostgreSQL has no PUBLIC default for these, so this
-- closes them fully; new objects still need explicit GRANTs.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
