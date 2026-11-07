-- COLLECTIONS: insert integrity, offline idempotency, review RPC with the
-- verified breakdown, payout eligibility, finality, audit events, RLS reads,
-- evidence (migrations 001 and 006), materials and device location.
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
  PERFORM t.mkuser('c_off', 'coff@example.test', true); -- inactive collector, site 1
  PERFORM t.set_profile(t.id('c_off'), 'collector', false);
  PERFORM t.assign(t.id('c_off'), t.site(1));
  PERFORM t.mkuser('m1', 'm1@example.test', true);      -- manager, site 1
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.assign(t.id('m1'), t.site(1));
  PERFORM t.mkuser('m2', 'm2@example.test', true);      -- manager, site 2
  PERFORM t.set_profile(t.id('m2'), 'site_manager', true);
  PERFORM t.assign(t.id('m2'), t.site(2));
  PERFORM t.mkuser('m_off', 'moff@example.test', true); -- inactive manager, site 1
  PERFORM t.set_profile(t.id('m_off'), 'site_manager', false);
  PERFORM t.assign(t.id('m_off'), t.site(1));
  PERFORM t.mkuser('r1', 'r1@example.test', true);      -- recycler, site 1
  PERFORM t.set_profile(t.id('r1'), 'recycler', true);
  PERFORM t.assign(t.id('r1'), t.site(1));
  PERFORM t.mkuser('r2', 'r2@example.test', true);      -- recycler, site 2
  PERFORM t.set_profile(t.id('r2'), 'recycler', true);
  PERFORM t.assign(t.id('r2'), t.site(2));
END $$;

CREATE FUNCTION t.submit(p_user UUID, p_key TEXT, p_site UUID,
                         p_material TEXT, p_kg NUMERIC)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_rec UUID := gen_random_uuid(); v_id UUID;
BEGIN
  PERFORM t.as_user(p_user);
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code,
                                      reported_weight_kg, captured_at)
  VALUES (v_rec, p_site, p_material, p_kg, now() - interval '1 hour');
  PERFORM t.become('postgres');
  SELECT id INTO STRICT v_id FROM public.collection_logs
  WHERE collector_id = p_user AND client_record_id = v_rec;
  PERFORM t.put(p_key || '_rec', v_rec);
  RETURN t.put(p_key, v_id);
END $$;

CREATE FUNCTION t.review_as(p_user UUID, p_id UUID, p_ok BOOLEAN,
                            p_items JSONB, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(p_user);
  PERFORM public.review_collection(p_id, p_ok, p_items, p_reason);
  PERFORM t.become('postgres');
END $$;

-- Ground-truth evidence row for a collection (as the owner), so approval
-- tests can satisfy the evidence requirement.
CREATE FUNCTION t.add_evidence(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
  VALUES (p_id, 'test/' || p_id || '/' || gen_random_uuid() || '.jpg', 'image/jpeg')
$$;

-- Ground truth (no RLS) for one collection.
CREATE FUNCTION t.item_count(p_id UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.collection_verified_items WHERE collection_id = p_id
$$;

CREATE FUNCTION t.event_count(p_id UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.collection_events WHERE collection_id = p_id
$$;

-- Expect review_collection to fail with a message matching p_like, and to
-- leave the collection pending with no lines and no new events.
CREATE FUNCTION t.review_fails(p_user UUID, p_id UUID, p_ok BOOLEAN,
                               p_items JSONB, p_reason TEXT, p_like TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_events BIGINT := t.event_count(p_id);
BEGIN
  BEGIN
    PERFORM t.review_as(p_user, p_id, p_ok, p_items, p_reason);
    RAISE EXCEPTION USING ERRCODE = 'T0002',
      MESSAGE = format('review succeeded: items=%s reason=%s', p_items, p_reason);
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE p_like,
      format('items=%s: expected "%s", got "%s"', p_items, p_like, SQLERRM);
  END;
  PERFORM t.become('postgres');
  ASSERT (SELECT status FROM public.collection_logs WHERE id = p_id) = 'pending', 'status changed';
  ASSERT t.item_count(p_id) = 0, 'lines written';
  ASSERT t.event_count(p_id) = v_events, 'event written';
END $$;

-- 1
DO $$
DECLARE v_id UUID; r public.collection_logs; e public.collection_events;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_a', t.site(1), 'PET', 12.5);
  SELECT * INTO STRICT r FROM public.collection_logs WHERE id = v_id;
  ASSERT r.collector_id = t.id('c1'), 'collector_id defaults to auth.uid()';
  ASSERT r.status = 'pending' AND r.payment_eligible = false;
  ASSERT r.verified_weight_kg IS NULL AND r.verified_by IS NULL
     AND r.verified_at IS NULL AND r.rejection_reason IS NULL;
  ASSERT r.reported_weight_kg = 12.5;
  ASSERT r.submitted_at = now() AND r.created_at = now(), 'server timestamps';
  SELECT * INTO STRICT e FROM public.collection_events WHERE collection_id = v_id;
  ASSERT e.action = 'submitted' AND e.actor_id = t.id('c1');
  ASSERT (e.details->>'reported_weight_kg')::numeric = 12.5;
  ASSERT e.details->>'client_record_id' = t.id('col_a_rec')::text;
  ASSERT e.details->>'new_status' = 'pending';
  PERFORM t.pass('collector insert: forced pending/unverified, server timestamps, one submitted audit event');
END $$;

-- 2
DO $$
DECLARE c TEXT; v TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['status', 'verified_weight_kg', 'payment_eligible', 'collector_id',
                           'verified_by', 'verified_at', 'rejection_reason', 'submitted_at',
                           'created_at', 'id'] LOOP
    v := CASE c
      WHEN 'status' THEN '''approved'''
      WHEN 'verified_weight_kg' THEN '10'
      WHEN 'payment_eligible' THEN 'true'
      WHEN 'collector_id' THEN quote_literal(t.id('c2'))
      WHEN 'verified_by' THEN quote_literal(t.id('m1'))
      WHEN 'rejection_reason' THEN '''x'''
      WHEN 'id' THEN 'gen_random_uuid()'
      ELSE 'now()' END;
    BEGIN
      PERFORM t.as_user(t.id('c1'));
      EXECUTE format(
        'INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg, %I)
         VALUES (gen_random_uuid(), %L, ''PET'', 1, %s)', c, t.site(1), v);
      RAISE EXCEPTION 'collector could set %', c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  PERFORM t.pass('collectors cannot supply status, verified weight, payout, reviewer or server fields');
END $$;

-- 3
DO $$
DECLARE u TEXT;
BEGIN
  BEGIN  -- unassigned site
    PERFORM t.submit(t.id('c1'), 'x', t.site(2), 'PET', 1);
    RAISE EXCEPTION 'collector submitted for an unassigned site';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOREACH u IN ARRAY ARRAY['c_off', 'm1', 'r1', 'admin'] LOOP
    BEGIN
      PERFORM t.submit(t.id(u), 'x', t.site(1), 'PET', 1);
      RAISE EXCEPTION '% could submit a collection', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM t.become('anon');
    INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
    VALUES (gen_random_uuid(), t.site(1), 'PET', 1);
    RAISE EXCEPTION 'anon could submit';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.pass('only active collectors at an assigned site can submit (not inactive, manager, recycler, admin, anon)');
END $$;

-- 4
DO $$
DECLARE v_rec UUID := t.id('col_a_rec'); n BIGINT;
BEGIN
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
    VALUES (v_rec, t.site(1), 'HDPE', 3);
    RAISE EXCEPTION 'duplicate offline key accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM t.as_user(t.id('c2'));
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
  VALUES (v_rec, t.site(2), 'HDPE', 3);
  PERFORM t.become('postgres');
  SELECT count(*) INTO n FROM public.collection_logs WHERE client_record_id = v_rec;
  ASSERT n = 2;
  ASSERT (SELECT count(*) FROM public.collection_events ev
          JOIN public.collection_logs c ON c.id = ev.collection_id
          WHERE c.client_record_id = v_rec AND ev.action = 'submitted') = 2;
  PERFORM t.pass('offline idempotency: same client_record_id rejected for one collector, allowed for another');
END $$;

-- 5
DO $$ BEGIN
  BEGIN
    PERFORM t.submit(t.id('c1'), 'x', t.site(1), 'PET', 0);
    RAISE EXCEPTION 'zero weight accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM t.submit(t.id('c1'), 'x', t.site(1), 'PET', -2);
    RAISE EXCEPTION 'negative weight accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM t.submit(t.id('c1'), 'x', t.site(1), NULL, 2);
    RAISE EXCEPTION 'null material accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  PERFORM t.pass('reported weight must be > 0 and material is required');
END $$;

-- 6
DO $$
DECLARE r public.collection_logs; v_rec UUID := gen_random_uuid();
BEGIN
  INSERT INTO public.collection_logs (client_record_id, collector_id, site_id, material_code,
    reported_weight_kg, verified_weight_kg, status, payment_eligible, verified_by,
    verified_at, submitted_at, created_at)
  VALUES (v_rec, t.id('c1'), t.site(1), 'LDPE', 5, 99, 'approved', true, t.id('m1'),
          '2000-01-01', '2000-01-01', '2000-01-01');
  SELECT * INTO STRICT r FROM public.collection_logs WHERE client_record_id = v_rec;
  ASSERT r.status = 'pending' AND r.payment_eligible = false;
  ASSERT r.verified_weight_kg IS NULL AND r.verified_by IS NULL AND r.verified_at IS NULL;
  ASSERT r.submitted_at = now() AND r.created_at = now();
  PERFORM t.put('col_forged', r.id);
  PERFORM t.pass('insert trigger forces workflow fields even for an owner/superuser insert');
END $$;

-- 7
DO $$
DECLARE n BIGINT;
BEGIN
  BEGIN
    PERFORM t.as_user(t.id('admin'));
    UPDATE public.collection_logs SET status = 'approved';
    RAISE EXCEPTION 'admin direct UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.as_user(t.id('m1'));
    UPDATE public.collection_logs SET verified_weight_kg = 1;
    RAISE EXCEPTION 'manager direct UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    DELETE FROM public.collection_logs;
    RAISE EXCEPTION 'collector DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.as_user(t.id('admin'));
    INSERT INTO public.collection_events (collection_id, action) VALUES (t.id('col_a'), 'approved');
    RAISE EXCEPTION 'event INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.as_user(t.id('admin'));
    DELETE FROM public.collection_events;
    RAISE EXCEPTION 'event DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('anon');
    PERFORM 1 FROM public.collection_logs;
    RAISE EXCEPTION 'anon read collections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('anon');
    PERFORM 1 FROM public.collection_events;
    RAISE EXCEPTION 'anon read events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.pass('no direct UPDATE/DELETE on collections or writes to events for any client role; anon reads nothing');
END $$;

-- 8: multi-line verified breakdown; the total is computed in the database
DO $$
DECLARE r public.collection_logs; e public.collection_events; v_sum NUMERIC; v_n BIGINT;
BEGIN
  PERFORM t.add_evidence(t.id('col_a'));
  -- reported: PET 12.5 kg; verified after sorting: PET 8.25 + plastic bags 3.50
  PERFORM t.review_as(t.id('m1'), t.id('col_a'), true,
    '[{"material_code": "PLASTIC_BAGS", "weight_kg": 3.50},
      {"material_code": "PET", "weight_kg": 8.25}]', NULL);
  SELECT * INTO STRICT r FROM public.collection_logs WHERE id = t.id('col_a');
  ASSERT r.status = 'approved' AND r.payment_eligible = true;
  ASSERT r.verified_weight_kg = 11.75 AND r.reported_weight_kg = 12.5, 'weights kept separate';
  ASSERT r.material_code = 'PET', 'reported material unchanged';
  ASSERT r.verified_by = t.id('m1') AND r.verified_at = now();
  ASSERT r.rejection_reason IS NULL;
  SELECT sum(weight_kg), count(*) INTO v_sum, v_n
  FROM public.collection_verified_items WHERE collection_id = t.id('col_a');
  ASSERT v_n = 2, 'two lines stored, got ' || v_n;
  ASSERT v_sum = r.verified_weight_kg, 'verified total equals the sum of the lines';
  ASSERT (SELECT weight_kg FROM public.collection_verified_items
          WHERE collection_id = t.id('col_a') AND material_code = 'PET') = 8.25;
  ASSERT (SELECT weight_kg FROM public.collection_verified_items
          WHERE collection_id = t.id('col_a') AND material_code = 'PLASTIC_BAGS') = 3.50;
  SELECT * INTO STRICT e FROM public.collection_events
  WHERE collection_id = t.id('col_a') AND action = 'approved';
  ASSERT e.actor_id = t.id('m1');
  ASSERT e.details->>'previous_status' = 'pending' AND e.details->>'new_status' = 'approved';
  ASSERT e.details->>'reported_material_code' = 'PET';
  ASSERT (e.details->>'reported_weight_kg')::numeric = 12.5;
  ASSERT (e.details->>'verified_weight_kg')::numeric = 11.75;
  ASSERT e.details->'verified_items' = '[{"material_code": "PET", "weight_kg": 8.25},
                                         {"material_code": "PLASTIC_BAGS", "weight_kg": 3.50}]'::jsonb,
    'event breakdown: ' || (e.details->'verified_items')::text;
  ASSERT (e.details->>'payment_eligible')::boolean;
  PERFORM t.pass('site manager approval with a 2-line breakdown: lines stored, total = sum of lines, reported values unchanged, event records both');
END $$;

-- 9
DO $$
DECLARE v_id UUID;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_b', t.site(1), 'HDPE', 4);
  PERFORM t.add_evidence(v_id);
  PERFORM t.review_fails(t.id('m1'), v_id, true, NULL, NULL, 'The verified breakdown must be a JSON array%');
  PERFORM t.review_fails(t.id('m1'), v_id, true, '[]', NULL, 'At least one verified breakdown line is required%');
  PERFORM t.review_fails(t.id('m1'), v_id, false, NULL, NULL, 'A rejection reason is required');
  PERFORM t.review_fails(t.id('m1'), v_id, false, NULL, '   ', 'A rejection reason is required');
  PERFORM t.review_fails(t.id('m1'), v_id, NULL, NULL, 'x', 'An approval decision is required');
  PERFORM t.pass('approval needs breakdown lines; rejection needs a non-blank reason; a decision is required; failures change nothing');
END $$;

-- 10
DO $$
DECLARE r public.collection_logs; e public.collection_events;
BEGIN
  PERFORM t.review_as(t.id('m1'), t.id('col_b'), false, '[]', '  Contaminated load  ');
  SELECT * INTO STRICT r FROM public.collection_logs WHERE id = t.id('col_b');
  ASSERT r.status = 'rejected' AND r.payment_eligible = false;
  ASSERT r.rejection_reason = 'Contaminated load', 'reason trimmed';
  ASSERT r.verified_weight_kg IS NULL, 'rejection has no verified total';
  ASSERT t.item_count(r.id) = 0, 'rejection stores no lines';
  ASSERT r.verified_by = t.id('m1') AND r.verified_at IS NOT NULL;
  SELECT * INTO STRICT e FROM public.collection_events
  WHERE collection_id = t.id('col_b') AND action = 'rejected';
  ASSERT e.actor_id = t.id('m1') AND e.details->>'rejection_reason' = 'Contaminated load';
  ASSERT e.details->>'reported_material_code' = 'HDPE';
  ASSERT (e.details->>'reported_weight_kg')::numeric = 4;
  ASSERT e.details->'verified_items' = '[]'::jsonb;
  ASSERT NOT (e.details->>'payment_eligible')::boolean;
  PERFORM t.pass('rejection: trimmed reason, no lines, not payout eligible, rejected event with actor, reason and reported values');
END $$;

-- 11
DO $$
DECLARE v_id UUID; u TEXT;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_c', t.site(1), 'MIXED', 7);
  PERFORM t.add_evidence(v_id);
  FOREACH u IN ARRAY ARRAY['m2', 'c1', 'r1', 'm_off', 'c2'] LOOP
    BEGIN
      PERFORM t.review_as(t.id(u), v_id, true, '[{"material_code": "PET", "weight_kg": 7}]', NULL);
      RAISE EXCEPTION '% could review', u;
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'You are not authorised to review this collection', u || ': ' || SQLERRM;
    END;
  END LOOP;
  BEGIN
    PERFORM t.become('anon');
    PERFORM public.review_collection(v_id, true, '[{"material_code": "PET", "weight_kg": 7}]', NULL);
    RAISE EXCEPTION 'anon could review';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      ASSERT SQLERRM = 'You are not authorised to review this collection', SQLERRM;
  END;
  ASSERT (SELECT status FROM public.collection_logs WHERE id = v_id) = 'pending';
  ASSERT (SELECT count(*) FROM public.collection_events WHERE collection_id = v_id) = 1;
  ASSERT t.item_count(v_id) = 0;
  PERFORM t.pass('other-site manager, own collector, recycler, inactive manager and anon cannot review');
END $$;

-- 12 (existing behaviour, unchanged: can_review_site includes active admins)
DO $$ BEGIN
  PERFORM t.review_as(t.id('admin'), t.id('col_c'), true, '[{"material_code": "PP", "weight_kg": 6.5}]', NULL);
  ASSERT (SELECT status = 'approved' AND verified_by = t.id('admin') AND verified_weight_kg = 6.5
                 AND material_code = 'MIXED'
          FROM public.collection_logs WHERE id = t.id('col_c'));
  PERFORM t.pass('an active admin can review a collection at any site (MIXED reported, PP verified)');
END $$;

-- 13
DO $$ BEGIN
  BEGIN
    PERFORM t.review_as(t.id('m1'), t.id('col_a'), false, NULL, 'second thoughts');
    RAISE EXCEPTION 'reviewed twice';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Only pending collections can be reviewed', SQLERRM; END;
  BEGIN  -- even the owner cannot rewrite a reviewed row
    UPDATE public.collection_logs SET verified_weight_kg = 500 WHERE id = t.id('col_a');
    RAISE EXCEPTION 'owner changed a reviewed row';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Reviewed collections cannot be changed', SQLERRM; END;
  BEGIN
    UPDATE public.collection_logs SET reported_weight_kg = 500 WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'owner changed submitted details';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Submitted collection details cannot be changed', SQLERRM; END;
  BEGIN
    UPDATE public.collection_logs SET collector_id = t.id('c2') WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'owner changed collector';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Submitted collection details cannot be changed', SQLERRM; END;
  ASSERT (SELECT verified_weight_kg FROM public.collection_logs WHERE id = t.id('col_a')) = 11.75;
  PERFORM t.pass('reviewed collections are final and submitted details are immutable (even for the owner)');
END $$;

-- 14
DO $$ BEGIN
  BEGIN
    UPDATE public.collection_logs SET payment_eligible = true WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'pending row made payout eligible';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.collection_logs SET status = 'approved', payment_eligible = true,
      verified_by = t.id('m1'), verified_at = now()
    WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'approved without verified weight';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.collection_logs SET status = 'rejected', verified_by = t.id('m1'),
      verified_at = now(), rejection_reason = '  '
    WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'rejected with blank reason';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.collection_logs SET status = 'approved', verified_weight_kg = 5,
      verified_by = t.id('m1'), verified_at = now(), payment_eligible = false
    WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'approved but not payout eligible';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT status FROM public.collection_logs WHERE id = t.id('col_forged')) = 'pending';
  PERFORM t.pass('review consistency CHECK: payout eligible if and only if approved with verified weight and reviewer');
END $$;

-- 15
DO $$ BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'collection_logs'
      AND (column_name ILIKE '%payout%' OR is_generated = 'ALWAYS'
           OR generation_expression ILIKE '%reported_weight%')),
    'a generated/payout column exists on collection_logs';
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs
                     WHERE payment_eligible AND status <> 'approved');
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs
                     WHERE payment_eligible AND verified_weight_kg IS NULL);
  PERFORM t.pass('collector weight drives nothing: no payout/generated column; eligible rows are approved and verified');
END $$;

-- 16
DO $$
DECLARE n BIGINT; v_total BIGINT;
BEGIN
  SELECT count(*) INTO v_total FROM public.collection_logs;

  PERFORM t.as_user(t.id('c1'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs WHERE collector_id <> t.id('c1')),
    'c1 sees others';
  ASSERT EXISTS (SELECT 1 FROM public.collection_logs WHERE id = t.id('col_a'));

  PERFORM t.as_user(t.id('c2'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs WHERE collector_id = t.id('c1')),
    'c2 sees c1';
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_events WHERE collection_id = t.id('col_a')),
    'c2 sees c1 events';

  PERFORM t.as_user(t.id('m1'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs WHERE site_id <> t.site(1)), 'm1 other site';
  ASSERT EXISTS (SELECT 1 FROM public.collection_logs WHERE status = 'pending');

  PERFORM t.as_user(t.id('m2'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs WHERE site_id = t.site(1)), 'm2 sees site 1';

  -- recyclers read no individual collection, even an approved one at their site
  PERFORM t.as_user(t.id('r1'));
  SELECT count(*) INTO n FROM public.collection_logs;
  ASSERT n = 0, 'recycler r1 sees ' || n || ' collections';

  PERFORM t.as_user(t.id('r2'));
  SELECT count(*) INTO n FROM public.collection_logs;
  ASSERT n = 0, 'recycler r2 sees ' || n || ' collections';

  PERFORM t.as_user(t.id('m_off'));
  SELECT count(*) INTO n FROM public.collection_logs;
  ASSERT n = 0, 'inactive manager sees ' || n;

  PERFORM t.as_user(t.id('admin'));
  SELECT count(*) INTO n FROM public.collection_logs;
  ASSERT n = v_total, 'admin sees ' || n || ' of ' || v_total;
  PERFORM t.pass('RLS reads: own rows; managers by site; recyclers none; admin all');
END $$;

-- 17 (the exact path, object and active-collector rules are test 37)
DO $$
DECLARE v_c2 UUID; v_c2_rec UUID; v_a_rec UUID; v_forged_rec UUID; v_ok TEXT; v_path TEXT; n BIGINT;
BEGIN
  SELECT id, client_record_id INTO STRICT v_c2, v_c2_rec FROM public.collection_logs
  WHERE collector_id = t.id('c2') LIMIT 1;
  SELECT client_record_id INTO STRICT v_a_rec FROM public.collection_logs WHERE id = t.id('col_a');
  SELECT client_record_id INTO STRICT v_forged_rec FROM public.collection_logs WHERE id = t.id('col_forged');
  v_ok := t.put_object(t.evidence_path(t.id('c1'), v_forged_rec));
  PERFORM t.as_user(t.id('c1'));
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
  VALUES (t.id('col_forged'), v_ok, 'image/jpeg');
  BEGIN
    v_path := t.put_object(t.evidence_path(t.id('c1'), v_c2_rec));
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_c2, v_path, 'image/jpeg');
    RAISE EXCEPTION 'evidence on another collector''s row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    v_path := t.put_object(t.evidence_path(t.id('c1'), v_a_rec));
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (t.id('col_a'), v_path, 'image/jpeg');
    RAISE EXCEPTION 'evidence on a reviewed row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (t.id('col_forged'), v_ok, 'image/jpeg');
    RAISE EXCEPTION 'duplicate storage path accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- UPDATE/DELETE: either no privilege or no policy (0 rows).
  BEGIN
    UPDATE public.collection_evidence SET storage_path = 'moved.jpg';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'collector updated evidence';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.collection_evidence;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'collector deleted evidence';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.become('postgres');
  -- (other collections carry owner-inserted evidence from t.add_evidence)
  ASSERT (SELECT count(*) FROM public.collection_evidence WHERE collection_id = t.id('col_forged')) = 1;
  ASSERT (SELECT count(*) FROM public.collection_evidence WHERE starts_with(storage_path, t.id('c1')::text)) = 1;
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'collection_evidence'
                       AND column_name IN ('latitude', 'longitude')),
    'evidence still has its own coordinates (location belongs on collection_logs)';
  PERFORM t.pass('evidence: own pending collections only, paths unique, no update/delete, no duplicate coordinate columns');
END $$;

-- 18
DO $$ BEGIN
  ASSERT NOT EXISTS (
    SELECT c.id FROM public.collection_logs c
    LEFT JOIN public.collection_events e ON e.collection_id = c.id AND e.action = 'submitted'
    GROUP BY c.id HAVING count(e.id) <> 1), 'a collection without exactly one submitted event';
  ASSERT NOT EXISTS (
    SELECT c.id FROM public.collection_logs c
    LEFT JOIN public.collection_events e
      ON e.collection_id = c.id AND e.action IN ('approved', 'rejected')
    GROUP BY c.id, c.status, c.verified_by
    HAVING (c.status = 'pending' AND count(e.id) <> 0)
        OR (c.status <> 'pending' AND (count(e.id) <> 1
            OR bool_or(e.action <> c.status::text OR e.actor_id IS DISTINCT FROM c.verified_by)))),
    'review events do not match collection state';
  PERFORM t.pass('audit trail: one submitted event per collection, one matching review event per reviewed collection');
END $$;

-- ============================================================ round 3 additions
-- 19
DO $$
DECLARE v_ev UUID;
BEGIN
  SELECT id INTO STRICT v_ev FROM public.collection_events
  WHERE collection_id = t.id('col_forged') AND action = 'submitted';
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    UPDATE public.collection_logs SET reported_weight_kg = 99 WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'collector UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    UPDATE public.collection_logs SET status = 'approved' WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'collector status UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    DELETE FROM public.collection_logs WHERE id = t.id('col_forged');
    RAISE EXCEPTION 'collector DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    INSERT INTO public.collection_events (collection_id, actor_id, action)
    VALUES (t.id('col_forged'), t.id('c1'), 'approved');
    RAISE EXCEPTION 'collector event INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    UPDATE public.collection_events SET action = 'approved' WHERE id = v_ev;
    RAISE EXCEPTION 'collector event UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    DELETE FROM public.collection_events WHERE id = v_ev;
    RAISE EXCEPTION 'collector event DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT status = 'pending' AND reported_weight_kg = 5
          FROM public.collection_logs WHERE id = t.id('col_forged'));
  ASSERT (SELECT action FROM public.collection_events WHERE id = v_ev) = 'submitted';
  PERFORM t.pass('collector UPDATE/DELETE on collections and INSERT/UPDATE/DELETE on events are denied');
END $$;

-- 20
DO $$
DECLARE r public.collection_logs; e public.collection_events;
BEGIN
  SELECT * INTO STRICT r FROM public.collection_logs WHERE id = t.id('col_a');
  SELECT * INTO STRICT e FROM public.collection_events
  WHERE collection_id = r.id AND action = 'submitted';
  ASSERT e.actor_id = r.collector_id;
  ASSERT (e.details->>'site_id')::uuid = r.site_id, 'site_id';
  ASSERT e.details->>'material_code' = r.material_code, 'material_code';
  ASSERT (e.details->>'reported_weight_kg')::numeric = r.reported_weight_kg, 'weight';
  ASSERT (e.details->>'captured_at')::timestamptz = r.captured_at, 'captured_at';
  ASSERT (e.details->>'client_record_id')::uuid = r.client_record_id, 'client_record_id';
  ASSERT e.details->>'new_status' = 'pending';
  ASSERT e.created_at = r.submitted_at, 'event written in the insert transaction';
  PERFORM t.pass('submitted event carries site, material, reported weight, captured_at and client_record_id');
END $$;

-- 21: service_role (Edge Function key) cannot rewrite a collection either.
DO $$
DECLARE v_pending UUID := t.id('col_forged'); v_reviewed UUID := t.id('col_a');
BEGIN
  BEGIN
    PERFORM t.become('service_role');
    UPDATE public.collection_logs SET reported_weight_kg = 50 WHERE id = v_pending;
    RAISE EXCEPTION 'service_role changed the reported weight';
  EXCEPTION
    WHEN raise_exception THEN
      ASSERT SQLERRM = 'Submitted collection details cannot be changed', SQLERRM;
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('service_role');
    UPDATE public.collection_logs SET verified_weight_kg = 500 WHERE id = v_reviewed;
    RAISE EXCEPTION 'service_role changed a reviewed row';
  EXCEPTION
    WHEN raise_exception THEN
      ASSERT SQLERRM = 'Reviewed collections cannot be changed', SQLERRM;
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('service_role');
    UPDATE public.collection_logs SET status = 'rejected', rejection_reason = 'late',
      payment_eligible = false, verified_weight_kg = NULL
    WHERE id = v_reviewed;
    RAISE EXCEPTION 'service_role re-reviewed a row';
  EXCEPTION
    WHEN raise_exception THEN
      ASSERT SQLERRM = 'Reviewed collections cannot be changed', SQLERRM;
    WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT reported_weight_kg FROM public.collection_logs WHERE id = v_pending) = 5;
  ASSERT (SELECT status = 'approved' AND verified_weight_kg = 11.75
          FROM public.collection_logs WHERE id = v_reviewed);
  PERFORM t.pass('service_role cannot change the reported weight or any field of a reviewed row');
END $$;

-- 22
DO $$
DECLARE a TEXT;
BEGIN
  FOREACH a IN ARRAY ARRAY['pending', 'deleted', 'edited', 'APPROVED', ''] LOOP
    BEGIN
      INSERT INTO public.collection_events (collection_id, actor_id, action)
      VALUES (t.id('col_a'), t.id('m1'), a);
      RAISE EXCEPTION 'event action "%" accepted', a;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.collection_events (collection_id, actor_id, action)
    VALUES (t.id('col_a'), t.id('m1'), NULL);
    RAISE EXCEPTION 'NULL event action accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  PERFORM t.pass('event action is limited to submitted/approved/rejected (even for the owner)');
END $$;

-- 23
DO $$
DECLARE
  col TEXT;
  v_insert TEXT[] := ARRAY['client_record_id', 'site_id', 'material_code', 'reported_weight_kg', 'captured_at',
                           'device_latitude', 'device_longitude', 'device_accuracy_m'];
BEGIN
  FOR col IN SELECT attname FROM pg_attribute
             WHERE attrelid = 'public.collection_logs'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    ASSERT has_column_privilege('authenticated', 'public.collection_logs', col, 'INSERT') = (col = ANY (v_insert)),
      'authenticated INSERT on ' || col;
    ASSERT NOT has_column_privilege('authenticated', 'public.collection_logs', col, 'UPDATE'),
      'authenticated UPDATE on ' || col;
    ASSERT has_column_privilege('authenticated', 'public.collection_logs', col, 'SELECT'),
      'authenticated SELECT on ' || col;
    ASSERT NOT has_column_privilege('anon', 'public.collection_logs', col, 'SELECT, INSERT, UPDATE, REFERENCES'),
      'anon privilege on ' || col;
  END LOOP;
  ASSERT NOT has_table_privilege('authenticated', 'public.collection_logs', 'DELETE, TRUNCATE, TRIGGER');
  ASSERT NOT has_table_privilege('anon', 'public.collection_logs', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE');
  ASSERT has_table_privilege('authenticated', 'public.collection_events', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.collection_events', 'INSERT, UPDATE, DELETE, TRUNCATE');
  FOR col IN SELECT attname FROM pg_attribute
             WHERE attrelid = 'public.collection_events'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    ASSERT NOT has_column_privilege('authenticated', 'public.collection_events', col, 'INSERT, UPDATE'),
      'authenticated write on events.' || col;
  END LOOP;
  ASSERT NOT has_table_privilege('anon', 'public.collection_events', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE');
  PERFORM t.pass('catalog: collectors INSERT exactly 8 columns, no UPDATE/DELETE; events read-only; anon nothing');
END $$;

-- ============================================================ S1a: materials, breakdown, location
-- 24: approval without evidence
DO $$
DECLARE v_id UUID;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_d', t.site(1), 'MIXED', 9);
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_evidence WHERE collection_id = v_id);
  PERFORM t.review_fails(t.id('m1'), v_id, true, '[{"material_code": "PET", "weight_kg": 5}]', NULL,
                         'At least one photo evidence record is required for approval');
  -- rejection does not need evidence (nothing becomes payable)
  PERFORM t.add_evidence(v_id);    -- used by the next tests
  PERFORM t.pass('approval is refused without an evidence row, and nothing is written');
END $$;

-- 25: malformed breakdown JSON (non-array, wrong shape, unknown/missing keys)
DO $$
DECLARE v_id UUID := t.id('col_d'); j TEXT;
BEGIN
  FOREACH j IN ARRAY ARRAY['{}', '{"material_code": "PET", "weight_kg": 1}', '"PET"', '5', 'null'] LOOP
    PERFORM t.review_fails(t.id('m1'), v_id, true, j::jsonb, NULL, 'The verified breakdown must be a JSON array%');
  END LOOP;
  FOREACH j IN ARRAY ARRAY[
    '[1]', '["PET"]', '[null]', '[[]]',
    '[{"material_code": "PET"}]',
    '[{"weight_kg": 1}]',
    '[{"material_code": "PET", "weight_kg": 1, "note": "x"}]',
    '[{"material_code": "PET", "weight_kg": 1, "verified_weight_kg": 99}]',
    '[{"material": "PET", "weight_kg": 1}]'] LOOP
    PERFORM t.review_fails(t.id('m1'), v_id, true, j::jsonb, NULL,
                           'Each verified breakdown line must have exactly material_code and weight_kg');
  END LOOP;
  FOREACH j IN ARRAY ARRAY['[{"material_code": 1, "weight_kg": 1}]',
                           '[{"material_code": null, "weight_kg": 1}]'] LOOP
    PERFORM t.review_fails(t.id('m1'), v_id, true, j::jsonb, NULL, 'material_code must be a string');
  END LOOP;
  PERFORM t.pass('malformed breakdowns rejected: non-array, non-object lines, missing/unknown keys, non-string codes');
END $$;

-- 26: unverifiable materials (MIXED, inactive, unknown)
DO $$
DECLARE v_id UUID := t.id('col_d');
BEGIN
  INSERT INTO public.materials (code, display_name, is_reportable, is_verifiable, is_recycler_visible, is_active)
  VALUES ('ZZ_RETIRED', 'Retired test type', true, true, false, false);
  PERFORM t.review_fails(t.id('m1'), v_id, true, '[{"material_code": "MIXED", "weight_kg": 2}]', NULL,
                         'Material MIXED cannot be used in a verified breakdown');
  PERFORM t.review_fails(t.id('m1'), v_id, true,
                         '[{"material_code": "PET", "weight_kg": 1}, {"material_code": "ZZ_RETIRED", "weight_kg": 2}]', NULL,
                         'Material ZZ_RETIRED cannot be used in a verified breakdown');
  PERFORM t.review_fails(t.id('m1'), v_id, true, '[{"material_code": "OTHER", "weight_kg": 2}]', NULL,
                         'Unknown material code OTHER');
  PERFORM t.review_fails(t.id('m1'), v_id, true, '[{"material_code": "pet", "weight_kg": 2}]', NULL,
                         'Unknown material code pet');
  PERFORM t.pass('verified breakdown refuses MIXED, inactive and unknown material codes (case-sensitive)');
END $$;

-- 27: duplicate materials
DO $$ BEGIN
  PERFORM t.review_fails(t.id('m1'), t.id('col_d'), true,
    '[{"material_code": "PET", "weight_kg": 1}, {"material_code": "HDPE", "weight_kg": 2},
      {"material_code": "PET", "weight_kg": 3}]', NULL,
    'Material PET appears more than once in the verified breakdown');
  PERFORM t.pass('duplicate material codes in one breakdown are refused');
END $$;

-- 28: zero, negative, non-numeric and out-of-range weights
DO $$
DECLARE v_id UUID := t.id('col_d'); w TEXT;
BEGIN
  FOREACH w IN ARRAY ARRAY['0', '0.00', '-1', '-0.01'] LOOP
    PERFORM t.review_fails(t.id('m1'), v_id, true,
      format('[{"material_code": "PET", "weight_kg": %s}]', w)::jsonb, NULL,
      'weight_kg for PET must be greater than zero');
  END LOOP;
  FOREACH w IN ARRAY ARRAY['"3.5"', 'null', 'true', '[]', '{}'] LOOP
    PERFORM t.review_fails(t.id('m1'), v_id, true,
      format('[{"material_code": "PET", "weight_kg": %s}]', w)::jsonb, NULL,
      'weight_kg for PET must be a number');
  END LOOP;
  PERFORM t.review_fails(t.id('m1'), v_id, true,
    '[{"material_code": "PET", "weight_kg": 100000000}]', NULL, 'weight_kg for PET is too large');
  PERFORM t.pass('weights must be JSON numbers > 0 and within NUMERIC(10,2)');
END $$;

-- 29: more than two decimal places is refused, never rounded; a valid
-- breakdown with 1 and 2 decimals then succeeds
DO $$
DECLARE v_id UUID := t.id('col_d'); w TEXT;
BEGIN
  FOREACH w IN ARRAY ARRAY['1.005', '0.001', '2.999', '1e-3', '3.141'] LOOP
    PERFORM t.review_fails(t.id('m1'), v_id, true,
      format('[{"material_code": "PET", "weight_kg": %s}]', w)::jsonb, NULL,
      'weight_kg for PET must have at most 2 decimal places');
  END LOOP;
  PERFORM t.review_as(t.id('m1'), v_id, true,
    '[{"material_code": "HDPE", "weight_kg": 2.25}, {"material_code": "LDPE", "weight_kg": 1.5},
      {"material_code": "PP", "weight_kg": 4.00}, {"material_code": "PET", "weight_kg": 1.10}]', NULL);
  ASSERT (SELECT verified_weight_kg FROM public.collection_logs WHERE id = v_id) = 8.85;
  ASSERT (SELECT sum(weight_kg) FROM public.collection_verified_items WHERE collection_id = v_id) = 8.85;
  ASSERT t.item_count(v_id) = 4;
  PERFORM t.pass('weights with more than 2 decimals are refused (no rounding); a valid 4-line breakdown totals 8.85');
END $$;

-- 30: rejection with breakdown lines is refused
DO $$
DECLARE v_id UUID;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_e', t.site(1), 'PET', 3);
  PERFORM t.add_evidence(v_id);
  PERFORM t.review_fails(t.id('m1'), v_id, false, '[{"material_code": "PET", "weight_kg": 3}]', 'Wet load',
                         'A rejected collection cannot have a verified breakdown');
  PERFORM t.review_fails(t.id('m1'), v_id, false, '{}', 'Wet load',
                         'A rejected collection cannot have a verified breakdown');
  PERFORM t.pass('rejection refuses breakdown lines (only NULL or [] are accepted)');
END $$;

-- 31: nobody writes verified lines directly; lines are never changed
DO $$
DECLARE u TEXT; n BIGINT;
BEGIN
  FOREACH u IN ARRAY ARRAY['c1', 'm1', 'admin', 'r1'] LOOP
    BEGIN
      PERFORM t.as_user(t.id(u));
      INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
      VALUES (t.id('col_e'), 'PET', 3);
      RAISE EXCEPTION '% inserted a verified line', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM t.as_user(t.id(u));
      UPDATE public.collection_verified_items SET weight_kg = 99;
      RAISE EXCEPTION '% updated verified lines', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM t.as_user(t.id(u));
      DELETE FROM public.collection_verified_items;
      RAISE EXCEPTION '% deleted verified lines', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  FOREACH u IN ARRAY ARRAY['anon', 'service_role'] LOOP
    BEGIN
      PERFORM t.become(u);
      INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
      VALUES (t.id('col_e'), 'PET', 3);
      RAISE EXCEPTION '% inserted a verified line', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM t.become('postgres');
  -- even the owner: no updates, no lines on reviewed collections, no unverifiable materials, no duplicates
  BEGIN
    UPDATE public.collection_verified_items SET weight_kg = 99 WHERE collection_id = t.id('col_a');
    RAISE EXCEPTION 'owner updated a verified line';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Verified breakdown lines cannot be changed', SQLERRM; END;
  BEGIN
    INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
    VALUES (t.id('col_a'), 'HDPE', 1);
    RAISE EXCEPTION 'owner added a line to an approved collection';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'Verified breakdown lines can only be added to a pending collection', SQLERRM; END;
  BEGIN
    INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
    VALUES (t.id('col_e'), 'MIXED', 1);
    RAISE EXCEPTION 'owner added a MIXED line';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'Material MIXED cannot be used in a verified breakdown', SQLERRM; END;
  BEGIN
    INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
    VALUES (t.id('col_e'), 'PET', 0);
    RAISE EXCEPTION 'owner added a zero-weight line';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.collection_verified_items (collection_id, material_code, weight_kg)
    VALUES (t.id('col_e'), 'PET', 1), (t.id('col_e'), 'PET', 2);
    RAISE EXCEPTION 'owner added duplicate lines';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  ASSERT (SELECT weight_kg FROM public.collection_verified_items
          WHERE collection_id = t.id('col_a') AND material_code = 'PET') = 8.25;
  ASSERT t.item_count(t.id('col_e')) = 0;
  ASSERT NOT has_table_privilege('authenticated', 'public.collection_verified_items', 'INSERT, UPDATE, DELETE, TRUNCATE');
  ASSERT NOT has_any_column_privilege('authenticated', 'public.collection_verified_items', 'INSERT, UPDATE');
  ASSERT NOT has_table_privilege('service_role', 'public.collection_verified_items', 'SELECT, INSERT, UPDATE, DELETE');
  ASSERT NOT has_table_privilege('anon', 'public.collection_verified_items', 'SELECT, INSERT, UPDATE, DELETE');
  PERFORM t.pass('verified lines: no client or service_role writes; never updated; only pending + verifiable + unique + positive, even for the owner');
END $$;

-- 32: materials lookup: contents, read access, no writes
DO $$
DECLARE u TEXT; n BIGINT;
BEGIN
  ASSERT (SELECT string_agg(format('%s:%s%s%s%s', code,
            is_reportable::int, is_verifiable::int, is_recycler_visible::int, is_active::int), ',' ORDER BY sort_order)
          FROM public.materials WHERE code NOT LIKE 'ZZ\_%')
       = 'PET:1111,PP:1111,HDPE:1111,LDPE:1111,PLASTIC_BAGS:1111,MIXED:1001',
    'seeded materials/flags differ';
  ASSERT NOT EXISTS (SELECT 1 FROM public.materials WHERE code IN ('OTHER', 'RESIDUE'));
  ASSERT to_regtype('public.material_type') IS NULL, 'the old material_type enum still exists';
  FOREACH u IN ARRAY ARRAY['c1', 'm1', 'r1', 'admin', 'c_off'] LOOP
    PERFORM t.as_user(t.id(u));
    SELECT count(*) INTO n FROM public.materials WHERE code NOT LIKE 'ZZ\_%';
    ASSERT n = 6, u || ' sees ' || n || ' materials';
    BEGIN
      INSERT INTO public.materials (code, display_name) VALUES ('ZZ_NEW', 'x');
      RAISE EXCEPTION '% inserted a material', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.materials SET is_verifiable = true WHERE code = 'MIXED';
      RAISE EXCEPTION '% updated a material', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      DELETE FROM public.materials WHERE code = 'PET';
      RAISE EXCEPTION '% deleted a material', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM t.become('anon');
    PERFORM 1 FROM public.materials;
    RAISE EXCEPTION 'anon read materials';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.become('service_role');
    PERFORM 1 FROM public.materials;
    RAISE EXCEPTION 'service_role read materials';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.become('postgres');
  BEGIN
    INSERT INTO public.materials (code, display_name, is_verifiable, is_recycler_visible)
    VALUES ('ZZ_BAD', 'x', false, true);
    RAISE EXCEPTION 'recycler-visible but unverifiable material accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.materials (code, display_name) VALUES ('lower case', 'x');
    RAISE EXCEPTION 'badly formatted code accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.materials SET code = 'PETX' WHERE code = 'PET';
    RAISE EXCEPTION 'a referenced material code was renamed';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  PERFORM t.pass('materials: 6 seeded types with exact flags, no OTHER, enum gone; every signed-in user reads; nobody but the owner writes; anon/service_role denied');
END $$;

-- 33: submissions only accept active, reportable materials
DO $$
DECLARE v_code TEXT;
BEGIN
  INSERT INTO public.materials (code, display_name, is_reportable, is_verifiable, is_active)
  VALUES ('ZZ_VERIFY_ONLY', 'Verify-only test type', false, true, true),
         ('ZZ_OLD_REPORTABLE', 'Inactive reportable test type', true, false, false);
  FOREACH v_code IN ARRAY ARRAY['ZZ_VERIFY_ONLY', 'ZZ_OLD_REPORTABLE', 'NOPE', 'pet'] LOOP
    BEGIN
      PERFORM t.submit(t.id('c1'), 'x', t.site(1), v_code, 1);
      RAISE EXCEPTION 'submission with % accepted', v_code;
    EXCEPTION WHEN check_violation THEN
      ASSERT SQLERRM = format('Material %s cannot be reported', v_code), SQLERRM;
    END;
  END LOOP;
  -- every seeded reportable type is accepted, including MIXED
  FOREACH v_code IN ARRAY ARRAY['PET', 'PP', 'HDPE', 'LDPE', 'PLASTIC_BAGS', 'MIXED'] LOOP
    PERFORM t.submit(t.id('c2'), 'x', t.site(2), v_code, 1);
  END LOOP;
  PERFORM t.pass('collection submissions refuse inactive, non-reportable and unknown materials; all 6 seeded types are reportable');
END $$;

-- 34: device location: validation, storage, audit and immutability
DO $$
DECLARE r public.collection_logs; e public.collection_events; v_rec UUID := gen_random_uuid();
        bad TEXT; n BIGINT;
BEGIN
  PERFORM t.as_user(t.id('c1'));
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg,
                                      device_latitude, device_longitude, device_accuracy_m)
  VALUES (v_rec, t.site(1), 'PET', 2, -1.2921, 36.8219, 12.5);
  PERFORM t.become('postgres');
  SELECT * INTO STRICT r FROM public.collection_logs WHERE client_record_id = v_rec;
  PERFORM t.put('col_loc', r.id);
  ASSERT r.device_latitude = -1.2921 AND r.device_longitude = 36.8219 AND r.device_accuracy_m = 12.5;
  SELECT * INTO STRICT e FROM public.collection_events WHERE collection_id = r.id AND action = 'submitted';
  ASSERT (e.details->>'device_latitude')::float8 = -1.2921
     AND (e.details->>'device_longitude')::float8 = 36.8219
     AND (e.details->>'device_accuracy_m')::float8 = 12.5, 'location in submitted event';

  -- boundaries and "permission denied" (all NULL) are accepted
  PERFORM t.as_user(t.id('c1'));
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg,
                                      device_latitude, device_longitude, device_accuracy_m)
  VALUES (gen_random_uuid(), t.site(1), 'PET', 1, -90, 180, 0),
         (gen_random_uuid(), t.site(1), 'PET', 1, 90, -180, NULL),
         (gen_random_uuid(), t.site(1), 'PET', 1, NULL, NULL, NULL);

  FOREACH bad IN ARRAY ARRAY[
    '90.0001, 0, NULL', '-91, 0, NULL', '0, 180.5, NULL', '0, -181, NULL',
    '1, NULL, NULL', 'NULL, 1, NULL', '1, 1, -0.1', 'NULL, NULL, 5',
    '''NaN''::float8, 0, NULL', '0, ''NaN''::float8, NULL', '1, 1, ''NaN''::float8',
    '1, 1, ''Infinity''::float8', '''Infinity''::float8, 0, NULL'] LOOP
    BEGIN
      PERFORM t.as_user(t.id('c1'));
      EXECUTE format(
        'INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg,
                                             device_latitude, device_longitude, device_accuracy_m)
         VALUES (gen_random_uuid(), %L, ''PET'', 1, %s)', t.site(1), bad);
      RAISE EXCEPTION 'device location (%) accepted', bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  -- immutable after submission, even for the owner and service_role
  PERFORM t.become('postgres');
  FOREACH bad IN ARRAY ARRAY['device_latitude = 0', 'device_longitude = 0', 'device_accuracy_m = 1',
                             'device_latitude = NULL, device_longitude = NULL, device_accuracy_m = NULL',
                             'material_code = ''HDPE''', 'captured_at = now()', 'site_id = ' || quote_literal(t.site(2))] LOOP
    BEGIN
      EXECUTE format('UPDATE public.collection_logs SET %s WHERE id = %L', bad, r.id);
      RAISE EXCEPTION 'owner changed submitted field: %', bad;
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'Submitted collection details cannot be changed', bad || ': ' || SQLERRM;
    END;
  END LOOP;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    UPDATE public.collection_logs SET device_latitude = 0 WHERE id = r.id;
    RAISE EXCEPTION 'collector updated location';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.become('postgres');
  SELECT count(*) INTO n FROM public.collection_logs
  WHERE id = r.id AND device_latitude = -1.2921 AND material_code = 'PET';
  ASSERT n = 1;
  PERFORM t.pass('device location: ranges, lat/lng pairing, finite accuracy >= 0 with coordinates; stored and audited; immutable like other submitted fields');
END $$;

-- 35: verified lines follow the parent collection's visibility; recyclers denied
DO $$
DECLARE n BIGINT; u TEXT;
BEGIN
  -- col_a: c1's approved collection at site 1, 2 lines
  FOREACH u IN ARRAY ARRAY['c1', 'm1', 'admin'] LOOP
    PERFORM t.as_user(t.id(u));
    SELECT count(*) INTO n FROM public.collection_verified_items WHERE collection_id = t.id('col_a');
    ASSERT n = 2, u || ' sees ' || n || ' lines of col_a';
  END LOOP;
  -- r1 (recycler at col_a's site) reads neither the collection nor its lines
  PERFORM t.as_user(t.id('r1'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs WHERE id = t.id('col_a')),
    'recycler r1 reads col_a';
  SELECT count(*) INTO n FROM public.collection_verified_items;
  ASSERT n = 0, 'recycler r1 sees ' || n || ' lines';
  FOREACH u IN ARRAY ARRAY['c2', 'm2', 'r2', 'm_off'] LOOP
    PERFORM t.as_user(t.id(u));
    SELECT count(*) INTO n FROM public.collection_verified_items WHERE collection_id = t.id('col_a');
    ASSERT n = 0, u || ' sees ' || n || ' lines of col_a';
  END LOOP;
  -- c1 sees only its own collections' lines; m1 only site 1
  PERFORM t.as_user(t.id('c1'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_verified_items vi
                     JOIN public.collection_logs c ON c.id = vi.collection_id
                     WHERE c.collector_id <> t.id('c1'));
  PERFORM t.as_user(t.id('admin'));
  SELECT count(*) INTO n FROM public.collection_verified_items;
  PERFORM t.become('postgres');
  ASSERT n = (SELECT count(*) FROM public.collection_verified_items), 'admin sees all lines';
  BEGIN
    PERFORM t.become('anon');
    PERFORM 1 FROM public.collection_verified_items;
    RAISE EXCEPTION 'anon read verified lines';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.pass('verified lines visible to the owning collector, site managers and admins only; recyclers, other sites, inactive users and anon see none');
END $$;

-- ============================================================ S1b: recycler denial, evidence insert
-- 36: recyclers read 0 rows from collection_logs, collection_evidence,
-- collection_events and collection_verified_items, including at their own
-- site and for approved collections. Ground truth is checked first so the
-- test cannot pass vacuously.
DO $$
DECLARE n BIGINT; u TEXT; tbl TEXT;
BEGIN
  -- site 1 has approved and pending collections with evidence, events and lines
  ASSERT EXISTS (SELECT 1 FROM public.collection_logs WHERE site_id = t.site(1) AND status = 'approved');
  ASSERT EXISTS (SELECT 1 FROM public.collection_logs WHERE site_id = t.site(1) AND status = 'pending');
  ASSERT (SELECT count(*) FROM public.collection_evidence) > 0;
  ASSERT (SELECT count(*) FROM public.collection_events) > 0;
  ASSERT (SELECT count(*) FROM public.collection_verified_items WHERE collection_id = t.id('col_a')) > 0;
  -- r_multi: active recycler assigned to every site that has collections
  PERFORM t.mkuser('r_multi', 'rmulti@example.test', true);
  PERFORM t.set_profile(t.id('r_multi'), 'recycler', true);
  PERFORM t.assign(t.id('r_multi'), t.site(1));
  PERFORM t.assign(t.id('r_multi'), t.site(2));

  FOREACH u IN ARRAY ARRAY['r1', 'r2', 'r_multi'] LOOP
    FOREACH tbl IN ARRAY ARRAY['collection_logs', 'collection_evidence',
                               'collection_events', 'collection_verified_items'] LOOP
      PERFORM t.as_user(t.id(u));
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO n;
      PERFORM t.become('postgres');
      ASSERT n = 0, format('recycler %s reads %s rows from %s', u, n, tbl);
    END LOOP;
  END LOOP;

  -- direct lookups by id are denied too
  PERFORM t.as_user(t.id('r1'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_events WHERE collection_id = t.id('col_a'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_evidence WHERE collection_id = t.id('col_a'));
  PERFORM t.become('postgres');

  -- the same rows are still visible to the owner, the site manager and admin
  FOREACH u IN ARRAY ARRAY['c1', 'm1', 'admin'] LOOP
    PERFORM t.as_user(t.id(u));
    ASSERT EXISTS (SELECT 1 FROM public.collection_events WHERE collection_id = t.id('col_a')),
      u || ' cannot read col_a events';
    ASSERT EXISTS (SELECT 1 FROM public.collection_evidence WHERE collection_id = t.id('col_a')),
      u || ' cannot read col_a evidence';
    PERFORM t.become('postgres');
  END LOOP;
  -- and not to another site's manager or collector
  FOREACH u IN ARRAY ARRAY['m2', 'c2', 'm_off'] LOOP
    PERFORM t.as_user(t.id(u));
    ASSERT NOT EXISTS (SELECT 1 FROM public.collection_events WHERE collection_id = t.id('col_a')),
      u || ' reads col_a events';
    ASSERT NOT EXISTS (SELECT 1 FROM public.collection_evidence WHERE collection_id = t.id('col_a')),
      u || ' reads col_a evidence';
    PERFORM t.become('postgres');
  END LOOP;
  PERFORM t.pass('recyclers (single- and multi-site) read 0 rows from collections, evidence, events and verified lines; owner, site manager and admin still read them');
END $$;

-- 37: evidence INSERT: column grants, server-set uploaded_at, the exact
-- storage path {auth.uid()}/{client_record_id}/{uuid}.jpg, the object must
-- exist in collection-evidence, image/jpeg, own pending collection, active
-- collector only (policy in 006)
DO $$
DECLARE
  v_id UUID; v_rec UUID; v_other UUID; v_other_rec UUID; v_dir TEXT; v_name TEXT;
  v_ok1 TEXT; v_ok2 TEXT; v_path TEXT; v_off UUID; v_off_rec UUID := gen_random_uuid();
  r public.collection_evidence; col TEXT; n BIGINT;
  v_bad TEXT;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_ev', t.site(1), 'PET', 3);
  v_rec := t.id('col_ev_rec');
  v_other := t.submit(t.id('c1'), 'col_ev2', t.site(1), 'PP', 4);
  v_other_rec := t.id('col_ev2_rec');
  v_dir := t.id('c1') || '/' || v_rec || '/';
  v_name := gen_random_uuid() || '.jpg';

  -- column grants: exactly these four, nothing else; no UPDATE
  FOR col IN SELECT attname FROM pg_attribute
             WHERE attrelid = 'public.collection_evidence'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    ASSERT has_column_privilege('authenticated', 'public.collection_evidence', col, 'INSERT')
           = (col = ANY (ARRAY['collection_id', 'storage_path', 'content_type', 'captured_at'])),
      'authenticated INSERT on evidence.' || col;
    ASSERT NOT has_column_privilege('authenticated', 'public.collection_evidence', col, 'UPDATE'),
      'authenticated UPDATE on evidence.' || col;
  END LOOP;
  ASSERT NOT has_table_privilege('authenticated', 'public.collection_evidence', 'INSERT');

  v_ok1 := t.put_object(v_dir || gen_random_uuid() || '.jpg');
  v_ok2 := t.put_object(v_dir || gen_random_uuid() || '.jpg');

  PERFORM t.as_user(t.id('c1'));
  -- uploaded_at and id cannot be supplied by the client
  BEGIN
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type, uploaded_at)
    VALUES (v_id, v_ok1, 'image/jpeg', '2000-01-01');
    RAISE EXCEPTION 'client supplied uploaded_at';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.collection_evidence (id, collection_id, storage_path, content_type)
    VALUES (gen_random_uuid(), v_id, v_ok1, 'image/jpeg');
    RAISE EXCEPTION 'client supplied id';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- anything but exactly {c1}/{v_rec}/{uuid}.jpg is refused, even when an
  -- object with that name exists
  FOREACH v_bad IN ARRAY ARRAY[
    v_name,                                               -- no folders
    v_rec || '/' || v_name,                               -- missing uid
    t.id('c1') || '/' || v_name,                          -- missing record id
    v_dir,                                                -- folder only, no file name
    t.id('c1') || '/' || v_rec || 'x/' || v_name,         -- record id is only a prefix
    t.id('c2') || '/' || v_rec || '/' || v_name,          -- another user's folder
    t.id('c1') || '/' || v_other_rec || '/' || v_name,    -- own, but another collection
    t.id('c1') || '/' || v_id || '/' || v_name,           -- server id, not client_record_id
    upper(v_dir) || v_name,                               -- case differs (folders)
    v_dir || upper(gen_random_uuid()::text) || '.jpg',    -- case differs (file)
    '/' || v_dir || v_name,                               -- leading slash
    t.id('c1') || '//' || v_rec || '/' || v_name,         -- empty segment
    v_dir || 'thumbs/' || v_name,                         -- extra segment
    v_dir || '../' || v_rec || '/' || v_name,             -- dot-dot
    v_dir || '..' || v_name,                              -- dots in the file name
    v_dir || v_name || '/x.jpg',                          -- trailing segment
    v_dir || 'photo-1.jpg',                               -- file name not a UUID
    v_dir || gen_random_uuid() || '.jpeg',                -- other extension
    v_dir || gen_random_uuid() || '.JPG',
    v_dir || gen_random_uuid() || '.png',
    v_dir || gen_random_uuid() || '.jpg.jpg',
    v_dir || gen_random_uuid(),                           -- no extension
    v_dir || gen_random_uuid() || '.jpg' || E'\n'         -- trailing newline
  ] LOOP
    PERFORM t.put_object(v_bad);
    BEGIN
      PERFORM t.as_user(t.id('c1'));
      INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
      VALUES (v_id, v_bad, 'image/jpeg');
      RAISE EXCEPTION 'evidence path accepted: %', v_bad;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;

  -- a valid path with no object, or with the object only in another
  -- bucket, is refused; so is any content type but image/jpeg
  PERFORM t.become('postgres');
  INSERT INTO storage.buckets (id, name) VALUES ('other-bucket', 'other-bucket');
  v_path := v_dir || gen_random_uuid() || '.jpg';
  PERFORM t.put_object(v_path, 'other-bucket');
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_id, v_dir || gen_random_uuid() || '.jpg', 'image/jpeg');
    RAISE EXCEPTION 'evidence accepted without a stored object';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_id, v_path, 'image/jpeg');
    RAISE EXCEPTION 'evidence accepted with the object in another bucket';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH v_bad IN ARRAY ARRAY['image/png', 'IMAGE/JPEG', 'image/jpg', ''] LOOP
    BEGIN
      PERFORM t.as_user(t.id('c1'));
      INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
      VALUES (v_id, v_ok1, v_bad);
      RAISE EXCEPTION 'content type accepted: %', v_bad;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;

  -- valid paths with stored objects are accepted; uploaded_at is the server's
  PERFORM t.as_user(t.id('c1'));
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type, captured_at)
  VALUES (v_id, v_ok1, 'image/jpeg', '2000-01-01');
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
  VALUES (v_id, v_ok2, 'image/jpeg');
  PERFORM t.become('postgres');
  SELECT * INTO STRICT r FROM public.collection_evidence WHERE storage_path = v_ok1;
  ASSERT r.uploaded_at = now(), 'uploaded_at is server-set';
  ASSERT r.captured_at = '2000-01-01', 'captured_at kept as device-reported';
  ASSERT (SELECT count(*) FROM public.collection_evidence WHERE collection_id = v_id) = 2;

  -- the trigger forces uploaded_at even for an owner insert
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type, uploaded_at)
  VALUES (v_id, 'owner/' || gen_random_uuid() || '.jpg', 'image/jpeg', '2000-01-01')
  RETURNING * INTO r;
  ASSERT r.uploaded_at = now(), 'owner-supplied uploaded_at kept';

  -- a manager, recycler, admin, inactive collector or other collector
  -- cannot add evidence to c1's collection, even with a stored c1 path
  FOREACH col IN ARRAY ARRAY['m1', 'r1', 'admin', 'c_off', 'c2'] LOOP
    v_path := t.put_object(v_dir || gen_random_uuid() || '.jpg');
    BEGIN
      PERFORM t.as_user(t.id(col));
      INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
      VALUES (v_id, v_path, 'image/jpeg');
      RAISE EXCEPTION '% added evidence to c1''s collection', col;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM t.become('postgres');

  -- an inactive collector cannot add evidence even to their own pending
  -- collection (created as the owner: they could not submit one now)
  INSERT INTO public.collection_logs (client_record_id, collector_id, site_id, material_code, reported_weight_kg)
  VALUES (v_off_rec, t.id('c_off'), t.site(1), 'PET', 1) RETURNING id INTO v_off;
  v_path := t.put_object(t.evidence_path(t.id('c_off'), v_off_rec));
  BEGIN
    PERFORM t.as_user(t.id('c_off'));
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_off, v_path, 'image/jpeg');
    RAISE EXCEPTION 'inactive collector added evidence';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.become('postgres');

  -- service_role and anon have no INSERT at all
  BEGIN
    PERFORM t.become('service_role');
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_id, v_dir || gen_random_uuid() || '.jpg', 'image/jpeg');
    RAISE EXCEPTION 'service_role inserted evidence';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM t.become('anon');
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_id, v_dir || gen_random_uuid() || '.jpg', 'image/jpeg');
    RAISE EXCEPTION 'anon inserted evidence';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.become('postgres');

  -- once reviewed, even a correct path with a stored object is refused
  PERFORM t.review_as(t.id('m1'), v_id, false, NULL, 'blurry photos');
  v_path := t.put_object(v_dir || gen_random_uuid() || '.jpg');
  BEGIN
    PERFORM t.as_user(t.id('c1'));
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_id, v_path, 'image/jpeg');
    RAISE EXCEPTION 'evidence added after review';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.become('postgres');
  SELECT count(*) INTO n FROM public.collection_evidence WHERE collection_id = v_id;
  ASSERT n = 3, 'evidence rows for col_ev: ' || n;
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_evidence WHERE collection_id = v_off);
  PERFORM t.pass('evidence insert: 4 client columns, server-set uploaded_at (even for owner), exact {uid}/{client_record_id}/{uuid}.jpg path with a stored collection-evidence object, image/jpeg, own pending collection, active collector only');
END $$;
