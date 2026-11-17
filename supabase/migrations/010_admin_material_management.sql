-- ADMIN MATERIAL MANAGEMENT
--
-- Active administrators add materials, edit them (name and what each role may
-- do with them), deactivate or reactivate them, change their order and delete
-- unused ones, only through the four functions below. Clients still have no
-- INSERT, UPDATE or DELETE on public.materials (001).
--
-- Decided 17 Nov 2026:
-- - A material used in any delivery or verified line can never be deleted
--   (the foreign keys in 001 also forbid it); it can only be deactivated, so
--   delivery and payment history stays correct. An unused one (for example a
--   typo) can be deleted.
-- - Inactive materials cannot be reported or used in a verified breakdown
--   (001), and recycler_material_totals() lists active materials only (008), so
--   a deactivated material's kilograms leave the recycler totals until it is
--   reactivated.
--
-- Rules the database keeps, whatever the client sends:
-- - Mixed may be reported but never verified or shown to recyclers, and it
--   cannot be deleted (CLAUDE.md product rules).
-- - At least one active material stays reportable and at least one stays
--   verifiable, so collectors and managers can always work.
-- - Codes never change (deliveries refer to them); a new material's code is
--   made from its name.
--
-- Every change is recorded in public.material_events (who, when, values
-- before and after), in the same transaction as the change.

-- NAMES AND THE MIXED RULE
-- Display names: trimmed, no repeated whitespace, no control characters,
-- unique ignoring case (001 already limits them to 1-60 characters). The six
-- materials from 001 satisfy every rule here.
ALTER TABLE public.materials
  ADD CONSTRAINT materials_display_name_format CHECK (
    display_name = btrim(display_name)
    AND display_name !~ '\s\s'
    AND display_name !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT materials_mixed_never_verified CHECK (
    code <> 'MIXED' OR (NOT is_verifiable AND NOT is_recycler_visible)
  );

CREATE UNIQUE INDEX materials_display_name_lower_key
  ON public.materials (lower(display_name));

-- AUDIT HISTORY
-- material_code has no foreign key, so the history of a deleted material
-- remains. old_values / new_values hold the row without its code.
--   created  old NULL, new set
--   updated  both set (one row per call)
--   moved    both set (sort_order only; one row for each of the two
--            materials that swapped places)
--   deleted  old set, new NULL
CREATE TABLE public.material_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'moved', 'deleted')),
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT material_events_values CHECK (
    (action = 'created' AND old_values IS NULL AND new_values IS NOT NULL)
    OR (action IN ('updated', 'moved') AND old_values IS NOT NULL AND new_values IS NOT NULL)
    OR (action = 'deleted' AND old_values IS NOT NULL AND new_values IS NULL)
  )
);

REVOKE ALL ON public.material_events FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX material_events_code_idx ON public.material_events (material_code, created_at);

ALTER TABLE public.material_events ENABLE ROW LEVEL SECURITY;

-- Only active admins read it; only the functions below write it.
CREATE POLICY material_events_read_admin
  ON public.material_events FOR SELECT TO authenticated
  USING (public.is_active_admin());

GRANT SELECT ON public.material_events TO authenticated;

-- Each function below starts with
--   LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;
-- which runs admin edits one after another, so the "at least one reportable
-- and one verifiable" checks and the sort order cannot race. It does not block
-- reads, or the key-share row locks taken when deliveries reference a
-- material.

-- ADD A MATERIAL
-- Returns the new code. Active, last in the order.
--   42501  not an active admin
--   22023  bad name or flags (empty, too long, control characters, a NULL flag,
--          recycler-visible but not verifiable, neither reportable nor
--          verifiable)
--   23505  a material has that name (ignoring case) or the code made from it
CREATE OR REPLACE FUNCTION public.admin_create_material(
  p_display_name TEXT,
  p_is_reportable BOOLEAN,
  p_is_verifiable BOOLEAN,
  p_is_recycler_visible BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_name TEXT;
  v_code TEXT;
  v_sort INTEGER;
  v_row public.materials;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can manage materials'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_reportable IS NULL OR p_is_verifiable IS NULL OR p_is_recycler_visible IS NULL THEN
    RAISE EXCEPTION 'Say what each role may do with the material'
      USING ERRCODE = '22023';
  END IF;

  v_name := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_display_name, ''), '\s+', ' ', 'g'));
  IF v_name = '' OR pg_catalog.char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'A material name must be 1 to 60 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A material name cannot contain control characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_is_recycler_visible AND NOT p_is_verifiable THEN
    RAISE EXCEPTION 'Recyclers only see verified material, so it must also be verifiable'
      USING ERRCODE = '22023';
  END IF;
  IF NOT p_is_reportable AND NOT p_is_verifiable THEN
    RAISE EXCEPTION 'A material must be reportable by collectors or verifiable by managers'
      USING ERRCODE = '22023';
  END IF;

  -- Code from the name: letters and digits, upper case, other runs as "_",
  -- starting with a letter, at most 32 characters (materials_code_format).
  v_code := pg_catalog.upper(pg_catalog.regexp_replace(v_name, '[^A-Za-z0-9]+', '_', 'g'));
  v_code := pg_catalog.btrim(v_code, '_');
  IF v_code !~ '^[A-Z]' THEN
    v_code := 'M_' || v_code;
  END IF;
  v_code := pg_catalog.rtrim(pg_catalog.left(v_code, 32), '_');

  LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1 FROM public.materials AS m
    WHERE pg_catalog.lower(m.display_name) = pg_catalog.lower(v_name)
  ) THEN
    RAISE EXCEPTION 'A material named "%" already exists', v_name
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.materials AS m WHERE m.code = v_code) THEN
    RAISE EXCEPTION 'A material with a very similar name already exists (code %)', v_code
      USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(MAX(m.sort_order), 0) + 10 INTO v_sort FROM public.materials AS m;

  INSERT INTO public.materials
    (code, display_name, is_reportable, is_verifiable, is_recycler_visible, is_active, sort_order)
  VALUES
    (v_code, v_name, p_is_reportable, p_is_verifiable, p_is_recycler_visible, TRUE, v_sort)
  RETURNING * INTO v_row;

  INSERT INTO public.material_events (material_code, actor_id, action, new_values)
  VALUES (v_code, v_admin_id, 'created', pg_catalog.to_jsonb(v_row) - 'code');

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_material(TEXT, BOOLEAN, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_material(TEXT, BOOLEAN, BOOLEAN, BOOLEAN)
  TO authenticated;

-- EDIT, DEACTIVATE OR REACTIVATE A MATERIAL
-- Sets the name, the three role flags and the active flag; pass the current
-- value of anything that should not change. Returns the code.
--   42501  not an active admin
--   P0002  no such material
--   22023  bad name or flags (as for adding), Mixed made verifiable or
--          recycler-visible, nothing would change, or the change would leave
--          no active reportable or no active verifiable material
--   23505  another material has that name (ignoring case)
CREATE OR REPLACE FUNCTION public.admin_update_material(
  p_code TEXT,
  p_display_name TEXT,
  p_is_reportable BOOLEAN,
  p_is_verifiable BOOLEAN,
  p_is_recycler_visible BOOLEAN,
  p_is_active BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_name TEXT;
  v_old public.materials;
  v_new public.materials;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can manage materials'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_reportable IS NULL OR p_is_verifiable IS NULL OR p_is_recycler_visible IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Say what each role may do with the material, and whether it is active'
      USING ERRCODE = '22023';
  END IF;

  LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_old FROM public.materials AS m WHERE m.code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Material not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_name := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_display_name, ''), '\s+', ' ', 'g'));
  IF v_name = '' OR pg_catalog.char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'A material name must be 1 to 60 characters'
      USING ERRCODE = '22023';
  END IF;
  IF v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A material name cannot contain control characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_is_recycler_visible AND NOT p_is_verifiable THEN
    RAISE EXCEPTION 'Recyclers only see verified material, so it must also be verifiable'
      USING ERRCODE = '22023';
  END IF;
  IF NOT p_is_reportable AND NOT p_is_verifiable THEN
    RAISE EXCEPTION 'A material must be reportable by collectors or verifiable by managers'
      USING ERRCODE = '22023';
  END IF;
  IF p_code = 'MIXED' AND (p_is_verifiable OR p_is_recycler_visible) THEN
    RAISE EXCEPTION 'Mixed can be reported but never verified or shown to recyclers'
      USING ERRCODE = '22023';
  END IF;

  IF v_name = v_old.display_name
     AND p_is_reportable = v_old.is_reportable
     AND p_is_verifiable = v_old.is_verifiable
     AND p_is_recycler_visible = v_old.is_recycler_visible
     AND p_is_active = v_old.is_active THEN
    RAISE EXCEPTION 'Nothing to change'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.materials AS m
    WHERE pg_catalog.lower(m.display_name) = pg_catalog.lower(v_name)
      AND m.code <> p_code
  ) THEN
    RAISE EXCEPTION 'A material named "%" already exists', v_name
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.materials AS m
  SET display_name = v_name,
      is_reportable = p_is_reportable,
      is_verifiable = p_is_verifiable,
      is_recycler_visible = p_is_recycler_visible,
      is_active = p_is_active
  WHERE m.code = p_code
  RETURNING * INTO v_new;

  -- Checked after the change, so the error rolls it back.
  IF NOT EXISTS (SELECT 1 FROM public.materials AS m WHERE m.is_active AND m.is_reportable) THEN
    RAISE EXCEPTION 'At least one active material must stay reportable by collectors'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials AS m WHERE m.is_active AND m.is_verifiable) THEN
    RAISE EXCEPTION 'At least one active material must stay verifiable by managers'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.material_events (material_code, actor_id, action, old_values, new_values)
  VALUES (p_code, v_admin_id, 'updated', pg_catalog.to_jsonb(v_old) - 'code', pg_catalog.to_jsonb(v_new) - 'code');

  RETURN p_code;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_material(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_material(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN)
  TO authenticated;

-- MOVE A MATERIAL UP OR DOWN THE LIST
-- Swaps its place with the neighbour in the order every screen uses
-- (sort_order, then code; active and inactive materials together).
--   42501  not an active admin
--   P0002  no such material
--   22023  direction is not 'up' or 'down', or it is already first or last
CREATE OR REPLACE FUNCTION public.admin_move_material(p_code TEXT, p_direction TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_self public.materials;
  v_other public.materials;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can manage materials'
      USING ERRCODE = '42501';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'Direction must be up or down'
      USING ERRCODE = '22023';
  END IF;

  LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_self FROM public.materials AS m WHERE m.code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Material not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_direction = 'up' THEN
    SELECT * INTO v_other FROM public.materials AS m
    WHERE (m.sort_order, m.code) < (v_self.sort_order, v_self.code)
    ORDER BY m.sort_order DESC, m.code DESC
    LIMIT 1;
  ELSE
    SELECT * INTO v_other FROM public.materials AS m
    WHERE (m.sort_order, m.code) > (v_self.sort_order, v_self.code)
    ORDER BY m.sort_order, m.code
    LIMIT 1;
  END IF;

  IF v_other.code IS NULL THEN
    RAISE EXCEPTION 'This material is already %', CASE WHEN p_direction = 'up' THEN 'first' ELSE 'last' END
      USING ERRCODE = '22023';
  END IF;

  -- Equal sort orders (possible only after hand edits) still end up apart.
  UPDATE public.materials AS m SET sort_order = CASE
      WHEN v_self.sort_order <> v_other.sort_order THEN v_other.sort_order
      WHEN p_direction = 'up' THEN v_other.sort_order - 1
      ELSE v_other.sort_order + 1
    END
  WHERE m.code = v_self.code;
  UPDATE public.materials AS m SET sort_order = v_self.sort_order
  WHERE m.code = v_other.code AND v_self.sort_order <> v_other.sort_order;

  INSERT INTO public.material_events (material_code, actor_id, action, old_values, new_values)
  SELECT m.code, v_admin_id, 'moved',
         pg_catalog.jsonb_build_object('sort_order', CASE WHEN m.code = v_self.code THEN v_self.sort_order ELSE v_other.sort_order END),
         pg_catalog.jsonb_build_object('sort_order', m.sort_order)
  FROM public.materials AS m
  WHERE m.code IN (v_self.code, v_other.code)
    AND m.sort_order <> CASE WHEN m.code = v_self.code THEN v_self.sort_order ELSE v_other.sort_order END;

  RETURN p_code;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_move_material(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_move_material(TEXT, TEXT)
  TO authenticated;

-- DELETE AN UNUSED MATERIAL
-- Returns the code.
--   42501  not an active admin
--   P0002  no such material
--   22023  Mixed, or the delete would leave no active reportable or no active
--          verifiable material
--   23503  used in a delivery or a verified line: deactivate it instead
CREATE OR REPLACE FUNCTION public.admin_delete_material(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_old public.materials;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can manage materials'
      USING ERRCODE = '42501';
  END IF;

  LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_old FROM public.materials AS m WHERE m.code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Material not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF p_code = 'MIXED' THEN
    RAISE EXCEPTION 'Mixed cannot be deleted'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.collection_logs AS c WHERE c.material_code = p_code)
     OR EXISTS (SELECT 1 FROM public.collection_verified_items AS v WHERE v.material_code = p_code) THEN
    RAISE EXCEPTION 'This material is used in deliveries; deactivate it instead'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.materials AS m WHERE m.code = p_code;

  IF NOT EXISTS (SELECT 1 FROM public.materials AS m WHERE m.is_active AND m.is_reportable) THEN
    RAISE EXCEPTION 'At least one active material must stay reportable by collectors'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials AS m WHERE m.is_active AND m.is_verifiable) THEN
    RAISE EXCEPTION 'At least one active material must stay verifiable by managers'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.material_events (material_code, actor_id, action, old_values)
  VALUES (p_code, v_admin_id, 'deleted', pg_catalog.to_jsonb(v_old) - 'code');

  RETURN p_code;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_material(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_material(TEXT)
  TO authenticated;
