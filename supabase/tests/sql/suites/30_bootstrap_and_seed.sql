-- SEED and FIRST-ADMIN BOOTSTRAP (seed.sql, migration 004).
-- Order matters: the seed and eligibility tests run while no admin exists;
-- the concurrency test creates the first admin.
SET client_min_messages = notice;

-- ============================================================ seed
-- 1
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.sites) = 9, 'site count';
  ASSERT (SELECT array_agg(name ORDER BY name) FROM public.sites)
       = (SELECT array_agg('TEST Site ' || n ORDER BY 'TEST Site ' || n) FROM generate_series(1, 9) AS n),
       'site names';
  ASSERT NOT EXISTS (SELECT 1 FROM public.sites WHERE NOT active);
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_sites), 'seed assigned users';
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles), 'seed created profiles';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.users), 'seed created auth users';
  PERFORM t.pass('seed: exactly 9 active TEST sites, no users, profiles or assignments');
END $$;

-- 2 (PostGIS shim: location is TEXT here, so this checks the literal only)
DO $$ BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.sites
    WHERE location !~ '^SRID=4326;POINT\(0\.00[1-9] 0\.00[1-9]\)$'), 'non-fictional location';
  PERFORM t.pass('seed: every location is a fictional point near 0,0 (text check under the PostGIS shim)');
END $$;

CREATE TABLE t.seed_before AS SELECT id, name, created_at FROM public.sites;
\i :seed_file

-- 3
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.sites) = 9, 'seed re-run added rows';
  ASSERT NOT EXISTS (
    (SELECT id, name, created_at FROM public.sites)
    EXCEPT (SELECT id, name, created_at FROM t.seed_before)), 'seed re-run changed rows';
  PERFORM t.pass('seed is idempotent: re-running inserts and changes nothing');
END $$;

-- ============================================================ bootstrap eligibility
-- 4
DO $$
DECLARE e TEXT;
BEGIN
  FOREACH e IN ARRAY ARRAY[NULL, '', '   '] LOOP
    BEGIN
      PERFORM public.bootstrap_first_admin(e);
      RAISE EXCEPTION 'blank email accepted';
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'An email address is required', SQLERRM;
    END;
  END LOOP;
  BEGIN
    PERFORM public.bootstrap_first_admin('nobody@example.test');
    RAISE EXCEPTION 'unknown email accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'No eligible Auth user%', SQLERRM; END;
  PERFORM t.pass('bootstrap: blank and unknown emails refused');
END $$;

-- 5
DO $$
DECLARE v UUID;
BEGIN
  PERFORM t.mkuser('unconf', 'unconfirmed@example.test');
  BEGIN
    PERFORM public.bootstrap_first_admin('unconfirmed@example.test');
    RAISE EXCEPTION 'unconfirmed accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE '%has not confirmed their email', SQLERRM; END;

  v := t.mkuser('deleted', 'deleted@example.test', true);
  UPDATE auth.users SET deleted_at = now() WHERE id = v;
  BEGIN
    PERFORM public.bootstrap_first_admin('deleted@example.test');
    RAISE EXCEPTION 'deleted user accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'No eligible Auth user%', SQLERRM; END;

  v := t.mkuser('banned', 'banned@example.test', true);
  UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = v;
  BEGIN
    PERFORM public.bootstrap_first_admin('banned@example.test');
    RAISE EXCEPTION 'banned user accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'No eligible Auth user%', SQLERRM; END;

  PERFORM t.mkuser('dup1', 'twin@example.test', true);
  PERFORM t.mkuser('dup2', 'TWIN@example.test ', true);
  BEGIN
    PERFORM public.bootstrap_first_admin('twin@example.test');
    RAISE EXCEPTION 'ambiguous email accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'More than one Auth user%', SQLERRM; END;

  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' OR is_active);
  PERFORM t.pass('bootstrap: unconfirmed, deleted, actively banned and ambiguous accounts refused; nothing changed');
END $$;

-- 6: a successful bootstrap, rolled back so later tests start admin-free.
DO $$
DECLARE v UUID; p public.profiles;
BEGIN
  BEGIN
    INSERT INTO auth.users (email, phone, email_confirmed_at, banned_until, raw_user_meta_data)
    VALUES ('Boss@Example.test', '+254700000001', now(), now() - interval '1 day',
            '{"full_name": "Boss Person"}')
    RETURNING id INTO v;
    ASSERT public.bootstrap_first_admin('  boss@EXAMPLE.test ') = v;
    SELECT * INTO STRICT p FROM public.profiles WHERE id = v;
    ASSERT p.role = 'admin' AND p.is_active;
    ASSERT p.full_name = 'Boss Person' AND p.phone = '+254700000001', 'other fields kept';
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin');
  PERFORM t.pass('bootstrap: case/space-insensitive email, expired ban eligible; only role and is_active change');
END $$;

-- 7: concurrency. Session A holds the bootstrap lock; peer B is refused by
-- lock_timeout, then blocks, then sees the admin A committed.
DO $$
DECLARE v_a UUID; v_b UUID; r TEXT;
BEGIN
  v_a := t.mkuser('first', 'first@example.test', true);
  v_b := t.mkuser('second', 'second@example.test', true);
  PERFORM t.peer_open('b');
  COMMIT;

  ASSERT public.bootstrap_first_admin('first@example.test') = v_a;   -- lock held

  r := t.peer_try('b', 'SELECT public.bootstrap_first_admin(''second@example.test'')::text', '200ms');
  ASSERT r LIKE 'ERROR:55P03:%', 'expected lock timeout, got ' || r;

  PERFORM t.peer_send('b', 'SELECT public.bootstrap_first_admin(''second@example.test'')::text');
  PERFORM t.peer_wait_blocked('b');
  COMMIT;
  r := t.peer_result('b');
  ASSERT r LIKE 'ERROR:P0001:An administrator profile already exists%', 'peer got ' || r;

  ASSERT (SELECT count(*) FROM public.profiles WHERE role = 'admin') = 1;
  ASSERT (SELECT role = 'admin' AND is_active FROM public.profiles WHERE id = v_a);
  ASSERT (SELECT role = 'collector' AND NOT is_active FROM public.profiles WHERE id = v_b);
  PERFORM t.peer_close('b');
  PERFORM t.pass('bootstrap concurrency: second session times out on the lock, then waits and is refused; one admin');
END $$;

-- 8
DO $$ BEGIN
  BEGIN
    PERFORM public.bootstrap_first_admin('second@example.test');
    RAISE EXCEPTION 'second admin created';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'An administrator profile already exists%', SQLERRM; END;
  BEGIN
    UPDATE public.profiles SET is_active = false WHERE role = 'admin';
    PERFORM public.bootstrap_first_admin('second@example.test');
    RAISE EXCEPTION 'bootstrap ran with only an inactive admin';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'An administrator profile already exists%', SQLERRM; END;
  ASSERT (SELECT count(*) FROM public.profiles WHERE role = 'admin' AND is_active) = 1;
  PERFORM t.pass('bootstrap refuses once any admin exists, active or inactive');
END $$;

-- 9
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    ASSERT NOT has_function_privilege(r, 'public.bootstrap_first_admin(text)', 'EXECUTE'), r;
    BEGIN
      PERFORM t.become(r, t.id('first'));
      PERFORM public.bootstrap_first_admin('second@example.test');
      RAISE EXCEPTION '% could run bootstrap', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = 'public.bootstrap_first_admin(text)'::regprocedure AND a.grantee = 0),
    'PUBLIC can execute bootstrap';
  PERFORM t.pass('bootstrap is owner-only: anon, authenticated, service_role and PUBLIC cannot execute');
END $$;
