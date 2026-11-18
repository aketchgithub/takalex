-- SITE LOCATIONS
--
-- An active administrator records where each site is, for the map: typed in,
-- or the phone's position while standing at the site. Coordinates are only
-- ever entered by an admin; nothing is invented, and a site without them has
-- no pin.
--
-- They are kept as plain latitude / longitude (WGS 84 degrees, rounded to 6
-- decimals, about 0.1 m). The PostGIS column sites.location (001) stays as it
-- is and unused: plain numbers are all the map needs and they can be checked
-- and tested everywhere (the SQL test harness has no PostGIS).
--
-- Clients still have no INSERT, UPDATE or DELETE on public.sites (001):
-- admin_set_site_location() is the only writer of the two columns, and every
-- change is recorded in site_events (009) as action 'located'.

ALTER TABLE public.sites
  ADD COLUMN latitude DOUBLE PRECISION,
  ADD COLUMN longitude DOUBLE PRECISION,
  ADD CONSTRAINT sites_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT sites_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT sites_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

-- AUDIT HISTORY: 'located' rows carry the coordinates before and after (NULL
-- = no location). Name and active flag are recorded unchanged, so every row
-- still says what the site was called at the time.
ALTER TABLE public.site_events
  ADD COLUMN old_latitude DOUBLE PRECISION,
  ADD COLUMN old_longitude DOUBLE PRECISION,
  ADD COLUMN new_latitude DOUBLE PRECISION,
  ADD COLUMN new_longitude DOUBLE PRECISION;

ALTER TABLE public.site_events DROP CONSTRAINT site_events_action_check;
ALTER TABLE public.site_events
  ADD CONSTRAINT site_events_action_check CHECK (action IN ('created', 'updated', 'located'));

ALTER TABLE public.site_events DROP CONSTRAINT site_events_old_values;
ALTER TABLE public.site_events
  ADD CONSTRAINT site_events_old_values CHECK (
    (action = 'created' AND old_name IS NULL AND old_active IS NULL)
    OR (action IN ('updated', 'located') AND old_name IS NOT NULL AND old_active IS NOT NULL)
  ),
  ADD CONSTRAINT site_events_coordinates CHECK (
    (action = 'located'
      AND (old_latitude IS NULL) = (old_longitude IS NULL)
      AND (new_latitude IS NULL) = (new_longitude IS NULL))
    OR (action <> 'located'
      AND old_latitude IS NULL AND old_longitude IS NULL
      AND new_latitude IS NULL AND new_longitude IS NULL)
  );

-- SET OR CLEAR A SITE'S LOCATION
-- Both coordinates, or both NULL to clear. Returns the site's id.
--   42501  the caller is not an active admin
--   22023  only one coordinate given, out of range, exactly 0,0 (a phone that
--          had no fix), or nothing would change
--   P0002  no such site
CREATE OR REPLACE FUNCTION public.admin_set_site_location(
  p_site_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_old public.sites%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Only an active administrator can manage sites'
      USING ERRCODE = '42501';
  END IF;

  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'Give both the latitude and the longitude, or neither'
      USING ERRCODE = '22023';
  END IF;

  IF p_latitude IS NOT NULL THEN
    IF p_latitude = 'NaN'::DOUBLE PRECISION OR p_longitude = 'NaN'::DOUBLE PRECISION
       OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'The latitude must be between -90 and 90 and the longitude between -180 and 180'
        USING ERRCODE = '22023';
    END IF;
    v_lat := round(p_latitude::NUMERIC, 6)::DOUBLE PRECISION;
    v_lng := round(p_longitude::NUMERIC, 6)::DOUBLE PRECISION;
    IF v_lat = 0 AND v_lng = 0 THEN
      RAISE EXCEPTION 'A location of exactly 0, 0 is not a real site'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Lock the row so two admins are applied one after the other.
  SELECT s.* INTO v_old
  FROM public.sites AS s
  WHERE s.id = p_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_old.latitude IS NOT DISTINCT FROM v_lat AND v_old.longitude IS NOT DISTINCT FROM v_lng THEN
    RAISE EXCEPTION 'Nothing to change'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.sites AS s
  SET latitude = v_lat,
      longitude = v_lng
  WHERE s.id = p_site_id;

  INSERT INTO public.site_events (
    site_id, actor_id, action, old_name, new_name, old_active, new_active,
    old_latitude, old_longitude, new_latitude, new_longitude
  )
  VALUES (
    p_site_id, v_admin_id, 'located', v_old.name, v_old.name, v_old.active, v_old.active,
    v_old.latitude, v_old.longitude, v_lat, v_lng
  );

  RETURN p_site_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_site_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_site_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION)
  TO authenticated;
