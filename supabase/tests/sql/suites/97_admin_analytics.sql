-- ADMIN ANALYTICS (migration 011): admin_site_volume(),
-- admin_material_breakdown() and admin_monthly_trend() return verified
-- weights of approved deliveries (and review counts), by Nairobi calendar
-- day of review, to active administrators only.
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');
  PERFORM t.mkuser('admin_off', 'adminoff@example.test', true);   -- inactive admin
  PERFORM t.set_profile(t.id('admin_off'), 'admin', false);

  PERFORM t.mkuser('c1', 'c1@example.test', true);
  PERFORM t.set_profile(t.id('c1'), 'collector', true);
  PERFORM t.assign(t.id('c1'), t.site(1));
  PERFORM t.mkuser('c2', 'c2@example.test', true);
  PERFORM t.set_profile(t.id('c2'), 'collector', true);
  PERFORM t.assign(t.id('c2'), t.site(2));
  PERFORM t.mkuser('c3', 'c3@example.test', true);
  PERFORM t.set_profile(t.id('c3'), 'collector', true);
  PERFORM t.assign(t.id('c3'), t.site(3));
  PERFORM t.mkuser('m1', 'm1@example.test', true);                -- manager of sites 1-3
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.assign(t.id('m1'), t.site(1));
  PERFORM t.assign(t.id('m1'), t.site(2));
  PERFORM t.assign(t.id('m1'), t.site(3));
  PERFORM t.mkuser('r1', 'r1@example.test', true);
  PERFORM t.set_profile(t.id('r1'), 'recycler', true);
END $$;

CREATE FUNCTION t.submit(p_user UUID, p_key TEXT, p_site UUID) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_rec UUID := gen_random_uuid(); v_id UUID;
BEGIN
  PERFORM t.as_user(p_user);
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
  VALUES (v_rec, p_site, 'MIXED', 99);
  PERFORM t.become('postgres');
  SELECT id INTO STRICT v_id FROM public.collection_logs
  WHERE collector_id = p_user AND client_record_id = v_rec;
  RETURN t.put(p_key, v_id);
END $$;

CREATE FUNCTION t.add_evidence(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
  VALUES (p_id, 'test/' || p_id || '/' || gen_random_uuid() || '.jpg', 'image/jpeg')
$$;

CREATE FUNCTION t.review_as(p_user UUID, p_id UUID, p_ok BOOLEAN, p_items JSONB, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(p_user);
  PERFORM public.review_collection(p_id, p_ok, p_items, p_reason);
  PERFORM t.become('postgres');
END $$;

-- Test-only: set verified_at of a reviewed collection to an exact instant
-- (the update trigger forbids changes after review; disabled for this one
-- statement in this throwaway database).
CREATE FUNCTION t.set_verified_at(p_id UUID, p_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.collection_logs DISABLE TRIGGER collection_logs_protect_update;
  UPDATE public.collection_logs SET verified_at = p_at WHERE id = p_id;
  ALTER TABLE public.collection_logs ENABLE TRIGGER collection_logs_protect_update;
END $$;

-- An approved delivery with the given lines, reviewed at p_at.
CREATE FUNCTION t.approved(p_key TEXT, p_collector UUID, p_site UUID, p_items JSONB, p_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  v := t.submit(p_collector, p_key, p_site);
  PERFORM t.add_evidence(v);
  PERFORM t.review_as(t.id('m1'), v, true, p_items, NULL);
  PERFORM t.set_verified_at(v, p_at);
END $$;

CREATE FUNCTION t.rejected(p_key TEXT, p_collector UUID, p_site UUID, p_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  v := t.submit(p_collector, p_key, p_site);
  PERFORM t.review_as(t.id('m1'), v, false, NULL, 'Wet and dirty');
  PERFORM t.set_verified_at(v, p_at);
END $$;

-- "FIXTURE Site n:kg/count,..." for fixture sites 1-4 (the others have no
-- deliveries and are covered by "active sites with nothing show 0"), as p_user.
CREATE FUNCTION t.volume_as(p_user UUID, p_from DATE, p_to DATE) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM t.as_user(p_user);
  SELECT string_agg(r.site_name || ':' || r.verified_weight_kg::text || '/' || r.approved_count::text
                    || CASE WHEN r.site_active THEN '' ELSE '(inactive)' END, ',' ORDER BY r.site_name)
  INTO v FROM public.admin_site_volume(p_from, p_to) AS r
  WHERE r.site_name IN ('FIXTURE Site 1', 'FIXTURE Site 2', 'FIXTURE Site 3', 'FIXTURE Site 4');
  PERFORM t.become('postgres');
  RETURN COALESCE(v, '');
END $$;

CREATE FUNCTION t.breakdown_as(p_user UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM t.as_user(p_user);
  SELECT string_agg(r.material_code || ':' || r.verified_weight_kg::text, ',')
  INTO v FROM public.admin_material_breakdown(p_from, p_to) AS r;
  PERFORM t.become('postgres');
  RETURN COALESCE(v, '');
END $$;

CREATE FUNCTION t.trend_as(p_user UUID, p_until DATE, p_months INTEGER DEFAULT 3) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM t.as_user(p_user);
  SELECT string_agg(to_char(r.month_start, 'YYYY-MM') || ':' || r.verified_weight_kg::text
                    || '/' || r.approved_count::text || '/' || r.rejected_count::text, ',')
  INTO v FROM public.admin_monthly_trend(p_until, p_months) AS r;
  PERFORM t.become('postgres');
  RETURN COALESCE(v, '');
END $$;

-- Fixtures (Nairobi = UTC+3; 30 Nov 2026 is a Monday):
--   A  site 1  approved  PET 3.25 + PLASTIC_BAGS 2.50  30 Nov 23:30 EAT (20:30 UTC)
--   B  site 2  approved  PET 1.00 + HDPE 4.00          1 Dec 00:00 EAT (30 Nov 21:00 UTC)
--   C  site 1  approved  PP 2.00                        15 Sep
--   D  site 3  approved  LDPE 7.00                      30 Nov 13:00 EAT; site 3 then deactivated
--   R  site 1  rejected                                 10 Oct
--   S  site 2  rejected                                 30 Nov 23:00 EAT (20:00 UTC)
--   P  site 1  pending, with a PET 50 line added by the owner (never counted)
--   site 4 is deactivated and has nothing: it is left out.
DO $$
DECLARE v UUID;
BEGIN
  PERFORM t.approved('a', t.id('c1'), t.site(1),
    '[{"material_code":"PET","weight_kg":3.25},{"material_code":"PLASTIC_BAGS","weight_kg":2.5}]', '2026-11-30 20:30:00+00');
  PERFORM t.approved('b', t.id('c2'), t.site(2),
    '[{"material_code":"PET","weight_kg":1},{"material_code":"HDPE","weight_kg":4}]', '2026-11-30 21:00:00+00');
  PERFORM t.approved('c', t.id('c1'), t.site(1), '[{"material_code":"PP","weight_kg":2}]', '2026-09-15 09:00:00+00');
  PERFORM t.approved('d', t.id('c3'), t.site(3), '[{"material_code":"LDPE","weight_kg":7}]', '2026-11-30 10:00:00+00');
  PERFORM t.rejected('r', t.id('c1'), t.site(1), '2026-10-10 09:00:00+00');
  PERFORM t.rejected('s', t.id('c2'), t.site(2), '2026-11-30 20:00:00+00');
  v := t.submit(t.id('c1'), 'p', t.site(1));
  INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg) VALUES (v, 'PET', 50);
  UPDATE public.sites SET active = false WHERE id IN (t.site(3), t.site(4));
END $$;

-- 1: site volume: approved lines per site for Nairobi days; every active site listed
DO $$
DECLARE v TEXT;
BEGIN
  v := t.volume_as(t.id('admin'), '2026-11-30', '2026-11-30');
  ASSERT v = 'FIXTURE Site 1:5.75/1,FIXTURE Site 2:0.00/0,FIXTURE Site 3:7.00/1(inactive)', '30 Nov: ' || v;
  PERFORM t.as_user(t.id('admin'));
  ASSERT (SELECT bool_and(r.verified_weight_kg = 0 AND r.approved_count = 0 AND r.site_active)
          FROM public.admin_site_volume('2026-11-30', '2026-11-30') AS r
          WHERE r.site_name NOT IN ('FIXTURE Site 1', 'FIXTURE Site 2', 'FIXTURE Site 3')),
    'every other listed site is active with 0.00/0';
  ASSERT NOT EXISTS (SELECT 1 FROM public.admin_site_volume('2026-11-30', '2026-11-30') AS r
                     WHERE r.site_name = 'FIXTURE Site 4'), 'inactive site 4 without deliveries is left out';
  PERFORM t.become('postgres');
  v := t.volume_as(t.id('admin'), '2026-12-01', '2026-12-01');
  ASSERT v = 'FIXTURE Site 1:0.00/0,FIXTURE Site 2:5.00/1', '1 Dec: ' || v;
  v := t.volume_as(t.id('admin'), '2026-11-30', '2026-12-06');
  ASSERT v = 'FIXTURE Site 1:5.75/1,FIXTURE Site 2:5.00/1,FIXTURE Site 3:7.00/1(inactive)', 'week of 30 Nov: ' || v;
  v := t.volume_as(t.id('admin'), '2026-01-01', '2026-12-31');
  ASSERT v = 'FIXTURE Site 1:7.75/2,FIXTURE Site 2:5.00/1,FIXTURE Site 3:7.00/1(inactive)', '2026: ' || v;
  PERFORM t.pass('site volume: verified kg and approved count per site by Nairobi review day (23:30 and 00:00 EAT fall on different days); pending and rejected ignored; active sites with nothing show 0.00/0; an inactive site only when it has deliveries');
END $$;

-- 2: material breakdown: largest first, only materials with weight, Nairobi days
DO $$
DECLARE v TEXT;
BEGIN
  v := t.breakdown_as(t.id('admin'));
  ASSERT v = 'LDPE:7.00,PET:4.25,HDPE:4.00,PLASTIC_BAGS:2.50,PP:2.00', 'all time: ' || v;
  v := t.breakdown_as(t.id('admin'), '2026-12-01', NULL);
  ASSERT v = 'HDPE:4.00,PET:1.00', 'from 1 Dec: ' || v;
  v := t.breakdown_as(t.id('admin'), NULL, '2026-11-30');
  ASSERT v = 'LDPE:7.00,PET:3.25,PLASTIC_BAGS:2.50,PP:2.00', 'up to 30 Nov: ' || v;
  v := t.breakdown_as(t.id('admin'), '2026-08-01', '2026-08-31');
  ASSERT v = '', 'August: ' || v;
  PERFORM t.pass('material breakdown: approved verified lines only (pending PET 50 ignored), largest first, no zero rows, Nairobi-day bounds, MIXED never present');
END $$;

-- 3: monthly trend: the months ending with p_until's month, oldest first, empty months included
DO $$
DECLARE v TEXT;
BEGIN
  v := t.trend_as(t.id('admin'), '2026-12-05');
  ASSERT v = '2026-10:0.00/0/1,2026-11:12.75/2/1,2026-12:5.00/1/0', '3 months to Dec: ' || v;
  v := t.trend_as(t.id('admin'), '2026-12-31', 4);
  ASSERT v = '2026-09:2.00/1/0,2026-10:0.00/0/1,2026-11:12.75/2/1,2026-12:5.00/1/0', '4 months to Dec: ' || v;
  v := t.trend_as(t.id('admin'), '2026-11-01', 1);
  ASSERT v = '2026-11:12.75/2/1', 'November only: ' || v;
  v := t.trend_as(t.id('admin'), '2027-03-10', 2);
  ASSERT v = '2027-02:0.00/0/0,2027-03:0.00/0/0', 'empty months: ' || v;
  PERFORM t.pass('monthly trend: verified kg, approved and rejected counts per Nairobi month (30 Nov 23:30 EAT in Nov, 1 Dec 00:00 EAT in Dec), oldest first, empty months as zeros');
END $$;

-- 4: input checks (22023)
DO $$
DECLARE v_msg TEXT;
BEGIN
  BEGIN
    PERFORM t.volume_as(t.id('admin'), '2026-12-02', '2026-12-01');
    RAISE EXCEPTION 'reversed site volume range accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM t.become('postgres');
    ASSERT SQLERRM = 'The start date must not be after the end date', SQLERRM;
  END;
  BEGIN
    PERFORM t.volume_as(t.id('admin'), NULL, '2026-12-01');
    RAISE EXCEPTION 'missing site volume date accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM t.become('postgres');
    ASSERT SQLERRM = 'Both dates are required', SQLERRM;
  END;
  BEGIN
    PERFORM t.breakdown_as(t.id('admin'), '2026-12-02', '2026-12-01');
    RAISE EXCEPTION 'reversed breakdown range accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM t.become('postgres');
  END;
  FOREACH v_msg IN ARRAY ARRAY['0', '25', 'null'] LOOP
    BEGIN
      PERFORM t.trend_as(t.id('admin'), '2026-12-01', CASE WHEN v_msg = 'null' THEN NULL ELSE v_msg::INTEGER END);
      RAISE EXCEPTION 'p_months % accepted', v_msg;
    EXCEPTION WHEN invalid_parameter_value THEN
      PERFORM t.become('postgres');
      ASSERT SQLERRM = 'The number of months must be between 1 and 24', SQLERRM;
    END;
  END LOOP;
  BEGIN
    PERFORM t.trend_as(t.id('admin'), NULL);
    RAISE EXCEPTION 'missing trend end date accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM t.become('postgres');
    ASSERT SQLERRM = 'The end date is required', SQLERRM;
  END;
  PERFORM t.pass('reversed or missing dates and a month count outside 1-24 are refused with 22023');
END $$;

-- 5: only an active admin; everyone else 42501, for all three functions
DO $$
DECLARE r RECORD; f TEXT; v_state TEXT; v_msg TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('collector', t.id('c1')), ('site manager', t.id('m1')),
                                 ('recycler', t.id('r1')), ('inactive admin', t.id('admin_off'))) AS x(label, uid) LOOP
    FOREACH f IN ARRAY ARRAY['volume', 'breakdown', 'trend'] LOOP
      BEGIN
        CASE f
          WHEN 'volume' THEN PERFORM t.volume_as(r.uid, '2026-11-30', '2026-11-30');
          WHEN 'breakdown' THEN PERFORM t.breakdown_as(r.uid);
          ELSE PERFORM t.trend_as(r.uid, '2026-12-01');
        END CASE;
        RAISE EXCEPTION '% was allowed %', r.label, f;
      EXCEPTION WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM t.become('postgres');
        ASSERT v_state = '42501' AND v_msg = 'Only active administrators can view analytics',
          r.label || ' ' || f || ': ' || v_state || ' ' || v_msg;
      END;
    END LOOP;
  END LOOP;
  PERFORM t.pass('collector, site manager, recycler and inactive admin are refused with 42501 by all three functions');
END $$;

-- 6: anon, PUBLIC and service_role cannot execute; the helper is internal
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.admin_site_volume(date,date)', 'public.admin_material_breakdown(date,date)',
                           'public.admin_monthly_trend(date,integer)'] LOOP
    ASSERT NOT has_function_privilege('anon', f, 'EXECUTE'), f;
    ASSERT NOT has_function_privilege('public', f, 'EXECUTE'), f;
    ASSERT NOT has_function_privilege('service_role', f, 'EXECUTE'), f;
    ASSERT has_function_privilege('authenticated', f, 'EXECUTE'), f;
  END LOOP;
  ASSERT NOT has_function_privilege('authenticated', 'public.assert_active_admin_for_analytics()', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.assert_active_admin_for_analytics()', 'EXECUTE');
  BEGIN
    PERFORM t.become('anon');
    PERFORM public.admin_monthly_trend('2026-12-01', 3);
    RAISE EXCEPTION 'anon could execute admin_monthly_trend';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('authenticated', gen_random_uuid());   -- no profile
    PERFORM public.admin_material_breakdown();
    RAISE EXCEPTION 'a user without a profile was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('postgres');
  PERFORM t.pass('only authenticated may execute (and then only active admins pass); anon denied; the admin check helper is not callable by clients');
END $$;

-- 7: aggregate columns only, no identities
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(r.routine_name || '(' || cols || ')', ' ' ORDER BY r.routine_name) INTO v_cols
  FROM information_schema.routines AS r
  CROSS JOIN LATERAL (
    SELECT string_agg(a.parameter_name, ',' ORDER BY a.ordinal_position) AS cols
    FROM information_schema.parameters AS a
    WHERE a.specific_name = r.specific_name AND a.parameter_mode = 'OUT'
  ) AS o
  WHERE r.routine_schema = 'public'
    AND r.routine_name IN ('admin_site_volume', 'admin_material_breakdown', 'admin_monthly_trend');
  ASSERT v_cols = 'admin_material_breakdown(material_code,display_name,verified_weight_kg) '
               || 'admin_monthly_trend(month_start,verified_weight_kg,approved_count,rejected_count) '
               || 'admin_site_volume(site_id,site_name,site_active,verified_weight_kg,approved_count)', v_cols;
  PERFORM t.pass('result columns are aggregates only: no collector, delivery or photo identity');
END $$;
