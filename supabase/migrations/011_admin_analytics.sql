-- ADMIN ANALYTICS
--
-- Three read-only aggregates for the admin Overview charts, computed in the
-- database so the phone only draws them:
--
--   admin_site_volume(p_from, p_to)       verified kg and approved deliveries per site
--   admin_material_breakdown(p_from, p_to) verified kg per material
--   admin_monthly_trend(p_until, p_months) verified kg, approved and rejected
--                                          deliveries per calendar month
--
-- Weights are the manager-verified breakdown lines (collection_verified_items)
-- of approved collections, as in recycler_material_totals() (008); collector-
-- reported weight is never used. A delivery counts on the day it was reviewed
-- (verified_at), as a calendar day in Africa/Nairobi time: the bounds are
-- converted to instants, [p_from 00:00 EAT, p_to + 1 day 00:00 EAT), so the
-- comparison is on verified_at itself. The app passes the dates (for example
-- this week's Monday and today), so the results do not depend on the
-- database clock and can be tested exactly.
--
-- Only aggregates are returned: no collector identity, photo, delivery id or
-- individual line. These are functions rather than views because a view runs
-- with its owner's rights (or needs security_invoker and its own RLS); each
-- function checks the caller first. Access: only an active administrator.
-- Anyone else gets SQLSTATE 42501 with a clear message, never an empty
-- result; anon cannot execute them at all.

CREATE OR REPLACE FUNCTION public.assert_active_admin_for_analytics()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active
      AND p.role = 'admin'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Only active administrators can view analytics'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Internal: called only by the functions below, never by clients.
REVOKE ALL ON FUNCTION public.assert_active_admin_for_analytics()
  FROM PUBLIC, anon, authenticated, service_role;

-- Verified kg and number of approved deliveries per site, for the reviewed
-- dates p_from..p_to (both required, inclusive). Every active site is listed
-- (0 when nothing was approved); an inactive site appears only when it has
-- approved deliveries in the range. Ordered by name.
CREATE OR REPLACE FUNCTION public.admin_site_volume(p_from DATE, p_to DATE)
RETURNS TABLE (
  site_id UUID,
  site_name TEXT,
  site_active BOOLEAN,
  verified_weight_kg NUMERIC,
  approved_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_active_admin_for_analytics();
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'Both dates are required' USING ERRCODE = '22023';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'The start date must not be after the end date' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH approved AS (
    SELECT c.id, c.site_id
    FROM public.collection_logs AS c
    WHERE c.status = 'approved'::public.collection_status
      AND c.verified_at >= (p_from::TIMESTAMP AT TIME ZONE 'Africa/Nairobi')
      AND c.verified_at < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Africa/Nairobi')
  ),
  per_site AS (
    SELECT a.site_id,
           count(DISTINCT a.id) AS deliveries,
           COALESCE(sum(vi.weight_kg), 0) AS weight_kg
    FROM approved AS a
    LEFT JOIN public.collection_verified_items AS vi ON vi.collection_id = a.id
    GROUP BY a.site_id
  )
  SELECT s.id,
         s.name,
         s.active,
         COALESCE(ps.weight_kg, 0)::NUMERIC(14, 2),
         COALESCE(ps.deliveries, 0)::BIGINT
  FROM public.sites AS s
  LEFT JOIN per_site AS ps ON ps.site_id = s.id
  WHERE s.active OR ps.site_id IS NOT NULL
  ORDER BY s.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_site_volume(DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_site_volume(DATE, DATE) TO authenticated;

-- Verified kg per material for the reviewed dates p_from..p_to (either may
-- be NULL: no bound). Only materials with verified weight in the range,
-- largest first (then the admin-defined order). MIXED is never verified
-- (010), so it never appears.
CREATE OR REPLACE FUNCTION public.admin_material_breakdown(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TABLE (
  material_code TEXT,
  display_name TEXT,
  verified_weight_kg NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_active_admin_for_analytics();
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'The start date must not be after the end date' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT m.code,
         m.display_name,
         sum(vi.weight_kg)::NUMERIC(14, 2)
  FROM public.collection_verified_items AS vi
  JOIN public.collection_logs AS c ON c.id = vi.collection_id
  JOIN public.materials AS m ON m.code = vi.material_code
  WHERE c.status = 'approved'::public.collection_status
    AND (p_from IS NULL
         OR c.verified_at >= (p_from::TIMESTAMP AT TIME ZONE 'Africa/Nairobi'))
    AND (p_to IS NULL
         OR c.verified_at < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Africa/Nairobi'))
  GROUP BY m.code, m.display_name, m.sort_order
  HAVING sum(vi.weight_kg) > 0
  ORDER BY sum(vi.weight_kg) DESC, m.sort_order, m.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_material_breakdown(DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_material_breakdown(DATE, DATE) TO authenticated;

-- One row per calendar month (Nairobi time), the p_months months ending with
-- the month of p_until, oldest first, including empty months:
-- verified kg and approved deliveries (by review date), and rejected
-- deliveries (by review date). p_months is 1-24.
CREATE OR REPLACE FUNCTION public.admin_monthly_trend(p_until DATE, p_months INTEGER DEFAULT 3)
RETURNS TABLE (
  month_start DATE,
  verified_weight_kg NUMERIC,
  approved_count BIGINT,
  rejected_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_last DATE;
  v_first DATE;
BEGIN
  PERFORM public.assert_active_admin_for_analytics();
  IF p_until IS NULL THEN
    RAISE EXCEPTION 'The end date is required' USING ERRCODE = '22023';
  END IF;
  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'The number of months must be between 1 and 24' USING ERRCODE = '22023';
  END IF;

  v_last := date_trunc('month', p_until)::DATE;
  v_first := (v_last - make_interval(months => p_months - 1))::DATE;

  RETURN QUERY
  WITH months AS (
    SELECT gs::DATE AS m
    FROM generate_series(v_first, v_last, INTERVAL '1 month') AS gs
  ),
  reviewed AS (
    SELECT c.id,
           c.status,
           date_trunc('month', c.verified_at AT TIME ZONE 'Africa/Nairobi')::DATE AS m
    FROM public.collection_logs AS c
    WHERE c.status IN ('approved'::public.collection_status, 'rejected'::public.collection_status)
      AND c.verified_at >= (v_first::TIMESTAMP AT TIME ZONE 'Africa/Nairobi')
      AND c.verified_at < (((v_last + INTERVAL '1 month')::DATE)::TIMESTAMP AT TIME ZONE 'Africa/Nairobi')
  ),
  weights AS (
    SELECT r.m, sum(vi.weight_kg) AS weight_kg
    FROM reviewed AS r
    JOIN public.collection_verified_items AS vi ON vi.collection_id = r.id
    WHERE r.status = 'approved'::public.collection_status
    GROUP BY r.m
  ),
  counts AS (
    SELECT r.m,
           count(*) FILTER (WHERE r.status = 'approved'::public.collection_status) AS approved,
           count(*) FILTER (WHERE r.status = 'rejected'::public.collection_status) AS rejected
    FROM reviewed AS r
    GROUP BY r.m
  )
  SELECT months.m,
         COALESCE(w.weight_kg, 0)::NUMERIC(14, 2),
         COALESCE(k.approved, 0)::BIGINT,
         COALESCE(k.rejected, 0)::BIGINT
  FROM months
  LEFT JOIN weights AS w ON w.m = months.m
  LEFT JOIN counts AS k ON k.m = months.m
  ORDER BY months.m;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_monthly_trend(DATE, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_monthly_trend(DATE, INTEGER) TO authenticated;
