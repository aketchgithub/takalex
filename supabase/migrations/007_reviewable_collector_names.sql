-- COLLECTOR NAMES FOR REVIEWERS (docs/demo-plan.md, Phase 3)
--
-- A site manager receiving a delivery needs to see who brought it, but
-- profiles_read_self_or_admin (001) lets a user read only their own profile
-- (admins read all). Rather than widen that policy, this narrow function
-- returns only the id and full_name of the requested collectors, and only
-- for collectors who have at least one delivery at a site the caller can
-- review (can_review_site: an active site manager assigned to that site, or
-- an active admin). No phone, email, role or active flag is returned.
--
-- A manager at one site learns nothing about collectors who only deliver to
-- other sites; collectors, recyclers, inactive managers and anon get no rows
-- (anon cannot execute it at all). Ids that do not qualify are silently
-- omitted, so the result reveals nothing about whether they exist.
CREATE OR REPLACE FUNCTION public.reviewable_collector_names(p_collector_ids UUID[])
RETURNS TABLE (collector_id UUID, full_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.full_name
  FROM public.profiles AS p
  WHERE p.id = ANY (p_collector_ids)
    AND EXISTS (
      SELECT 1
      FROM public.collection_logs AS c
      WHERE c.collector_id = p.id
        AND public.can_review_site(c.site_id)
    );
$$;

REVOKE ALL ON FUNCTION public.reviewable_collector_names(UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reviewable_collector_names(UUID[])
  TO authenticated;
