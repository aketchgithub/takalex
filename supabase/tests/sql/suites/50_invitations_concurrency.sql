-- INVITATION CONCURRENCY. Deterministic: this session takes a real row lock
-- inside an open transaction, and a dblink peer session either
--   * is refused by lock_timeout (proves the lock is held), or
--   * is observed blocked by this session (pg_blocking_pids) before we
--     COMMIT/ROLLBACK, after which its outcome is checked.
-- No sleep-based timing decides any result.
--
-- Each test is one DO block that COMMITs part-way (allowed for a top-level
-- DO), so setup is visible to the peer before the lock is taken.
-- The peer "svc" acts as service_role; "adm" as authenticated with the
-- admin's JWT subject. This session is the owner.
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');
END $$;

DO $$ BEGIN
  PERFORM t.peer_open('svc', 'service_role');
  PERFORM t.peer_open('adm', 'authenticated', t.id('admin'));
END $$;

-- 1: two registrations for the same user; the first commits.
DO $$
DECLARE v_x UUID; r TEXT; v_sql TEXT;
BEGIN
  v_x := t.mkuser('k1', 'k1@example.test');
  COMMIT;
  v_sql := format(
    'SELECT public.register_invitation(%L, ''k1@example.test'', ''K One B'', ''collector'', ARRAY[%L]::uuid[], %L, %L)::text',
    v_x, t.site(2), t.id('admin'), t.h('k1-b'));

  PERFORM public.register_invitation(v_x, 'k1@example.test', 'K One', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k1-a'));

  r := t.peer_try('svc', v_sql, '200ms');
  ASSERT r LIKE 'ERROR:55P03:%', 'expected lock timeout, got ' || r;

  PERFORM t.peer_send('svc', v_sql);
  PERFORM t.peer_wait_blocked('svc');
  COMMIT;
  r := t.peer_result('svc');
  ASSERT r LIKE 'ERROR:23505:%', 'second registration got ' || r;

  ASSERT t.inv_count(v_x) = 1 AND t.pending_count(v_x) = 1;
  ASSERT t.inv_by_hash(t.h('k1-a')) IS NOT NULL AND t.inv_by_hash(t.h('k1-b')) IS NULL;
  ASSERT t.sites_of(v_x) = ARRAY[t.site(1)], 'sites from the loser leaked';
  ASSERT (t.profile(v_x)).full_name = 'K One', 'profile from the loser leaked';
  PERFORM t.pass('concurrent register: peer times out on the lock, then waits and fails cleanly; one invitation');
END $$;

-- 2: two registrations; the first rolls back, so the waiting one succeeds.
DO $$
DECLARE v_x UUID; r TEXT;
BEGIN
  v_x := t.mkuser('k2', 'k2@example.test');
  COMMIT;
  PERFORM public.register_invitation(v_x, 'k2@example.test', 'K Two', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k2-a'));
  PERFORM t.peer_send('svc', format(
    'SELECT public.register_invitation(%L, ''k2@example.test'', ''K Two B'', ''site_manager'', ARRAY[%L]::uuid[], %L, %L)::text',
    v_x, t.site(2), t.id('admin'), t.h('k2-b')));
  PERFORM t.peer_wait_blocked('svc');
  ROLLBACK;
  r := t.peer_result('svc');
  ASSERT r LIKE 'OK:%', 'peer should succeed after rollback, got ' || r;
  ASSERT t.inv_by_hash(t.h('k2-b')) = substr(r, 4)::uuid;
  ASSERT t.inv_by_hash(t.h('k2-a')) IS NULL;
  ASSERT t.sites_of(v_x) = ARRAY[t.site(2)];
  ASSERT (SELECT p.full_name = 'K Two B' AND p.role = 'site_manager' FROM t.profile(v_x) AS p);
  PERFORM t.pass('concurrent register: when the lock holder rolls back, the waiting registration succeeds');
END $$;

-- 3: two reissues of the same expired invitation.
DO $$
DECLARE v_x UUID; v_old UUID; v_new UUID; r TEXT; v_sql TEXT;
BEGIN
  v_x := t.mkuser('k3', 'k3@example.test');
  v_old := public.register_invitation(v_x, 'k3@example.test', 'K Three', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k3-0'));
  PERFORM t.expire(v_old);
  COMMIT;
  v_sql := format(
    'SELECT public.reissue_invitation(%L, %L, %L, ''K Three B'', ''recycler'', ARRAY[%L]::uuid[])::text',
    v_old, t.id('admin'), t.h('k3-b'), t.site(4));

  v_new := public.reissue_invitation(v_old, t.id('admin'), t.h('k3-a'),
    'K Three A', 'collector', ARRAY[t.site(3)]);

  r := t.peer_try('svc', v_sql, '200ms');
  ASSERT r LIKE 'ERROR:55P03:%', 'expected lock timeout, got ' || r;

  PERFORM t.peer_send('svc', v_sql);
  PERFORM t.peer_wait_blocked('svc');
  COMMIT;
  r := t.peer_result('svc');
  ASSERT r LIKE 'ERROR:P0001:Only expired or revoked%', 'second reissue got ' || r;

  ASSERT t.pending_count(v_x) = 1 AND t.inv_count(v_x) = 2;
  ASSERT (t.inv(v_old)).status = 'superseded' AND (t.inv(v_old)).superseded_by = v_new;
  ASSERT t.inv_by_hash(t.h('k3-b')) IS NULL;
  ASSERT t.sites_of(v_x) = ARRAY[t.site(3)];
  ASSERT (SELECT p.full_name = 'K Three A' AND p.role = 'collector' FROM t.profile(v_x) AS p);
  PERFORM t.pass('concurrent reissue: exactly one wins; the waiter re-reads the row and is refused');
END $$;

-- 4: concurrent wrong-code guesses are all counted.
DO $$
DECLARE v_x UUID; v_inv UUID; v_before INTEGER; r TEXT;
BEGIN
  v_x := t.mkuser('k4', 'k4@example.test');
  v_inv := public.register_invitation(v_x, 'k4@example.test', 'K Four', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k4'));
  COMMIT;
  v_before := t.attempts(v_inv);
  ASSERT NOT (t.v('k4@example.test', 'wrong-1')->>'is_valid')::bool;
  PERFORM t.peer_send('svc', format(
    'SELECT (SELECT to_jsonb(r) FROM public.verify_invitation_code(''k4@example.test'', %L) AS r)::text',
    t.h('wrong-2')));
  PERFORM t.peer_wait_blocked('svc');
  COMMIT;
  r := t.peer_result('svc');
  ASSERT r = 'OK:{"is_valid": false, "auth_user_id": null, "invitation_id": null}', 'peer got ' || r;
  ASSERT t.attempts(v_inv) = v_before + 2, 'attempts ' || t.attempts(v_inv);
  PERFORM t.pass('concurrent wrong codes: the second guess waits for the first and both are counted');
END $$;

-- 5: concurrent consume activates once.
DO $$
DECLARE v_x UUID; v_inv UUID; r TEXT; v_accepted TIMESTAMPTZ;
BEGIN
  v_x := t.mkuser('k5', 'k5@example.test');
  v_inv := public.register_invitation(v_x, 'k5@example.test', 'K Five', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k5'));
  PERFORM t.confirm(v_x);
  COMMIT;
  ASSERT public.consume_invitation(v_inv) = v_inv;
  PERFORM t.peer_send('svc', format('SELECT public.consume_invitation(%L)::text', v_inv));
  PERFORM t.peer_wait_blocked('svc');
  COMMIT;
  r := t.peer_result('svc');
  ASSERT r = 'ERROR:P0001:Invitation is not valid', 'second consume got ' || r;
  ASSERT t.status(v_inv) = 'accepted' AND (t.profile(v_x)).is_active;
  v_accepted := (t.inv(v_inv)).accepted_at;
  ASSERT v_accepted IS NOT NULL;
  PERFORM t.pass('concurrent consume: exactly one activation; the waiter is refused');
END $$;

-- 6: consume holds the row; a concurrent admin revoke must not hit the
-- accepted invitation.
DO $$
DECLARE v_x UUID; v_inv UUID; r TEXT;
BEGIN
  v_x := t.mkuser('k6', 'k6@example.test');
  v_inv := public.register_invitation(v_x, 'k6@example.test', 'K Six', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k6'));
  PERFORM t.confirm(v_x);
  COMMIT;
  ASSERT public.consume_invitation(v_inv) = v_inv;
  PERFORM t.peer_send('adm', format('SELECT public.revoke_invitation(%L)::text', v_inv));
  PERFORM t.peer_wait_blocked('adm');
  COMMIT;
  r := t.peer_result('adm');
  ASSERT r = 'ERROR:P0001:Only pending invitations can be revoked', 'revoke got ' || r;
  ASSERT t.status(v_inv) = 'accepted';
  ASSERT (t.inv(v_inv)).revoked_at IS NULL AND (t.inv(v_inv)).revoked_by IS NULL;
  PERFORM t.pass('consume vs revoke: the waiting revoke is refused and leaves no revocation audit');
END $$;

-- 7: revoke holds the row; a concurrent consume must fail.
DO $$
DECLARE v_x UUID; v_inv UUID; r TEXT;
BEGIN
  v_x := t.mkuser('k7', 'k7@example.test');
  v_inv := public.register_invitation(v_x, 'k7@example.test', 'K Seven', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k7'));
  PERFORM t.confirm(v_x);
  COMMIT;
  ASSERT t.revoke_as(v_inv, t.id('admin')) = v_inv;
  PERFORM t.peer_send('svc', format('SELECT public.consume_invitation(%L)::text', v_inv));
  PERFORM t.peer_wait_blocked('svc');
  COMMIT;
  r := t.peer_result('svc');
  ASSERT r = 'ERROR:P0001:Invitation is not valid', 'consume got ' || r;
  ASSERT t.status(v_inv) = 'revoked' AND (t.inv(v_inv)).revoked_by = t.id('admin');
  ASSERT NOT (t.profile(v_x)).is_active;
  PERFORM t.pass('revoke vs consume: the waiting consume is refused; profile stays inactive');
END $$;

-- 8: a peer reissue waits on a revoke-in-progress, then succeeds on the
-- now-revoked row.
DO $$
DECLARE v_x UUID; v_inv UUID; r TEXT;
BEGIN
  v_x := t.mkuser('k8', 'k8@example.test');
  v_inv := public.register_invitation(v_x, 'k8@example.test', 'K Eight', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('k8-0'));
  COMMIT;
  ASSERT t.revoke_as(v_inv, t.id('admin')) = v_inv;
  PERFORM t.peer_send('svc', format(
    'SELECT public.reissue_invitation(%L, %L, %L, ''K Eight'', ''collector'', ARRAY[%L]::uuid[])::text',
    v_inv, t.id('admin'), t.h('k8-1'), t.site(5)));
  PERFORM t.peer_wait_blocked('svc');
  COMMIT;
  r := t.peer_result('svc');
  ASSERT r LIKE 'OK:%', 'reissue after revoke got ' || r;
  ASSERT t.inv_by_hash(t.h('k8-1')) = substr(r, 4)::uuid;
  ASSERT (t.inv(v_inv)).status = 'superseded' AND (t.inv(v_inv)).revoked_by = t.id('admin');
  ASSERT t.pending_count(v_x) = 1;
  PERFORM t.pass('revoke then concurrent reissue: the reissue waits, then sees the revoked row and succeeds');
END $$;

DO $$ BEGIN
  PERFORM t.peer_close('svc');
  PERFORM t.peer_close('adm');
END $$;
