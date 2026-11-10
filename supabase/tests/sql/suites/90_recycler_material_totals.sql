-- RECYCLER MATERIAL TOTALS (migration 008): recycler_material_totals()
-- returns the approved, verified weight per active recycler-visible
-- material, optionally by site and by verified date in Africa/Nairobi time.
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');

  PERFORM t.mkuser('c1', 'c1@example.test', true);      -- collector, site 1
  PERFORM t.set_profile(t.id('c1'), 'collector', true);
  PERFORM t.assign(t.id('c1'), t.site(1));
  PERFORM t.mkuser('c2', 'c2@example.test', true);      -- collector, site 2
  PERFORM t.set_profile(t.id('c2'), 'collector', true);
  PERFORM t.assign(t.id('c2'), t.site(2));
  PERFORM t.mkuser('m1', 'm1@example.test', true);      -- manager, site 1
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.assign(t.id('m1'), t.site(1));
  PERFORM t.mkuser('m2', 'm2@example.test', true);      -- manager, site 2
  PERFORM t.set_profile(t.id('m2'), 'site_manager', true);
  PERFORM t.assign(t.id('m2'), t.site(2));
  PERFORM t.mkuser('r1', 'r1@example.test', true);      -- active recycler, no site
  PERFORM t.set_profile(t.id('r1'), 'recycler', true);
  PERFORM t.mkuser('r_off', 'roff@example.test', true); -- inactive recycler
  PERFORM t.set_profile(t.id('r_off'), 'recycler', false);
END $$;

CREATE FUNCTION t.submit(p_user UUID, p_key TEXT, p_site UUID) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_rec UUID := gen_random_uuid(); v_id UUID;
BEGIN
  PERFORM t.as_user(p_user);
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
  VALUES (v_rec, p_site, 'MIXED', 10);
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

-- Test-only: set verified_at of a reviewed collection to an exact instant.
-- collection_logs_protect_update forbids any change after review, so it is
-- disabled for this one statement in this throwaway database.
CREATE FUNCTION t.set_verified_at(p_id UUID, p_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.collection_logs DISABLE TRIGGER collection_logs_protect_update;
  UPDATE public.collection_logs SET verified_at = p_at WHERE id = p_id;
  ALTER TABLE public.collection_logs ENABLE TRIGGER collection_logs_protect_update;
END $$;

-- "CODE:kg,CODE:kg,..." in result order, as p_user.
CREATE FUNCTION t.totals_as(p_user UUID, p_site UUID DEFAULT NULL,
                            p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM t.as_user(p_user);
  SELECT string_agg(r.material_code || ':' || r.verified_weight_kg::text, ',')
  INTO v FROM public.recycler_material_totals(p_site, p_from, p_to) AS r;
  PERFORM t.become('postgres');
  RETURN COALESCE(v, '');
END $$;

DO $$
DECLARE v UUID;
BEGIN
  -- Two materials that must never appear: verifiable but not
  -- recycler-visible, and recycler-visible but deactivated after use.
  INSERT INTO public.materials (code, display_name, is_reportable, is_verifiable, is_recycler_visible, is_active, sort_order)
  VALUES ('TESTHIDDEN', 'Test hidden', false, true, false, true, 70),
         ('TESTOLD', 'Test old', false, true, true, true, 80);

  -- A: site 1, approved, PET 3.25 + plastic bags 2.50.
  v := t.submit(t.id('c1'), 'a', t.site(1));
  PERFORM t.add_evidence(v);
  PERFORM t.review_as(t.id('m1'), v, true,
    '[{"material_code":"PET","weight_kg":3.25},{"material_code":"PLASTIC_BAGS","weight_kg":2.5}]', NULL);

  -- B: site 2, approved, PET 1.00 + HDPE 4.00.
  v := t.submit(t.id('c2'), 'b', t.site(2));
  PERFORM t.add_evidence(v);
  PERFORM t.review_as(t.id('m2'), v, true,
    '[{"material_code":"PET","weight_kg":1},{"material_code":"HDPE","weight_kg":4}]', NULL);

  -- D: site 1, approved, only the two never-shown materials.
  v := t.submit(t.id('c1'), 'd', t.site(1));
  PERFORM t.add_evidence(v);
  PERFORM t.review_as(t.id('m1'), v, true,
    '[{"material_code":"TESTHIDDEN","weight_kg":7},{"material_code":"TESTOLD","weight_kg":9}]', NULL);
  UPDATE public.materials SET is_active = false WHERE code = 'TESTOLD';

  -- P: pending, with a line (added as the owner; the API cannot do this).
  v := t.submit(t.id('c1'), 'p', t.site(1));
  INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
  VALUES (v, 'PET', 50);

  -- R: a line added while pending, then rejected.
  v := t.submit(t.id('c1'), 'r', t.site(1));
  INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
  VALUES (v, 'PP', 60);
  PERFORM t.review_as(t.id('m1'), v, false, NULL, 'Wet and dirty');

  -- Verified times around midnight in Nairobi (UTC+3):
  --   A: 30 Nov 23:30 EAT = 30 Nov 20:30 UTC  -> Nairobi date 30 Nov
  --   B:  1 Dec 00:00 EAT = 30 Nov 21:00 UTC  -> Nairobi date  1 Dec
  -- Both are 30 Nov in UTC, so a UTC-date filter would group them together.
  PERFORM t.set_verified_at(t.id('a'), '2026-11-30 20:30:00+00');
  PERFORM t.set_verified_at(t.id('b'), '2026-11-30 21:00:00+00');
END $$;

-- 1: approved lines counted; pending and rejected lines ignored; zero rows kept
DO $$
DECLARE v TEXT := t.totals_as(t.id('r1'));
BEGIN
  ASSERT (SELECT status FROM public.collection_logs WHERE id = t.id('p')) = 'pending';
  ASSERT (SELECT status FROM public.collection_logs WHERE id = t.id('r')) = 'rejected';
  ASSERT (SELECT count(*) FROM public.collection_verified_items WHERE collection_id IN (t.id('p'), t.id('r'))) = 2,
    'the pending and rejected fixture lines exist';
  ASSERT v = 'PET:4.25,PP:0.00,HDPE:4.00,LDPE:0.00,PLASTIC_BAGS:2.50', 'all-time totals: ' || v;
  PERFORM t.pass('sums approved lines only (pending PET 50 and rejected PP 60 ignored); materials with nothing show 0.00');
END $$;

-- 2: MIXED and non-recycler-visible or inactive materials never appear
DO $$
DECLARE v_codes TEXT; v_expected TEXT;
BEGIN
  PERFORM t.as_user(t.id('admin'));
  SELECT string_agg(material_code, ',' ORDER BY material_code) INTO v_codes
  FROM public.recycler_material_totals();
  PERFORM t.become('postgres');
  SELECT string_agg(code, ',' ORDER BY code) INTO v_expected
  FROM public.materials WHERE is_active AND is_recycler_visible;
  ASSERT v_codes = v_expected, v_codes || ' vs ' || v_expected;
  ASSERT v_codes NOT LIKE '%MIXED%' AND v_codes NOT LIKE '%TESTHIDDEN%' AND v_codes NOT LIKE '%TESTOLD%', v_codes;
  ASSERT v_codes = 'HDPE,LDPE,PET,PLASTIC_BAGS,PP', v_codes;
  PERFORM t.pass('exactly the active recycler-visible materials; never MIXED, a hidden or an inactive material');
END $$;

-- 3: result order and display names
DO $$
DECLARE v TEXT;
BEGIN
  PERFORM t.as_user(t.id('r1'));
  SELECT string_agg(display_name || '#' || sort_order, ',') INTO v FROM public.recycler_material_totals();
  PERFORM t.become('postgres');
  ASSERT v = 'PET#10,PP#20,HDPE#30,LDPE#40,Plastic bags#50', v;
  PERFORM t.pass('rows carry display_name and sort_order, in sort_order');
END $$;

-- 4: site filter
DO $$
DECLARE v TEXT;
BEGIN
  v := t.totals_as(t.id('r1'), t.site(1));
  ASSERT v = 'PET:3.25,PP:0.00,HDPE:0.00,LDPE:0.00,PLASTIC_BAGS:2.50', 'site 1: ' || v;
  v := t.totals_as(t.id('r1'), t.site(2));
  ASSERT v = 'PET:1.00,PP:0.00,HDPE:4.00,LDPE:0.00,PLASTIC_BAGS:0.00', 'site 2: ' || v;
  v := t.totals_as(t.id('r1'), t.site(3));
  ASSERT v = 'PET:0.00,PP:0.00,HDPE:0.00,LDPE:0.00,PLASTIC_BAGS:0.00', 'site 3: ' || v;
  v := t.totals_as(t.id('r1'), gen_random_uuid());
  ASSERT v = 'PET:0.00,PP:0.00,HDPE:0.00,LDPE:0.00,PLASTIC_BAGS:0.00', 'unknown site: ' || v;
  PERFORM t.pass('site filter: each site only its own approved lines; other and unknown sites all 0.00');
END $$;

-- 5: date filter, by calendar day in Nairobi time
DO $$
DECLARE v TEXT;
  only_a CONSTANT TEXT := 'PET:3.25,PP:0.00,HDPE:0.00,LDPE:0.00,PLASTIC_BAGS:2.50';
  only_b CONSTANT TEXT := 'PET:1.00,PP:0.00,HDPE:4.00,LDPE:0.00,PLASTIC_BAGS:0.00';
  both_days CONSTANT TEXT := 'PET:4.25,PP:0.00,HDPE:4.00,LDPE:0.00,PLASTIC_BAGS:2.50';
  no_totals CONSTANT TEXT := 'PET:0.00,PP:0.00,HDPE:0.00,LDPE:0.00,PLASTIC_BAGS:0.00';
BEGIN
  v := t.totals_as(t.id('r1'), NULL, '2026-11-30', '2026-11-30');
  ASSERT v = only_a, '30 Nov only (23:30 EAT counts, 00:00 EAT next day does not): ' || v;
  v := t.totals_as(t.id('r1'), NULL, '2026-12-01', '2026-12-01');
  ASSERT v = only_b, '1 Dec only (00:00 EAT counts): ' || v;
  v := t.totals_as(t.id('r1'), NULL, NULL, '2026-11-30');
  ASSERT v = only_a, 'up to 30 Nov: ' || v;
  v := t.totals_as(t.id('r1'), NULL, '2026-12-01', NULL);
  ASSERT v = only_b, 'from 1 Dec: ' || v;
  v := t.totals_as(t.id('r1'), NULL, '2026-11-30', '2026-12-01');
  ASSERT v = both_days, '30 Nov to 1 Dec: ' || v;
  v := t.totals_as(t.id('r1'), NULL, '2026-11-29', '2026-11-29');
  ASSERT v = no_totals, '29 Nov: ' || v;
  v := t.totals_as(t.id('r1'), t.site(1), '2026-12-01', '2026-12-01');
  ASSERT v = no_totals, 'site 1 on 1 Dec: ' || v;
  BEGIN
    PERFORM t.totals_as(t.id('r1'), NULL, '2026-12-02', '2026-12-01');
    RAISE EXCEPTION 'reversed range accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM t.become('postgres');
    ASSERT SQLERRM = 'The start date must not be after the end date', SQLERRM;
  END;
  PERFORM t.pass('date filter uses Nairobi calendar days: 23:30 EAT and 00:00 EAT the next day fall on different dates; inclusive bounds; reversed range refused');
END $$;

-- 6: active recycler and active admin allowed; everyone else refused
DO $$
DECLARE r RECORD; v_state TEXT; v_msg TEXT;
BEGIN
  ASSERT t.totals_as(t.id('admin')) = t.totals_as(t.id('r1')), 'admin sees the same totals';
  FOR r IN SELECT * FROM (VALUES ('collector', t.id('c1')), ('site manager', t.id('m1')),
                                 ('inactive recycler', t.id('r_off'))) AS x(label, uid) LOOP
    BEGIN
      PERFORM t.totals_as(r.uid);
      RAISE EXCEPTION '% was allowed', r.label;
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      PERFORM t.become('postgres');
      ASSERT v_state = '42501' AND v_msg = 'Only active recyclers and administrators can view material totals',
        r.label || ': ' || v_state || ' ' || v_msg;
    END;
  END LOOP;
  PERFORM t.pass('active recycler and admin allowed; collector, site manager and inactive recycler refused with 42501');
END $$;

-- 7: anon and service_role cannot execute; a signed-in role without a profile is refused
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.recycler_material_totals(uuid,date,date)', 'EXECUTE');
  ASSERT NOT has_function_privilege('public', 'public.recycler_material_totals(uuid,date,date)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'public.recycler_material_totals(uuid,date,date)', 'EXECUTE');
  BEGIN
    PERFORM t.become('anon');
    PERFORM public.recycler_material_totals();
    RAISE EXCEPTION 'anon could execute recycler_material_totals';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('authenticated', gen_random_uuid());   -- no profile
    PERFORM public.recycler_material_totals();
    RAISE EXCEPTION 'a user without a profile was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('postgres');
  PERFORM t.pass('anon, PUBLIC and service_role have no EXECUTE; anon is denied; a user without a profile is refused');
END $$;

-- 8: the result has exactly the four aggregate columns, no identities
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(a.parameter_name, ',' ORDER BY a.ordinal_position) INTO v_cols
  FROM information_schema.parameters AS a
  JOIN information_schema.routines AS r ON r.specific_name = a.specific_name
  WHERE r.routine_schema = 'public' AND r.routine_name = 'recycler_material_totals'
    AND a.parameter_mode = 'OUT';
  ASSERT v_cols = 'material_code,display_name,sort_order,verified_weight_kg', 'output columns: ' || COALESCE(v_cols, '<none>');
  PERFORM t.pass('result columns are exactly material_code, display_name, sort_order, verified_weight_kg (no collector, delivery, photo or site identity)');
END $$;
