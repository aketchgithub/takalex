-- SITE LOCATIONS (migration 012): admin_set_site_location() sets or clears a
-- site's latitude / longitude, records a 'located' row in site_events, and is
-- the only way to write them.
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');
  PERFORM t.mkuser('admin_off', 'adminoff@example.test', true);  -- inactive admin
  PERFORM t.set_profile(t.id('admin_off'), 'admin', false);
  PERFORM t.mkuser('c1', 'c1@example.test', true);               -- collector, site 1
  PERFORM t.set_profile(t.id('c1'), 'collector', true);
  PERFORM t.assign(t.id('c1'), t.site(1));
  PERFORM t.mkuser('m1', 'm1@example.test', true);               -- manager, site 1
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.assign(t.id('m1'), t.site(1));
  PERFORM t.mkuser('r1', 'r1@example.test', true);               -- recycler
  PERFORM t.set_profile(t.id('r1'), 'recycler', true);
END $$;

CREATE FUNCTION t.locate_as(p_user UUID, p_site UUID, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  PERFORM t.as_user(p_user);
  v := public.admin_set_site_location(p_site, p_lat, p_lng);
  PERFORM t.become('postgres');
  RETURN v;
END $$;

-- 'ok' or the SQLSTATE and message of the failure.
CREATE FUNCTION t.try_locate(p_user UUID, p_site UUID, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM t.locate_as(p_user, p_site, p_lat, p_lng);
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.become('postgres');
    RETURN SQLSTATE || ' ' || SQLERRM;
  END;
END $$;

CREATE FUNCTION t.coords(p_site UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE(latitude::text, 'null') || ',' || COALESCE(longitude::text, 'null')
  FROM public.sites WHERE id = p_site
$$;

-- The site's only 'located' event that replaced p_old_lat (NULL = from no
-- location). created_at is the transaction time, so several events in one
-- test cannot be told apart by time.
CREATE FUNCTION t.located_from(p_site UUID, p_old_lat DOUBLE PRECISION) RETURNS public.site_events
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT * FROM public.site_events
  WHERE site_id = p_site AND action = 'located' AND old_latitude IS NOT DISTINCT FROM p_old_lat
$$;

CREATE FUNCTION t.event_count() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.site_events
$$;

-- 1: set a location, rounded to 6 decimals, with one 'located' audit row
DO $$
DECLARE e public.site_events; v_name TEXT;
BEGIN
  ASSERT t.coords(t.site(1)) = 'null,null', 'starts without a location';
  ASSERT t.locate_as(t.id('admin'), t.site(1), -1.26669912345, 36.8833301) = t.site(1);
  ASSERT t.coords(t.site(1)) = '-1.266699,36.88333', 'stored: ' || t.coords(t.site(1));
  SELECT name INTO v_name FROM public.sites WHERE id = t.site(1);
  e := t.located_from(t.site(1), NULL);
  ASSERT e.action = 'located' AND e.actor_id = t.id('admin'), 'action/actor';
  ASSERT e.old_name = v_name AND e.new_name = v_name AND e.old_active AND e.new_active, 'name and active recorded unchanged';
  ASSERT e.old_latitude IS NULL AND e.old_longitude IS NULL, 'no location before';
  ASSERT e.new_latitude = -1.266699 AND e.new_longitude = 36.88333, 'new coordinates';
  PERFORM t.pass('an active admin sets a location, rounded to 6 decimals, with one located audit row naming the site');
END $$;

-- 2: move and clear, each recording the values replaced
DO $$
DECLARE e public.site_events;
BEGIN
  PERFORM t.locate_as(t.id('admin'), t.site(1), -1.25, 36.9);
  e := t.located_from(t.site(1), -1.266699);
  ASSERT e.old_latitude = -1.266699 AND e.old_longitude = 36.88333 AND e.new_latitude = -1.25 AND e.new_longitude = 36.9, 'move';
  PERFORM t.locate_as(t.id('admin'), t.site(1), NULL, NULL);
  ASSERT t.coords(t.site(1)) = 'null,null', 'cleared';
  e := t.located_from(t.site(1), -1.25);
  ASSERT e.old_latitude = -1.25 AND e.old_longitude = 36.9 AND e.new_latitude IS NULL AND e.new_longitude IS NULL, 'clear';
  PERFORM t.pass('moving and clearing a location record the coordinates before and after');
END $$;

-- 3: input checks (22023), with nothing changed or recorded
DO $$
DECLARE v_events BIGINT := t.event_count(); v TEXT;
BEGIN
  v := t.try_locate(t.id('admin'), t.site(2), -1.2, NULL);
  ASSERT v = '22023 Give both the latitude and the longitude, or neither', v;
  v := t.try_locate(t.id('admin'), t.site(2), 91, 36);
  ASSERT v LIKE '22023 The latitude must be between%', v;
  v := t.try_locate(t.id('admin'), t.site(2), -1.2, 181);
  ASSERT v LIKE '22023 The latitude must be between%', v;
  v := t.try_locate(t.id('admin'), t.site(2), 'NaN', 36);
  ASSERT v LIKE '22023 The latitude must be between%', v;
  v := t.try_locate(t.id('admin'), t.site(2), 0.0000001, -0.0000002);
  ASSERT v = '22023 A location of exactly 0, 0 is not a real site', v;
  v := t.try_locate(t.id('admin'), t.site(2), NULL, NULL);
  ASSERT v = '22023 Nothing to change', 'clearing a site without a location: ' || v;
  PERFORM t.locate_as(t.id('admin'), t.site(2), -1.2, 36.8);
  v := t.try_locate(t.id('admin'), t.site(2), -1.2000001, 36.8000004);
  ASSERT v = '22023 Nothing to change', 'same after rounding: ' || v;
  v := t.try_locate(t.id('admin'), gen_random_uuid(), -1.2, 36.8);
  ASSERT v = 'P0002 Site not found', v;
  ASSERT t.coords(t.site(2)) = '-1.2,36.8', t.coords(t.site(2));
  ASSERT t.event_count() = v_events + 1, 'only the one valid call was recorded';
  PERFORM t.pass('one coordinate, out of range, NaN, 0,0 and no-change are refused with 22023; an unknown site with P0002; nothing is recorded for a refusal');
END $$;

-- 4: only an active admin
DO $$
DECLARE r RECORD; v TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('collector', t.id('c1')), ('site manager', t.id('m1')),
                                 ('recycler', t.id('r1')), ('inactive admin', t.id('admin_off'))) AS x(label, uid) LOOP
    v := t.try_locate(r.uid, t.site(1), -1.3, 36.7);
    ASSERT v = '42501 Only an active administrator can manage sites', r.label || ': ' || v;
  END LOOP;
  ASSERT t.coords(t.site(1)) = 'null,null', 'unchanged';
  ASSERT NOT has_function_privilege('anon', 'public.admin_set_site_location(uuid,double precision,double precision)', 'EXECUTE');
  ASSERT NOT has_function_privilege('public', 'public.admin_set_site_location(uuid,double precision,double precision)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'public.admin_set_site_location(uuid,double precision,double precision)', 'EXECUTE');
  PERFORM t.pass('collector, site manager, recycler and inactive admin are refused with 42501; anon, PUBLIC and service_role cannot execute');
END $$;

-- 5: no direct writes; members can read their site's coordinates
DO $$
DECLARE v_lat DOUBLE PRECISION;
BEGIN
  BEGIN
    PERFORM t.as_user(t.id('admin'));
    UPDATE public.sites SET latitude = -1.3, longitude = 36.7 WHERE id = t.site(1);
    RAISE EXCEPTION 'an admin updated sites directly';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t.become('postgres');
  END;
  BEGIN
    PERFORM t.as_user(t.id('admin'));
    INSERT INTO public.site_events (site_id, actor_id, action, old_name, new_name, old_active, new_active)
    VALUES (t.site(1), t.id('admin'), 'located', 'x', 'x', true, true);
    RAISE EXCEPTION 'an admin wrote site_events directly';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t.become('postgres');
  END;
  PERFORM t.locate_as(t.id('admin'), t.site(1), -1.3, 36.7);
  PERFORM t.as_user(t.id('c1'));
  SELECT latitude INTO v_lat FROM public.sites WHERE id = t.site(1);
  PERFORM t.become('postgres');
  ASSERT v_lat = -1.3, 'collector reads their site''s latitude: ' || COALESCE(v_lat::text, 'null');
  PERFORM t.pass('clients cannot write sites or site_events directly; a collector can read their own site''s coordinates');
END $$;

-- 6: the table constraints hold even for the owner
DO $$
BEGIN
  BEGIN
    UPDATE public.sites SET latitude = -1.3, longitude = NULL WHERE id = t.site(3);
    RAISE EXCEPTION 'half a location accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sites SET latitude = 95, longitude = 36 WHERE id = t.site(3);
    RAISE EXCEPTION 'latitude 95 accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.site_events (site_id, actor_id, action, old_name, new_name, old_active, new_active, new_latitude)
    VALUES (t.site(3), t.id('admin'), 'updated', 'x', 'x', true, true, 1);
    RAISE EXCEPTION 'coordinates on an updated row accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.site_events (site_id, actor_id, action, new_name, new_active)
    VALUES (t.site(3), t.id('admin'), 'moved', 'x', true);
    RAISE EXCEPTION 'unknown action accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM t.pass('constraints: both coordinates or neither, ranges, coordinates only on located rows, known actions only');
END $$;
