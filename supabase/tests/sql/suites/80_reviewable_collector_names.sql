-- REVIEWABLE COLLECTOR NAMES (migration 007): reviewable_collector_names()
-- returns id + full_name only, only for collectors with a delivery at a site
-- the caller can review.
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');

  PERFORM t.mkuser('c1', 'c1@example.test', true);      -- collector, site 1, has a delivery
  PERFORM t.set_profile(t.id('c1'), 'collector', true);
  PERFORM t.assign(t.id('c1'), t.site(1));
  PERFORM t.mkuser('c2', 'c2@example.test', true);      -- collector, site 2, has a delivery
  PERFORM t.set_profile(t.id('c2'), 'collector', true);
  PERFORM t.assign(t.id('c2'), t.site(2));
  PERFORM t.mkuser('c3', 'c3@example.test', true);      -- collector, site 1, no delivery
  PERFORM t.set_profile(t.id('c3'), 'collector', true);
  PERFORM t.assign(t.id('c3'), t.site(1));
  PERFORM t.mkuser('m1', 'm1@example.test', true);      -- manager, site 1
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.assign(t.id('m1'), t.site(1));
  PERFORM t.mkuser('m2', 'm2@example.test', true);      -- manager, site 2
  PERFORM t.set_profile(t.id('m2'), 'site_manager', true);
  PERFORM t.assign(t.id('m2'), t.site(2));
  PERFORM t.mkuser('m12', 'm12@example.test', true);    -- manager, sites 1 and 2
  PERFORM t.set_profile(t.id('m12'), 'site_manager', true);
  PERFORM t.assign(t.id('m12'), t.site(1));
  PERFORM t.assign(t.id('m12'), t.site(2));
  PERFORM t.mkuser('m_off', 'moff@example.test', true); -- inactive manager, site 1
  PERFORM t.set_profile(t.id('m_off'), 'site_manager', false);
  PERFORM t.assign(t.id('m_off'), t.site(1));
  PERFORM t.mkuser('r1', 'r1@example.test', true);      -- recycler, site 1
  PERFORM t.set_profile(t.id('r1'), 'recycler', true);
  PERFORM t.assign(t.id('r1'), t.site(1));

  PERFORM t.as_owner(format(
    $q$UPDATE public.profiles SET full_name = CASE id
         WHEN %L THEN 'Collector One' WHEN %L THEN 'Collector Two'
         WHEN %L THEN 'Collector Three' END
       WHERE id IN (%L, %L, %L)$q$,
    t.id('c1'), t.id('c2'), t.id('c3'), t.id('c1'), t.id('c2'), t.id('c3')));
END $$;

CREATE FUNCTION t.submit(p_user UUID, p_site UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(p_user);
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
  VALUES (gen_random_uuid(), p_site, 'PET', 5);
  PERFORM t.become('postgres');
END $$;

-- "name|name" of what p_user gets for the given keys, sorted; '' for none.
CREATE FUNCTION t.names_as(p_user UUID, p_keys TEXT[]) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM t.as_user(p_user);
  SELECT COALESCE(string_agg(r.full_name, '|' ORDER BY r.full_name), '') INTO v
  FROM public.reviewable_collector_names(
    ARRAY(SELECT t.id(k) FROM unnest(p_keys) AS k)) AS r;
  PERFORM t.become('postgres');
  RETURN v;
END $$;

DO $$ BEGIN
  PERFORM t.submit(t.id('c1'), t.site(1));
  PERFORM t.submit(t.id('c2'), t.site(2));
END $$;

-- 1: a manager gets names only for collectors delivering to their sites
DO $$
DECLARE v TEXT;
BEGIN
  v := t.names_as(t.id('m1'), ARRAY['c1', 'c2', 'c3']);
  ASSERT v = 'Collector One', 'm1 got: ' || v;
  v := t.names_as(t.id('m2'), ARRAY['c1', 'c2', 'c3']);
  ASSERT v = 'Collector Two', 'm2 got: ' || v;
  v := t.names_as(t.id('m12'), ARRAY['c1', 'c2', 'c3']);
  ASSERT v = 'Collector One|Collector Two', 'm12 got: ' || v;
  PERFORM t.pass('managers get names only for collectors with deliveries at their own sites');
END $$;

-- 2: exactly two columns, id and full_name, and the id matches
DO $$
DECLARE v_cols TEXT; v_id UUID;
BEGIN
  SELECT string_agg(a.parameter_name, ',' ORDER BY a.ordinal_position) INTO v_cols
  FROM information_schema.parameters AS a
  JOIN information_schema.routines AS r ON r.specific_name = a.specific_name
  WHERE r.routine_schema = 'public' AND r.routine_name = 'reviewable_collector_names'
    AND a.parameter_mode = 'OUT';
  ASSERT v_cols = 'collector_id,full_name', 'output columns: ' || COALESCE(v_cols, '<none>');
  PERFORM t.as_user(t.id('m1'));
  SELECT r.collector_id INTO STRICT v_id FROM public.reviewable_collector_names(ARRAY[t.id('c1')]) AS r;
  PERFORM t.become('postgres');
  ASSERT v_id = t.id('c1');
  PERFORM t.pass('returns only collector_id and full_name');
END $$;

-- 3: collectors, recyclers and inactive managers get nothing
DO $$
DECLARE v TEXT;
BEGIN
  v := t.names_as(t.id('c1'), ARRAY['c1', 'c2', 'c3']);
  ASSERT v = '', 'collector c1 got: ' || v;
  v := t.names_as(t.id('r1'), ARRAY['c1', 'c2', 'c3']);
  ASSERT v = '', 'recycler got: ' || v;
  v := t.names_as(t.id('m_off'), ARRAY['c1', 'c2', 'c3']);
  ASSERT v = '', 'inactive manager got: ' || v;
  PERFORM t.pass('collectors, recyclers and inactive managers get no names');
END $$;

-- 4: admins (can_review_site) get names; non-collector ids and unknown ids give nothing
DO $$
DECLARE v TEXT; n BIGINT;
BEGIN
  v := t.names_as(t.id('admin'), ARRAY['c1', 'c2', 'c3']);
  ASSERT v = 'Collector One|Collector Two', 'admin got: ' || v;
  PERFORM t.as_user(t.id('m1'));
  SELECT count(*) INTO n FROM public.reviewable_collector_names(
    ARRAY[t.id('m1'), t.id('m2'), t.id('r1'), gen_random_uuid()]);
  ASSERT n = 0, 'non-collector or unknown ids returned ' || n || ' rows';
  SELECT count(*) INTO n FROM public.reviewable_collector_names(NULL);
  ASSERT n = 0;
  SELECT count(*) INTO n FROM public.reviewable_collector_names('{}');
  ASSERT n = 0;
  PERFORM t.become('postgres');
  PERFORM t.pass('admins get names; profiles without deliveries at reviewable sites, unknown, NULL and empty ids give nothing');
END $$;

-- 5: removing the manager from the site removes access; anon cannot execute
DO $$
DECLARE v TEXT;
BEGIN
  DELETE FROM public.user_sites WHERE user_id = t.id('m1') AND site_id = t.site(1);
  v := t.names_as(t.id('m1'), ARRAY['c1']);
  ASSERT v = '', 'unassigned manager got: ' || v;
  BEGIN
    PERFORM t.become('anon');
    PERFORM public.reviewable_collector_names(ARRAY[t.id('c1')]);
    RAISE EXCEPTION 'anon could execute reviewable_collector_names';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('postgres');
  PERFORM t.pass('access follows the current site assignment; anon cannot execute');
END $$;
