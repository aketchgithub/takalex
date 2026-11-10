-- RECYCLER MATERIAL TOTALS (docs/demo-plan.md, section 0 and Phase 5)
--
-- Recyclers see the sorted material available by type with its verified
-- weight: the sum of the verified breakdown lines (collection_verified_items)
-- of approved collections. There is no purchasing, stock deduction or
-- pricing, so totals only accumulate; the app labels them "approved,
-- verified material" rather than live stock.
--
-- recycler_material_totals(p_site_id, p_from, p_to) returns one row per
-- active, recycler-visible material (0 where nothing has been verified), in
-- the admin-defined order. MIXED and any other material that is not
-- recycler-visible never appears. Only aggregates are returned: no collector
-- identity, photo, delivery id or individual line.
--
--   p_site_id  only collections at this site (NULL = all sites)
--   p_from     only collections verified on or after this date
--   p_to       only collections verified on or before this date
--
-- Dates are calendar days in Africa/Nairobi (EAT) time: a delivery verified
-- at 23:30 Nairobi time on 30 Nov counts for 30 Nov, although it is 20:30
-- UTC. The bounds are converted to instants so the comparison is on
-- verified_at itself: [p_from 00:00 EAT, p_to + 1 day 00:00 EAT).
--
-- Access: only an active recycler or an active admin. Everyone else who can
-- call it (other signed-in roles, inactive users) gets a clear refusal,
-- SQLSTATE 42501 ("insufficient_privilege", HTTP 403 through PostgREST),
-- rather than an empty result that would look like "no material yet". anon
-- cannot execute it at all.
CREATE OR REPLACE FUNCTION public.recycler_material_totals(
  p_site_id UUID DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS TABLE (
  material_code TEXT,
  display_name TEXT,
  sort_order INTEGER,
  verified_weight_kg NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active
      AND p.role IN ('recycler'::public.user_role, 'admin'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Only active recyclers and administrators can view material totals'
      USING ERRCODE = '42501';
  END IF;

  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'The start date must not be after the end date'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    m.code,
    m.display_name,
    m.sort_order,
    COALESCE(totals.weight_kg, 0)::NUMERIC(14, 2)
  FROM public.materials AS m
  LEFT JOIN (
    SELECT vi.material_code AS code, sum(vi.weight_kg) AS weight_kg
    FROM public.collection_verified_items AS vi
    JOIN public.collection_logs AS c ON c.id = vi.collection_id
    WHERE c.status = 'approved'::public.collection_status
      AND (p_site_id IS NULL OR c.site_id = p_site_id)
      AND (p_from IS NULL
           OR c.verified_at >= (p_from::TIMESTAMP AT TIME ZONE 'Africa/Nairobi'))
      AND (p_to IS NULL
           OR c.verified_at < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Africa/Nairobi'))
    GROUP BY vi.material_code
  ) AS totals ON totals.code = m.code
  WHERE m.is_active
    AND m.is_recycler_visible
  ORDER BY m.sort_order, m.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.recycler_material_totals(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recycler_material_totals(UUID, DATE, DATE)
  TO authenticated;
