-- COLLECTIONS: insert integrity, offline idempotency, review RPC, payout
-- eligibility, finality, audit events, RLS reads and evidence (migration 001).
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
                         p_material public.material_type, p_kg NUMERIC)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_rec UUID := gen_random_uuid(); v_id UUID;
BEGIN
  PERFORM t.as_user(p_user);
  INSERT INTO public.collection_logs (client_record_id, site_id, material,
                                      reported_weight_kg, captured_at)
  VALUES (v_rec, p_site, p_material, p_kg, now() - interval '1 hour');
  PERFORM t.become('postgres');
  SELECT id INTO STRICT v_id FROM public.collection_logs
  WHERE collector_id = p_user AND client_record_id = v_rec;
  PERFORM t.put(p_key || '_rec', v_rec);
  RETURN t.put(p_key, v_id);
END $$;

CREATE FUNCTION t.review_as(p_user UUID, p_id UUID, p_ok BOOLEAN,
                            p_kg NUMERIC, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(p_user);
  PERFORM public.review_collection(p_id, p_ok, p_kg, p_reason);
  PERFORM t.become('postgres');
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
        'INSERT INTO public.collection_logs (client_record_id, site_id, material, reported_weight_kg, %I)
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
    INSERT INTO public.collection_logs (client_record_id, site_id, material, reported_weight_kg)
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
    INSERT INTO public.collection_logs (client_record_id, site_id, material, reported_weight_kg)
    VALUES (v_rec, t.site(1), 'HDPE', 3);
    RAISE EXCEPTION 'duplicate offline key accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  PERFORM t.as_user(t.id('c2'));
  INSERT INTO public.collection_logs (client_record_id, site_id, material, reported_weight_kg)
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
  INSERT INTO public.collection_logs (client_record_id, collector_id, site_id, material,
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

-- 8
DO $$
DECLARE r public.collection_logs; e public.collection_events;
BEGIN
  PERFORM t.review_as(t.id('m1'), t.id('col_a'), true, 11.75, NULL);
  SELECT * INTO STRICT r FROM public.collection_logs WHERE id = t.id('col_a');
  ASSERT r.status = 'approved' AND r.payment_eligible = true;
  ASSERT r.verified_weight_kg = 11.75 AND r.reported_weight_kg = 12.5, 'weights kept separate';
  ASSERT r.verified_by = t.id('m1') AND r.verified_at = now();
  ASSERT r.rejection_reason IS NULL;
  SELECT * INTO STRICT e FROM public.collection_events
  WHERE collection_id = t.id('col_a') AND action = 'approved';
  ASSERT e.actor_id = t.id('m1');
  ASSERT e.details->>'previous_status' = 'pending' AND e.details->>'new_status' = 'approved';
  ASSERT (e.details->>'reported_weight_kg')::numeric = 12.5;
  ASSERT (e.details->>'verified_weight_kg')::numeric = 11.75;
  ASSERT (e.details->>'payment_eligible')::boolean;
  PERFORM t.pass('site manager approval: verified weight separate from reported, payout eligible, approved event with actor');
END $$;

-- 9
DO $$
DECLARE v_id UUID; v_events BIGINT;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_b', t.site(1), 'HDPE', 4);
  SELECT count(*) INTO v_events FROM public.collection_events WHERE collection_id = v_id;
  BEGIN
    PERFORM t.review_as(t.id('m1'), v_id, true, NULL, NULL);
    RAISE EXCEPTION 'approved without weight';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'A valid verified weight%', SQLERRM; END;
  BEGIN
    PERFORM t.review_as(t.id('m1'), v_id, true, 0, NULL);
    RAISE EXCEPTION 'approved with zero weight';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'A valid verified weight%', SQLERRM; END;
  BEGIN
    PERFORM t.review_as(t.id('m1'), v_id, true, -1, NULL);
    RAISE EXCEPTION 'approved with negative weight';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'A valid verified weight%', SQLERRM; END;
  BEGIN
    PERFORM t.review_as(t.id('m1'), v_id, false, NULL, NULL);
    RAISE EXCEPTION 'rejected without reason';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'A rejection reason is required', SQLERRM; END;
  BEGIN
    PERFORM t.review_as(t.id('m1'), v_id, false, NULL, '   ');
    RAISE EXCEPTION 'rejected with blank reason';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'A rejection reason is required', SQLERRM; END;
  ASSERT (SELECT status FROM public.collection_logs WHERE id = v_id) = 'pending';
  ASSERT (SELECT count(*) FROM public.collection_events WHERE collection_id = v_id) = v_events;
  PERFORM t.pass('approval needs a positive verified weight; rejection needs a non-blank reason; failures change nothing');
END $$;

-- 10
DO $$
DECLARE r public.collection_logs; e public.collection_events;
BEGIN
  PERFORM t.review_as(t.id('m1'), t.id('col_b'), false, 3, '  Contaminated load  ');
  SELECT * INTO STRICT r FROM public.collection_logs WHERE id = t.id('col_b');
  ASSERT r.status = 'rejected' AND r.payment_eligible = false;
  ASSERT r.rejection_reason = 'Contaminated load', 'reason trimmed';
  ASSERT r.verified_weight_kg IS NULL, 'rejection ignores weight';
  ASSERT r.verified_by = t.id('m1') AND r.verified_at IS NOT NULL;
  SELECT * INTO STRICT e FROM public.collection_events
  WHERE collection_id = t.id('col_b') AND action = 'rejected';
  ASSERT e.actor_id = t.id('m1') AND e.details->>'rejection_reason' = 'Contaminated load';
  ASSERT NOT (e.details->>'payment_eligible')::boolean;
  PERFORM t.pass('rejection: trimmed reason, not payout eligible, rejected event with actor and reason');
END $$;

-- 11
DO $$
DECLARE v_id UUID; u TEXT;
BEGIN
  v_id := t.submit(t.id('c1'), 'col_c', t.site(1), 'MIXED', 7);
  FOREACH u IN ARRAY ARRAY['m2', 'c1', 'r1', 'm_off', 'c2'] LOOP
    BEGIN
      PERFORM t.review_as(t.id(u), v_id, true, 7, NULL);
      RAISE EXCEPTION '% could review', u;
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'You are not authorised to review this collection', u || ': ' || SQLERRM;
    END;
  END LOOP;
  BEGIN
    PERFORM t.become('anon');
    PERFORM public.review_collection(v_id, true, 7, NULL);
    RAISE EXCEPTION 'anon could review';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      ASSERT SQLERRM = 'You are not authorised to review this collection', SQLERRM;
  END;
  ASSERT (SELECT status FROM public.collection_logs WHERE id = v_id) = 'pending';
  ASSERT (SELECT count(*) FROM public.collection_events WHERE collection_id = v_id) = 1;
  PERFORM t.pass('other-site manager, own collector, recycler, inactive manager and anon cannot review');
END $$;

-- 12
DO $$ BEGIN
  PERFORM t.review_as(t.id('admin'), t.id('col_c'), true, 6.5, NULL);
  ASSERT (SELECT status = 'approved' AND verified_by = t.id('admin')
          FROM public.collection_logs WHERE id = t.id('col_c'));
  PERFORM t.pass('an active admin can review a collection at any site');
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

  PERFORM t.as_user(t.id('r1'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs
                     WHERE status <> 'approved' OR site_id <> t.site(1)), 'r1 sees too much';
  ASSERT EXISTS (SELECT 1 FROM public.collection_logs WHERE id = t.id('col_a'));

  PERFORM t.as_user(t.id('r2'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.collection_logs WHERE site_id = t.site(1)), 'r2 sees site 1';

  PERFORM t.as_user(t.id('m_off'));
  SELECT count(*) INTO n FROM public.collection_logs;
  ASSERT n = 0, 'inactive manager sees ' || n;

  PERFORM t.as_user(t.id('admin'));
  SELECT count(*) INTO n FROM public.collection_logs;
  ASSERT n = v_total, 'admin sees ' || n || ' of ' || v_total;
  PERFORM t.pass('RLS reads: own rows; managers by site; recyclers approved at their site only; admin all');
END $$;

-- 17
DO $$
DECLARE v_c2 UUID; n BIGINT;
BEGIN
  SELECT id INTO STRICT v_c2 FROM public.collection_logs
  WHERE collector_id = t.id('c2') LIMIT 1;
  PERFORM t.as_user(t.id('c1'));
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type, latitude, longitude)
  VALUES (t.id('col_forged'), 'c1/forged/1.jpg', 'image/jpeg', -1.29, 36.82);
  BEGIN
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (v_c2, 'c1/other/1.jpg', 'image/jpeg');
    RAISE EXCEPTION 'evidence on another collector''s row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (t.id('col_a'), 'c1/approved/1.jpg', 'image/jpeg');
    RAISE EXCEPTION 'evidence on a reviewed row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type, latitude)
    VALUES (t.id('col_forged'), 'c1/forged/2.jpg', 'image/jpeg', 91);
    RAISE EXCEPTION 'latitude 91 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
    VALUES (t.id('col_forged'), 'c1/forged/1.jpg', 'image/jpeg');
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
  ASSERT (SELECT count(*) FROM public.collection_evidence) = 1;
  PERFORM t.pass('evidence: own pending collections only, coordinates checked, paths unique, no update/delete');
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
  ASSERT e.details->>'material' = r.material::text, 'material';
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
  v_insert TEXT[] := ARRAY['client_record_id', 'site_id', 'material', 'reported_weight_kg', 'captured_at'];
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
  PERFORM t.pass('catalog: collectors INSERT exactly 5 columns, no UPDATE/DELETE; events read-only; anon nothing');
END $$;
