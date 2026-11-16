-- REAL SITES, SEED and FIRST-ADMIN BOOTSTRAP (005_sites.sql, seed.sql,
-- migration 004). The template also holds the test-only 'FIXTURE Site n'
-- rows from lib/90_test_helpers.sql; the site checks exclude them.
-- Order matters: the site, seed and eligibility tests run while no admin
-- exists; the concurrency test creates the first admin.
SET client_min_messages = notice;

-- ============================================================ sites and seed
CREATE VIEW t.real_sites AS
  SELECT * FROM public.sites WHERE name NOT LIKE 'FIXTURE %';

-- 1
DO $$ BEGIN
  ASSERT (SELECT array_agg(name ORDER BY name) FROM t.real_sites)
       = ARRAY['Babadogo', 'Kariadudu', 'Kariobangi', 'Kiyambea', 'Komb Green',
               'Mathare', 'Ng''omong''o', 'Njiru'],
       'site names: ' || (SELECT string_agg(name, ', ' ORDER BY name) FROM t.real_sites);
  ASSERT NOT EXISTS (SELECT 1 FROM t.real_sites WHERE NOT active), 'inactive real site';
  ASSERT NOT EXISTS (SELECT 1 FROM t.real_sites WHERE location IS NOT NULL), 'invented coordinates';
  ASSERT NOT EXISTS (SELECT 1 FROM public.sites WHERE name ILIKE 'TEST%'), 'a TEST site exists';
  ASSERT (SELECT count(*) FROM public.sites WHERE name LIKE 'FIXTURE Site %') = 9, 'fixture sites';
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_sites), 'sites assigned to users';
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles), 'profiles exist';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.users), 'auth users exist';
  PERFORM t.pass('005: exactly the 8 real sites, active, location NULL; no TEST sites; no users, profiles or assignments');
END $$;

-- 2: seed.sql adds nothing (TEST sites removed); re-running 005 and the
-- seed inserts and changes nothing, even after an admin edit to a site.
CREATE TABLE t.sites_before AS SELECT id, name, location, active, created_at FROM public.sites;
\i :seed_file
DO $$ BEGIN
  ASSERT NOT EXISTS (
    (SELECT id, name, location, active, created_at FROM public.sites)
    EXCEPT (SELECT id, name, location, active, created_at FROM t.sites_before))
    AND (SELECT count(*) FROM public.sites) = (SELECT count(*) FROM t.sites_before),
    'seed.sql changed sites';
  UPDATE public.sites SET active = false WHERE name = 'Njiru';
  UPDATE t.sites_before SET active = false WHERE name = 'Njiru';
END $$;
\i :sites_file
\i :sites_file

-- 3
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.sites) = (SELECT count(*) FROM t.sites_before), 're-run added rows';
  ASSERT NOT EXISTS (
    (SELECT id, name, location, active, created_at FROM public.sites)
    EXCEPT (SELECT id, name, location, active, created_at FROM t.sites_before)), 're-run changed rows';
  ASSERT (SELECT NOT active FROM public.sites WHERE name = 'Njiru'), 're-run reactivated a site';
  UPDATE public.sites SET active = true WHERE name = 'Njiru';
  PERFORM t.pass('seed.sql adds no sites; 005 is idempotent: re-running inserts nothing and keeps admin changes');
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

-- ---- round 3 additions that need an admin-free database. Each success is
-- rolled back (SQLSTATE T0001) so the next test still has no admin.

-- 6a: never banned; created_at preserved; every other profile untouched.
DO $$
DECLARE v UUID; p_before public.profiles; p public.profiles; v_others JSONB;
BEGIN
  BEGIN
    INSERT INTO auth.users (email, phone, email_confirmed_at, raw_user_meta_data)
    VALUES ('Never.Banned@Example.TEST', '+254700000002', now(), '{"full_name": "Never Banned"}')
    RETURNING id INTO v;
    UPDATE public.profiles SET created_at = '2024-01-02 03:04:05+00' WHERE id = v;
    SELECT * INTO STRICT p_before FROM public.profiles WHERE id = v;
    SELECT jsonb_agg(to_jsonb(x) ORDER BY id) INTO v_others FROM public.profiles x WHERE id <> v;
    ASSERT (SELECT banned_until IS NULL FROM auth.users WHERE id = v);

    ASSERT public.bootstrap_first_admin('   never.banned@EXAMPLE.test  ') = v;

    SELECT * INTO STRICT p FROM public.profiles WHERE id = v;
    ASSERT p.role = 'admin' AND p.is_active;
    ASSERT p.full_name = 'Never Banned' AND p.phone = '+254700000002', 'name/phone';
    ASSERT p.created_at = p_before.created_at, 'created_at changed';
    ASSERT (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.profiles x WHERE id <> v) = v_others,
      'other profiles changed';
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin');
  PERFORM t.pass('bootstrap: never-banned user promoted via padded mixed-case email; name, phone, created_at and other profiles untouched');
END $$;

-- 6b: banned_until = now() counts as no longer banned.
DO $$
DECLARE v UUID;
BEGIN
  BEGIN
    v := t.mkuser('ban_now', 'ban-now@example.test', true);
    UPDATE auth.users SET banned_until = now() WHERE id = v;
    ASSERT public.bootstrap_first_admin('ban-now@example.test') = v;
    ASSERT (SELECT role = 'admin' AND is_active FROM public.profiles WHERE id = v);
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin');
  PERFORM t.pass('bootstrap: banned_until = now() is promoted (ban has ended)');
END $$;

-- 6c: a deleted or banned account sharing the email does not block the active one.
DO $$
DECLARE v_gone UUID; v_live UUID; k TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY['deleted', 'banned'] LOOP
    BEGIN
      v_gone := t.mkuser('shared_' || k || '_gone', 'shared-' || k || '@example.test', true);
      IF k = 'deleted' THEN
        UPDATE auth.users SET deleted_at = now() WHERE id = v_gone;
      ELSE
        UPDATE auth.users SET banned_until = now() + interval '30 days' WHERE id = v_gone;
      END IF;
      v_live := t.mkuser('shared_' || k || '_live', 'SHARED-' || k || '@example.test ', true);
      ASSERT public.bootstrap_first_admin('shared-' || k || '@example.test') = v_live,
        k || ': wrong account promoted';
      ASSERT (SELECT role = 'admin' AND is_active FROM public.profiles WHERE id = v_live);
      ASSERT (SELECT role = 'collector' AND NOT is_active FROM public.profiles WHERE id = v_gone),
        k || ': the ineligible account was changed';
      RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
    EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
    END;
  END LOOP;
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin');
  PERFORM t.pass('bootstrap: a deleted or banned account with the same email is ignored; the eligible one is promoted');
END $$;

-- 6d: an unconfirmed user's profile is left exactly as it was.
DO $$
DECLARE v_before JSONB;
BEGIN
  SELECT to_jsonb(p) INTO v_before FROM public.profiles p WHERE id = t.id('unconf');
  BEGIN
    PERFORM public.bootstrap_first_admin('UNCONFIRMED@example.test');
    RAISE EXCEPTION 'unconfirmed accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE '%has not confirmed their email', SQLERRM; END;
  ASSERT (SELECT to_jsonb(p) FROM public.profiles p WHERE id = t.id('unconf')) = v_before,
    'unconfirmed profile changed';
  PERFORM t.pass('bootstrap: unconfirmed user refused and their profile is unchanged');
END $$;

-- 6e: a confirmed Auth user with no profile row.
DO $$
DECLARE v UUID;
BEGIN
  BEGIN
    v := t.mkuser('noprofile', 'no-profile@example.test', true);
    DELETE FROM public.profiles WHERE id = v;
    BEGIN
      PERFORM public.bootstrap_first_admin('no-profile@example.test');
      RAISE EXCEPTION 'missing profile accepted';
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM LIKE 'No profile exists for the Auth user%', SQLERRM;
    END;
    ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v), 'profile was created';
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin');
  PERFORM t.pass('bootstrap: a confirmed Auth user without a profile is refused; no profile is created');
END $$;

-- 6f: an existing active admin also blocks (the concurrency test below
-- creates one for real; this checks it before any admin exists).
DO $$
DECLARE v UUID;
BEGIN
  BEGIN
    v := t.mkuser('pre_admin', 'pre-admin@example.test', true);
    UPDATE public.profiles SET role = 'admin', is_active = true WHERE id = v;
    PERFORM t.mkuser('pre_cand', 'pre-candidate@example.test', true);
    BEGIN
      PERFORM public.bootstrap_first_admin('pre-candidate@example.test');
      RAISE EXCEPTION 'bootstrap ran with an active admin present';
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM LIKE 'An administrator profile already exists%', SQLERRM;
    END;
    ASSERT (SELECT count(*) FROM public.profiles WHERE role = 'admin') = 1;
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin');
  PERFORM t.pass('bootstrap: refused when an active admin already exists');
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

-- ============================================================ round 3 additions (admin exists)
-- 10
DO $$
DECLARE v_before JSONB;
BEGIN
  SELECT to_jsonb(p) INTO v_before FROM public.profiles p WHERE id = t.id('first');
  BEGIN
    PERFORM public.bootstrap_first_admin('first@example.test');
    RAISE EXCEPTION 're-run for the same user succeeded';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'An administrator profile already exists%', SQLERRM;
  END;
  ASSERT (SELECT to_jsonb(p) FROM public.profiles p WHERE id = t.id('first')) = v_before;
  PERFORM t.pass('bootstrap: re-running for the existing admin is refused and changes nothing');
END $$;

-- 11
DO $$
DECLARE f REGPROCEDURE := 'public.bootstrap_first_admin(text)'::regprocedure;
BEGIN
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = f), 'not SECURITY DEFINER';
  ASSERT (SELECT proconfig FROM pg_proc WHERE oid = f) = ARRAY['search_path=""'],
    'search_path is not ''''';
  ASSERT (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = f) = 'postgres', 'owner';
  ASSERT has_function_privilege('postgres', f, 'EXECUTE');
  PERFORM t.pass('catalog: bootstrap is SECURITY DEFINER, search_path = '''', owned by postgres');
END $$;
