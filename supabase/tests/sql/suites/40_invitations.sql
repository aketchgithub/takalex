-- INVITATIONS: register, verify, failed attempts, lockout, expiry, consume
-- (with Auth account checks), reissue, revoke (with audit), constraints and
-- permissions (migration 003). Concurrency is in 50_invitations_concurrency.
SET client_min_messages = notice;

-- ---------------------------------------------------------------- fixtures
DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');
  PERFORM t.mkuser('admin2', 'admin2@example.test', true);        -- inactive admin
  PERFORM t.set_profile(t.id('admin2'), 'admin', false);
  PERFORM t.mkuser('collector_active', 'active@example.test', true);
  PERFORM t.set_profile(t.id('collector_active'), 'collector', true);
END $$;

-- Register, verify, consume and reissue run as the Edge Function would.
SET ROLE service_role;

-- ============================================================ register
-- 1
DO $$
DECLARE v_u UUID; v_inv UUID; r public.invitations;
BEGIN
  v_u := t.mkuser('a', 'Alice@Example.test');
  v_inv := public.register_invitation(
    v_u, '  alice@example.TEST ', 'Alice A', 'collector',
    ARRAY[t.site(1), t.site(2)], t.id('admin'), t.h('111111'));
  PERFORM t.put('inv_a', v_inv);
  r := t.inv(v_inv);
  ASSERT r.status = 'pending', 'status';
  ASSERT r.email = 'alice@example.test', 'email normalised';
  ASSERT r.code_hash = t.h('111111'), 'hash stored';
  ASSERT r.failed_attempts = 0, 'attempts 0';
  ASSERT r.expires_at BETWEEN now() + interval '7 days' - interval '1 minute'
                          AND now() + interval '7 days', '7-day expiry';
  ASSERT r.revoked_at IS NULL AND r.revoked_by IS NULL;
  ASSERT r.superseded_by IS NULL AND r.accepted_at IS NULL;
  ASSERT t.sites_of(v_u) = t.sorted(ARRAY[t.site(1), t.site(2)]), 'sites';
  ASSERT (SELECT NOT p.is_active AND p.role = 'collector' AND p.full_name = 'Alice A'
          FROM t.profile(v_u) AS p), 'profile';
  PERFORM t.pass('register stores hash, sites, profile and a 7-day expiry');
END $$;

-- 2
DO $$
DECLARE v_u UUID;
BEGIN
  v_u := t.mkuser('bad', 'bad@example.test');
  BEGIN
    PERFORM public.register_invitation(v_u, 'bad@example.test', 'B', 'collector',
      ARRAY[t.site(1)], t.id('admin'), '123456');
    RAISE EXCEPTION 'plain code accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.register_invitation(v_u, 'bad@example.test', 'B', 'collector',
      ARRAY[t.site(1)], t.id('admin'), upper(t.h('x')));
    RAISE EXCEPTION 'uppercase hash accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.register_invitation(v_u, 'bad@example.test', 'B', 'collector',
      ARRAY[t.site(1)], t.id('admin'), NULL);
    RAISE EXCEPTION 'null hash accepted';
  EXCEPTION WHEN not_null_violation THEN NULL; END;
  BEGIN
    PERFORM public.register_invitation(v_u, 'bad@example.test', 'B', 'collector',
      ARRAY[t.site(1)], t.id('admin2'), t.h('x'));
    RAISE EXCEPTION 'inactive admin accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'Inviting administrator%', SQLERRM;
  END;
  BEGIN
    PERFORM public.register_invitation(v_u, 'other@example.test', 'B', 'collector',
      ARRAY[t.site(1)], t.id('admin'), t.h('x'));
    RAISE EXCEPTION 'email mismatch accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'Auth account email does not match invitation email', SQLERRM;
  END;
  BEGIN
    PERFORM t.confirm(v_u);
    PERFORM public.register_invitation(v_u, 'bad@example.test', 'B', 'collector',
      ARRAY[t.site(1)], t.id('admin'), t.h('x'));
    RAISE EXCEPTION 'confirmed account accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'Cannot invite an already confirmed account', SQLERRM;
  END;
  ASSERT t.inv_count(v_u) = 0;
  ASSERT t.sites_of(v_u) = '{}';
  PERFORM t.pass('register rejects bad/NULL hash, inactive admin, email mismatch and confirmed accounts; no partial writes');
END $$;

-- 3
DO $$
DECLARE v_u UUID;
BEGIN
  v_u := t.mkuser('dup', 'dup@example.test');
  BEGIN
    PERFORM public.register_invitation(v_u, 'dup@example.test', 'D', 'collector',
      ARRAY[t.site(1)], t.id('admin'), t.h('111111'));
    RAISE EXCEPTION 'duplicate code_hash accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM t.pass('code_hash is unique');
END $$;

-- ============================================================ verify
-- 4
DO $$
DECLARE j JSONB;
BEGIN
  j := t.v('ALICE@example.test ', '111111');
  ASSERT (j->>'is_valid')::bool, 'valid';
  ASSERT (j->>'invitation_id')::uuid = t.id('inv_a'), 'inv id';
  ASSERT (j->>'auth_user_id')::uuid = t.id('a'), 'user id';
  ASSERT t.status(t.id('inv_a')) = 'pending', 'verify does not change status';
  ASSERT t.attempts(t.id('inv_a')) = 0, 'no increment on success';
  PERFORM t.pass('correct code verifies (email case/space-insensitive) with no side effects');
END $$;

SELECT t.v('alice@example.test', '999999') IS NOT NULL AS wrong_code_called;
-- 5
DO $$ BEGIN
  ASSERT t.attempts(t.id('inv_a')) = 1, 'increment persisted: ' || t.attempts(t.id('inv_a'));
  PERFORM t.pass('wrong code increments failed_attempts and it persists after its own statement commits');
END $$;

BEGIN;
SELECT t.v('alice@example.test', '999998') IS NOT NULL AS wrong_code_called;
COMMIT;
-- 6
DO $$ BEGIN
  ASSERT t.attempts(t.id('inv_a')) = 2;
  PERFORM t.pass('increment persists through an explicit committed transaction (verify never raises)');
END $$;

-- 7
DO $$ BEGIN
  PERFORM t.v('nobody@example.test', '111111');
  ASSERT t.attempts(t.id('inv_a')) = 2;
  PERFORM t.pass('unknown email increments nothing');
END $$;

-- ============================================================ lockout
SELECT t.v('alice@example.test', '000001') IS NOT NULL AS wrong_code_called;
SELECT t.v('alice@example.test', '000002') IS NOT NULL AS wrong_code_called;
-- 8
DO $$ BEGIN
  ASSERT t.attempts(t.id('inv_a')) = 4;
  ASSERT (t.v('alice@example.test', '111111')->>'is_valid')::bool, 'still valid at 4';
  PERFORM t.pass('correct code still works at 4 failed attempts');
END $$;
SELECT t.v('alice@example.test', '000003') IS NOT NULL AS wrong_code_called;
-- 9
DO $$ BEGIN
  ASSERT t.attempts(t.id('inv_a')) = 5;
  ASSERT NOT (t.v('alice@example.test', '111111')->>'is_valid')::bool, 'locked must fail';
  PERFORM t.confirm(t.id('a'));
  BEGIN
    PERFORM t.consume(t.id('inv_a'));
    RAISE EXCEPTION 'consumed a locked invitation';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'Invitation is not valid', SQLERRM;
  END;
  ASSERT t.status(t.id('inv_a')) = 'pending';
  ASSERT NOT (t.profile(t.id('a'))).is_active;
  PERFORM t.pass('5-attempt lockout: correct code and consume both refused');
END $$;

-- ============================================================ expiry
DO $$ BEGIN
  PERFORM t.mkuser('e', 'erin@example.test');
  PERFORM t.put('inv_e', public.register_invitation(t.id('e'), 'erin@example.test', 'Erin',
    'recycler', ARRAY[t.site(3)], t.id('admin'), t.h('222222')));
  PERFORM t.confirm(t.id('e'));
END $$;

BEGIN;
SELECT t.as_owner(format('UPDATE public.invitations SET expires_at = now() WHERE id = %L', t.id('inv_e')));
-- 10
DO $$ BEGIN
  ASSERT NOT (t.v('erin@example.test', '222222')->>'is_valid')::bool, 'expires_at = now() must be expired';
  BEGIN
    PERFORM t.consume(t.id('inv_e'));
    RAISE EXCEPTION 'consumed at expires_at = now()';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation is not valid', SQLERRM; END;
  PERFORM t.pass('expires_at = now() already counts as expired (verify and consume)');
END $$;
ROLLBACK;

SELECT t.expire(t.id('inv_e'));
-- 11
DO $$ BEGIN
  ASSERT NOT (t.v('erin@example.test', '222222')->>'is_valid')::bool;
  BEGIN
    PERFORM t.consume(t.id('inv_e'));
    RAISE EXCEPTION 'consumed expired';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation is not valid', SQLERRM; END;
  ASSERT t.status(t.id('inv_e')) = 'pending', 'status unchanged';
  ASSERT t.attempts(t.id('inv_e')) = 0, 'right code on expired invite is not a failed attempt';
  ASSERT NOT (t.profile(t.id('e'))).is_active;
  PERFORM t.pass('expired invite rejected; status stays pending (no job needed)');
END $$;

-- ============================================================ generic failures
-- 12
DO $$
DECLARE
  v_generic JSONB := '{"is_valid": false, "invitation_id": null, "auth_user_id": null}';
  v_u UUID; v_inv UUID; c JSONB;
BEGIN
  v_u := t.mkuser('r0', 'rita@example.test');
  v_inv := public.register_invitation(v_u, 'rita@example.test', 'Rita', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('333333'));
  PERFORM t.revoke_as(v_inv, t.id('admin'));
  FOREACH c IN ARRAY ARRAY[
    t.v('nobody@example.test', '111111'),   -- unknown email
    t.v('erin@example.test',   '999999'),   -- wrong code (on an expired invite)
    t.v('erin@example.test',   '222222'),   -- expired, right code
    t.v('alice@example.test',  '111111'),   -- locked, right code
    t.v('rita@example.test',   '333333'),   -- revoked, right code
    (SELECT to_jsonb(r) FROM public.verify_invitation_code(NULL, NULL) AS r),
    (SELECT to_jsonb(r) FROM public.verify_invitation_code('erin@example.test', NULL) AS r)
  ] LOOP
    ASSERT c = v_generic, 'non-generic failure: ' || c::text;
  END LOOP;
  ASSERT (SELECT count(*) FROM public.verify_invitation_code('nobody@x.test', t.h('1'))) = 1;
  ASSERT (SELECT count(*) FROM public.verify_invitation_code('erin@example.test', t.h('222222'))) = 1;
  PERFORM t.pass('unknown email / wrong code / expired / locked / revoked / NULL: identical single row');
END $$;

-- ============================================================ consume
-- 13
DO $$
DECLARE v_u UUID; v_inv UUID; j JSONB; r public.invitations;
BEGIN
  v_u := t.mkuser('c', 'Carol@Example.test');
  v_inv := public.register_invitation(v_u, 'carol@example.test', 'Carol', 'site_manager',
    ARRAY[t.site(4)], t.id('admin'), t.h('444444'));
  PERFORM t.put('inv_c', v_inv);
  PERFORM t.confirm(v_u);
  j := t.v('carol@example.test', '444444');
  ASSERT (j->>'is_valid')::bool;
  ASSERT t.consume((j->>'invitation_id')::uuid) = v_inv;
  r := t.inv(v_inv);
  ASSERT r.status = 'accepted' AND r.accepted_at IS NOT NULL;
  ASSERT (SELECT p.is_active AND p.role = 'site_manager' FROM t.profile(v_u) AS p);
  BEGIN
    PERFORM t.consume(v_inv);
    RAISE EXCEPTION 'consumed twice';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation is not valid', SQLERRM; END;
  ASSERT (t.inv(v_inv)).accepted_at = r.accepted_at;
  ASSERT NOT (t.v('carol@example.test', '444444')->>'is_valid')::bool, 'verify after accept';
  BEGIN
    PERFORM t.consume(gen_random_uuid());
    RAISE EXCEPTION 'consumed unknown id';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation is not valid', SQLERRM; END;
  PERFORM t.pass('consume (confirmed account, email differs only in case) activates exactly once');
END $$;

-- 14
DO $$
DECLARE v_u UUID; v_inv UUID;
BEGIN
  v_u := t.mkuser('ns', 'nosites@example.test');
  v_inv := public.register_invitation(v_u, 'nosites@example.test', 'N', 'collector',
    ARRAY[t.site(5)], t.id('admin'), t.h('555555'));
  PERFORM t.confirm(v_u);
  PERFORM t.as_owner(format('DELETE FROM public.user_sites WHERE user_id = %L', v_u));
  BEGIN
    PERFORM t.consume(v_inv);
    RAISE EXCEPTION 'consumed without sites';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'No site assignment%', SQLERRM; END;
  ASSERT t.status(v_inv) = 'pending' AND NOT (t.profile(v_u)).is_active;

  PERFORM t.assign(v_u, t.site(5));
  PERFORM t.set_profile(v_u, 'recycler', false);
  BEGIN
    PERFORM t.consume(v_inv);
    RAISE EXCEPTION 'consumed with role mismatch';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'The invited profile%', SQLERRM; END;
  PERFORM t.set_profile(v_u, 'collector', true);
  BEGIN
    PERFORM t.consume(v_inv);
    RAISE EXCEPTION 'consumed with active profile';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'The invited profile%', SQLERRM; END;
  ASSERT t.status(v_inv) = 'pending';
  PERFORM t.pass('consume requires user_sites and a matching inactive non-admin profile; failures change nothing');
END $$;

-- 15: Auth account checks inside consume_invitation.
DO $$
DECLARE v_u UUID; v_inv UUID; k TEXT;
  -- case key, setup SQL (%1$L = user id), expected message
  v_cases TEXT[][] := ARRAY[
    ['unconfirmed', 'UPDATE auth.users SET email_confirmed_at = NULL WHERE id = %1$L',
     'Invited Auth account email is not confirmed'],
    ['deleted', 'UPDATE auth.users SET deleted_at = now() WHERE id = %1$L',
     'Invited Auth account has been deleted'],
    ['banned', 'UPDATE auth.users SET banned_until = now() + interval ''1 day'' WHERE id = %1$L',
     'Invited Auth account is banned'],
    ['mismatch', 'UPDATE auth.users SET email = ''changed@example.test'' WHERE id = %1$L',
     'Auth account email does not match invitation email']];
  i INTEGER;
BEGIN
  FOR i IN 1 .. array_length(v_cases, 1) LOOP
    k := v_cases[i][1];
    v_u := t.mkuser('auth_' || k, k || '@example.test');
    v_inv := public.register_invitation(v_u, k || '@example.test', 'Auth ' || k, 'collector',
      ARRAY[t.site(6)], t.id('admin'), t.h('auth-' || k));
    PERFORM t.confirm(v_u);
    ASSERT (t.v(k || '@example.test', 'auth-' || k)->>'is_valid')::bool, k || ' verifies';
    PERFORM t.as_owner(format(v_cases[i][2], v_u));
    BEGIN
      PERFORM t.consume(v_inv);
      RAISE EXCEPTION 'consumed with % account', k;
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = v_cases[i][3], k || ': ' || SQLERRM;
    END;
    ASSERT t.status(v_inv) = 'pending', k || ' status changed';
    ASSERT (t.inv(v_inv)).accepted_at IS NULL;
    ASSERT NOT (t.profile(v_u)).is_active, k || ' profile activated';
    PERFORM t.put('inv_auth_' || k, v_inv);
  END LOOP;
  PERFORM t.pass('consume refuses unconfirmed, deleted, actively banned and email-mismatched Auth accounts');
END $$;

-- 16
DO $$
DECLARE v_u UUID := t.id('auth_banned'); v_inv UUID := t.id('inv_auth_banned');
BEGIN
  PERFORM t.as_owner(format(
    'UPDATE auth.users SET banned_until = now() - interval ''1 second'' WHERE id = %L', v_u));
  ASSERT t.consume(v_inv) = v_inv;
  ASSERT t.status(v_inv) = 'accepted' AND (t.profile(v_u)).is_active;
  PERFORM t.pass('consume accepts an account whose ban has expired');
END $$;

-- ============================================================ reissue
-- 17 Erin: pending + expired -> reissue.
DO $$
DECLARE v_new UUID; r_old public.invitations; r_new public.invitations;
BEGIN
  v_new := public.reissue_invitation(t.id('inv_e'), t.id('admin'), t.h('666666'),
    '  Erin Renamed ', 'collector', ARRAY[t.site(6), t.site(7)]);
  PERFORM t.put('inv_e2', v_new);
  r_old := t.inv(t.id('inv_e'));
  r_new := t.inv(v_new);
  ASSERT r_old.status = 'superseded' AND r_old.superseded_by = v_new, 'old superseded';
  ASSERT r_old.revoked_at IS NULL AND r_old.revoked_by IS NULL, 'expired->superseded has no revocation audit';
  ASSERT r_new.status = 'pending' AND r_new.failed_attempts = 0;
  ASSERT r_new.auth_user_id = t.id('e') AND r_new.email = 'erin@example.test';
  ASSERT r_new.role = 'collector' AND r_new.code_hash = t.h('666666');
  ASSERT r_new.invited_by = t.id('admin');
  ASSERT r_new.expires_at > now() + interval '7 days' - interval '1 minute';
  ASSERT t.sites_of(t.id('e')) = t.sorted(ARRAY[t.site(6), t.site(7)]), 'sites replaced';
  ASSERT (SELECT p.full_name = 'Erin Renamed' AND p.role = 'collector' AND NOT p.is_active
          FROM t.profile(t.id('e')) AS p), 'profile updated';
  ASSERT NOT (t.v('erin@example.test', '222222')->>'is_valid')::bool, 'old code fails';
  ASSERT (t.v('erin@example.test', '666666')->>'invitation_id')::uuid = v_new, 'new code works';
  BEGIN
    PERFORM t.consume(t.id('inv_e'));
    RAISE EXCEPTION 'consumed superseded';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation is not valid', SQLERRM; END;
  PERFORM t.pass('reissue of expired pending: old superseded, old code fails, new code works, sites/profile replaced');
END $$;

-- 18
DO $$ BEGIN
  BEGIN
    PERFORM public.reissue_invitation(t.id('inv_e'), t.id('admin'), t.h('777777'),
      'Erin', 'collector', ARRAY[t.site(1)]);
    RAISE EXCEPTION 'reissued superseded';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Only expired or revoked%', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(t.id('inv_e2'), t.id('admin'), t.h('777777'),
      'Erin', 'collector', ARRAY[t.site(1)]);
    RAISE EXCEPTION 'reissued unexpired pending';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Only expired or revoked%', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(t.id('inv_c'), t.id('admin'), t.h('777777'),
      'Carol', 'collector', ARRAY[t.site(1)]);
    RAISE EXCEPTION 'reissued accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Only expired or revoked%', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(gen_random_uuid(), t.id('admin'), t.h('777777'),
      'Nobody', 'collector', ARRAY[t.site(1)]);
    RAISE EXCEPTION 'reissued unknown id';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation not found', SQLERRM; END;
  PERFORM t.pass('reissue refused for superseded, unexpired pending, accepted and unknown invitations');
END $$;

-- 19 Alice: locked, so the admin revokes and reissues.
DO $$
DECLARE v_new UUID; r public.invitations;
BEGIN
  ASSERT t.revoke_as(t.id('inv_a'), t.id('admin')) = t.id('inv_a');
  r := t.inv(t.id('inv_a'));
  ASSERT r.status = 'revoked' AND r.revoked_at IS NOT NULL AND r.revoked_by = t.id('admin');
  v_new := public.reissue_invitation(t.id('inv_a'), t.id('admin'), t.h('888888'),
    'Alice A', 'recycler', ARRAY[t.site(9)]);
  r := t.inv(t.id('inv_a'));
  ASSERT r.status = 'superseded' AND r.superseded_by = v_new;
  ASSERT r.revoked_at IS NOT NULL AND r.revoked_by = t.id('admin'), 'revocation audit kept';
  ASSERT t.sites_of(t.id('a')) = ARRAY[t.site(9)], 'sites replaced';
  ASSERT NOT (t.v('alice@example.test', '111111')->>'is_valid')::bool, 'old code fails';
  ASSERT t.attempts(v_new) = 1, 'old-code guess counted on the new row';
  ASSERT (t.v('alice@example.test', '888888')->>'is_valid')::bool, 'new code works';
  ASSERT t.consume(v_new) = v_new;
  ASSERT (SELECT p.is_active AND p.role = 'recycler' FROM t.profile(t.id('a')) AS p);
  PERFORM t.pass('revoke then reissue clears the lockout; superseded row keeps revoked_at/revoked_by');
END $$;

-- 20
DO $$
DECLARE v_u UUID; v_inv UUID; v_before JSONB;
BEGIN
  v_u := t.mkuser('f', 'fay@example.test');
  v_inv := public.register_invitation(v_u, 'fay@example.test', 'Fay', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('101010'));
  PERFORM t.revoke_as(v_inv, t.id('admin'));
  v_before := to_jsonb(t.inv(v_inv));

  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('collector_active'), t.h('202020'),
      'Fay', 'collector', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'non-admin reissued';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Inviting administrator%', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin2'), t.h('202020'),
      'Fay', 'collector', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'inactive admin reissued';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Inviting administrator%', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('202020'),
      'Fay', 'admin', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'admin role reissued';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invalid invitation role', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('202020'),
      '  ', 'collector', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'blank name reissued';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'A full name is required', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('202020'),
      'Fay', 'collector', ARRAY[t.site(2), t.site(2)]);
    RAISE EXCEPTION 'dup sites';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Duplicate%', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('202020'),
      'Fay', 'collector', ARRAY[gen_random_uuid()]);
    RAISE EXCEPTION 'bad site';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'One or more%', SQLERRM; END;
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('202020'),
      'Fay', 'collector', '{}');
    RAISE EXCEPTION 'no sites';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'At least one%', SQLERRM; END;
  BEGIN  -- reused hash fails at INSERT, after the old row was already updated
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('666666'),
      'Fay', 'collector', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'reused hash';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), 'abc',
      'Fay', 'collector', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'bad hash';
  EXCEPTION WHEN check_violation THEN NULL; END;

  ASSERT to_jsonb(t.inv(v_inv)) = v_before, 'old row unchanged after failed reissues';
  ASSERT t.inv_count(v_u) = 1, 'no new row left behind';
  ASSERT t.sites_of(v_u) = ARRAY[t.site(1)], 'sites unchanged';

  -- active profile (but no accepted invitation): still refused
  PERFORM t.set_profile(v_u, 'collector', true);
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('202020'),
      'Fay', 'collector', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'active profile reissued';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'The invited user profile%', SQLERRM; END;
  ASSERT t.status(v_inv) = 'revoked';
  PERFORM t.set_profile(v_u, 'collector', false);
  PERFORM t.pass('reissue refuses bad inviter/role/name/sites/hash and an active profile; failures fully roll back');
END $$;

-- 21 Confirmed but inactive (a failed acceptance) CAN be reissued.
DO $$
DECLARE v_new UUID;
BEGIN
  -- 'auth_mismatch' is confirmed and inactive; restore its email first.
  PERFORM t.as_owner(format('UPDATE auth.users SET email = ''mismatch@example.test'' WHERE id = %L',
                            t.id('auth_mismatch')));
  PERFORM t.revoke_as(t.id('inv_auth_mismatch'), t.id('admin'));
  v_new := public.reissue_invitation(t.id('inv_auth_mismatch'), t.id('admin'), t.h('121212'),
    'Mismatch Fixed', 'collector', ARRAY[t.site(8)]);
  ASSERT t.status(v_new) = 'pending';
  ASSERT t.consume(v_new) = v_new;
  ASSERT (t.profile(t.id('auth_mismatch'))).is_active;
  PERFORM t.pass('a confirmed but inactive user (failed acceptance) can be revoked, reissued and accepted');
END $$;

-- 22
DO $$
DECLARE v_old UUID;
BEGIN
  -- Carol accepted. Simulate deactivation plus a stray revoked row so only
  -- the "already accepted" rule can stop the reissue.
  PERFORM t.set_profile(t.id('c'), 'site_manager', false);
  PERFORM t.as_owner(format(
    'INSERT INTO public.invitations (auth_user_id, email, invited_by, role, code_hash,
       expires_at, status, revoked_at, revoked_by)
     VALUES (%L, ''carol@example.test'', %L, ''site_manager'', %L,
       now() - interval ''1 day'', ''revoked'', now(), %L)',
    t.id('c'), t.id('admin'), t.h('carol-old'), t.id('admin')));
  v_old := t.inv_by_hash(t.h('carol-old'));
  BEGIN
    PERFORM public.reissue_invitation(v_old, t.id('admin'), t.h('303030'),
      'Carol', 'site_manager', ARRAY[t.site(4)]);
    RAISE EXCEPTION 'accepted user reissued';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'This user has already accepted an invitation', SQLERRM;
  END;
  ASSERT t.status(v_old) = 'revoked';
  PERFORM t.set_profile(t.id('c'), 'site_manager', true);
  PERFORM t.pass('a user with an accepted invitation can never be reissued');
END $$;

-- 23
DO $$
DECLARE v_u UUID; v_inv UUID;
BEGIN
  BEGIN
    PERFORM t.as_owner(format(
      'INSERT INTO public.invitations (auth_user_id, email, invited_by, role, code_hash, expires_at)
       VALUES (%L, ''other-erin@example.test'', %L, ''collector'', %L, now() + interval ''7 days'')',
      t.id('e'), t.id('admin'), t.h('dup-pending')));
    RAISE EXCEPTION 'second pending row allowed';
  EXCEPTION WHEN unique_violation THEN
    ASSERT SQLERRM LIKE '%invitations_one_pending_user_idx%', SQLERRM;
  END;
  -- register twice for the same unconfirmed user (different site, so the
  -- invitation index, not user_sites, is what refuses it)
  v_u := t.mkuser('j', 'jo@example.test');
  PERFORM public.register_invitation(v_u, 'jo@example.test', 'Jo', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('jo-1'));
  BEGIN
    PERFORM public.register_invitation(v_u, 'jo@example.test', 'Jo Again', 'collector',
      ARRAY[t.site(2)], t.id('admin'), t.h('jo-2'));
    RAISE EXCEPTION 'second register allowed';
  EXCEPTION WHEN unique_violation THEN
    ASSERT SQLERRM LIKE '%invitations_one_pending_%', SQLERRM;
  END;
  ASSERT t.inv_count(v_u) = 1 AND t.sites_of(v_u) = ARRAY[t.site(1)];
  ASSERT (t.profile(v_u)).full_name = 'Jo', 'second register left a partial write';

  v_u := t.mkuser('g', 'gus@example.test');
  v_inv := public.register_invitation(v_u, 'gus@example.test', 'Gus', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('404040'));
  PERFORM t.revoke_as(v_inv, t.id('admin'));
  PERFORM t.as_owner(format(
    'INSERT INTO public.invitations (auth_user_id, email, invited_by, role, code_hash, expires_at)
     VALUES (%L, ''gus@example.test'', %L, ''collector'', %L, now() + interval ''7 days'')',
    v_u, t.id('admin'), t.h('505050')));
  BEGIN
    PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('606060'),
      'Gus', 'collector', ARRAY[t.site(2)]);
    RAISE EXCEPTION 'reissue with another pending';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'This user already has another pending invitation', SQLERRM;
  END;
  ASSERT t.max_pending_per_user() = 1, 'a user has more than one pending invitation';
  PERFORM t.pass('never more than one pending invitation per user (index, register, reissue)');
END $$;

-- ============================================================ revoke + audit
-- 24
DO $$
DECLARE v_u UUID; v_inv UUID; r public.invitations;
BEGIN
  v_u := t.mkuser('h', 'hana@example.test');
  v_inv := public.register_invitation(v_u, 'hana@example.test', 'Hana', 'collector',
    ARRAY[t.site(2)], t.id('admin'), t.h('707070'));
  PERFORM t.put('inv_h', v_inv);
  ASSERT t.revoke_as(v_inv, t.id('admin')) = v_inv;
  r := t.inv(v_inv);
  ASSERT r.status = 'revoked';
  ASSERT r.revoked_by = t.id('admin'), 'revoked_by is the caller';
  ASSERT r.revoked_at = now(), 'revoked_at set in the same statement';
  ASSERT NOT (t.v('hana@example.test', '707070')->>'is_valid')::bool;
  PERFORM t.pass('revoke derives revoked_by from auth.uid() and sets revoked_at with it');
END $$;

-- 25
DO $$
DECLARE v_u UUID; v_inv UUID;
BEGIN
  v_u := t.mkuser('i', 'ivan@example.test');
  v_inv := public.register_invitation(v_u, 'ivan@example.test', 'Ivan', 'collector',
    ARRAY[t.site(2)], t.id('admin'), t.h('717171'));
  PERFORM t.put('inv_i', v_inv);
  BEGIN
    PERFORM t.revoke_as(v_inv, t.id('collector_active'));
    RAISE EXCEPTION 'non-admin revoked';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Revoking administrator%', SQLERRM; END;
  BEGIN
    PERFORM t.revoke_as(v_inv, t.id('admin2'));
    RAISE EXCEPTION 'inactive admin revoked';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Revoking administrator%', SQLERRM; END;
  BEGIN
    PERFORM t.revoke_as(v_inv, NULL);
    RAISE EXCEPTION 'no-JWT authenticated revoked';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Revoking administrator%', SQLERRM; END;
  BEGIN  -- service role key: no auth.uid(), so refused
    PERFORM public.revoke_invitation(v_inv);
    RAISE EXCEPTION 'service role revoked';
  EXCEPTION
    WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Revoking administrator%', SQLERRM;
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('anon', t.id('admin'));
    PERFORM public.revoke_invitation(v_inv);
    RAISE EXCEPTION 'anon revoked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT t.status(v_inv) = 'pending';
  ASSERT (t.inv(v_inv)).revoked_at IS NULL AND (t.inv(v_inv)).revoked_by IS NULL;
  PERFORM t.pass('revoke refused for non-admin, inactive admin, no JWT, service role and anon; row unchanged');
END $$;

-- 26
DO $$ BEGIN
  BEGIN
    PERFORM t.revoke_as(t.id('inv_c'), t.id('admin'));        -- accepted
    RAISE EXCEPTION 'revoked accepted';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Only pending%', SQLERRM; END;
  BEGIN
    PERFORM t.revoke_as(t.id('inv_e'), t.id('admin'));        -- superseded
    RAISE EXCEPTION 'revoked superseded';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Only pending%', SQLERRM; END;
  BEGIN
    PERFORM t.revoke_as(t.id('inv_h'), t.id('admin'));        -- already revoked
    RAISE EXCEPTION 'revoked twice';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Only pending%', SQLERRM; END;
  BEGIN
    PERFORM t.revoke_as(gen_random_uuid(), t.id('admin'));
    RAISE EXCEPTION 'revoked unknown';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'Only pending%', SQLERRM; END;
  ASSERT t.status(t.id('inv_c')) = 'accepted' AND (t.inv(t.id('inv_c'))).revoked_at IS NULL;
  -- an expired pending row can be revoked
  PERFORM t.expire(t.id('inv_i'));
  ASSERT t.revoke_as(t.id('inv_i'), t.id('admin')) = t.id('inv_i');
  PERFORM t.pass('revoke works on pending (incl. expired) only: not accepted, superseded, revoked or unknown');
END $$;

-- 27: revocation audit CHECK (tamper as owner).
DO $$
DECLARE s TEXT;
  v_stmts TEXT[] := ARRAY[
    -- revoked needs both
    format('UPDATE public.invitations SET revoked_by = NULL WHERE id = %L', t.id('inv_h')),
    format('UPDATE public.invitations SET revoked_at = NULL WHERE id = %L', t.id('inv_h')),
    -- pending may carry neither
    format('UPDATE public.invitations SET revoked_at = now() WHERE id = %L', t.id('inv_e2')),
    format('UPDATE public.invitations SET revoked_by = %L WHERE id = %L', t.id('admin'), t.id('inv_e2')),
    -- accepted may carry neither
    format('UPDATE public.invitations SET revoked_at = now(), revoked_by = %L WHERE id = %L',
           t.id('admin'), t.id('inv_c')),
    -- pending -> revoked without audit
    format('UPDATE public.invitations SET status = ''revoked'' WHERE id = %L', t.id('inv_e2')),
    -- superseded: both or neither
    format('UPDATE public.invitations SET revoked_by = NULL WHERE id = %L', t.id('inv_a')),
    format('UPDATE public.invitations SET revoked_at = now() WHERE id = %L', t.id('inv_e')),
    -- superseded_by only on superseded rows
    format('UPDATE public.invitations SET superseded_by = %L WHERE id = %L', t.id('inv_e2'), t.id('inv_h'))
  ];
BEGIN
  FOREACH s IN ARRAY v_stmts LOOP
    BEGIN
      PERFORM t.as_owner(s);
      RAISE EXCEPTION 'constraint allowed: %', s;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  -- revoked_by must reference a profile
  BEGIN
    PERFORM t.as_owner(format('UPDATE public.invitations SET revoked_by = %L WHERE id = %L',
                              gen_random_uuid(), t.id('inv_h')));
    RAISE EXCEPTION 'dangling revoked_by allowed';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  PERFORM t.pass('audit CHECK: revoked needs both; superseded both-or-neither; all other statuses neither');
END $$;

RESET ROLE;

-- ============================================================ permissions
-- 28
DO $$
DECLARE f TEXT; r TEXT;
  v_service_only TEXT[] := ARRAY[
    'public.register_invitation(uuid,text,text,public.user_role,uuid[],uuid,text)',
    'public.verify_invitation_code(text,text)',
    'public.claim_invitation(uuid)',
    'public.release_invitation_claim(uuid,uuid)',
    'public.consume_invitation(uuid,uuid)',
    'public.reissue_invitation(uuid,uuid,text,text,public.user_role,uuid[])'];
  v_revoke TEXT := 'public.revoke_invitation(uuid)';
BEGIN
  FOREACH f IN ARRAY v_service_only || v_revoke LOOP
    ASSERT (SELECT prosecdef AND proconfig = ARRAY['search_path=""']
            FROM pg_proc WHERE oid = f::regprocedure), 'definer/search_path ' || f;
    ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid = f::regprocedure AND a.grantee = 0), 'PUBLIC on ' || f;
    ASSERT NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon on ' || f;
  END LOOP;
  FOREACH f IN ARRAY v_service_only LOOP
    ASSERT has_function_privilege('service_role', f, 'EXECUTE'), 'service_role ' || f;
    ASSERT NOT has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated ' || f;
  END LOOP;
  ASSERT has_function_privilege('authenticated', v_revoke, 'EXECUTE'), 'authenticated revoke';
  ASSERT to_regprocedure('public.revoke_invitation(uuid,uuid)') IS NULL, 'old revoke overload exists';
  ASSERT to_regprocedure('public.accept_my_invitation()') IS NULL, 'accept_my_invitation exists';
  ASSERT to_regprocedure('public.register_invitation(uuid,text,text,public.user_role,uuid[],uuid)') IS NULL,
    'old register_invitation overload exists';
  ASSERT to_regprocedure('public.consume_invitation(uuid)') IS NULL,
    'unclaimed consume_invitation(uuid) overload exists';
  PERFORM t.pass('catalog: 6 functions service_role-only, revoke authenticated-only, none for anon/PUBLIC; old signatures gone');
END $$;

-- 29
DO $$
DECLARE r TEXT; c TEXT; v_before JSONB := to_jsonb(t.inv(t.id('inv_e2')));
  v_calls TEXT[] := ARRAY[
    format('SELECT public.register_invitation(%L, ''x@x.test'', ''X'', ''collector'', ARRAY[%L]::uuid[], %L, %L)',
           gen_random_uuid(), t.site(1), t.id('admin'), t.h('priv')),
    format('SELECT * FROM public.verify_invitation_code(''erin@example.test'', %L)', t.h('666666')),
    format('SELECT public.claim_invitation(%L)', t.id('inv_e2')),
    format('SELECT public.release_invitation_claim(%L, %L)', t.id('inv_e2'), gen_random_uuid()),
    format('SELECT public.consume_invitation(%L, %L)', t.id('inv_e2'), gen_random_uuid()),
    format('SELECT public.reissue_invitation(%L, %L, %L, ''X'', ''collector'', ARRAY[%L]::uuid[])',
           t.id('inv_h'), t.id('admin'), t.h('priv2'), t.site(1))];
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH c IN ARRAY v_calls LOOP
      BEGIN
        PERFORM t.become(r, t.id('admin'));
        EXECUTE c;
        RAISE EXCEPTION '% was able to run: %', r, c;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
  END LOOP;
  BEGIN
    PERFORM t.become('anon', t.id('admin'));
    PERFORM public.revoke_invitation(t.id('inv_e2'));
    RAISE EXCEPTION 'anon revoked';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT to_jsonb(t.inv(t.id('inv_e2'))) = v_before, 'denied calls changed the row';
  PERFORM t.pass('anon and authenticated (even with an admin JWT) are denied the 6 service functions; anon denied revoke');
END $$;

-- 30
DO $$
DECLARE n BIGINT;
BEGIN
  PERFORM t.as_user(t.id('admin'));
  SELECT count(*) INTO n FROM public.invitations;
  ASSERT n > 0, 'admin sees no rows';
  PERFORM id, auth_user_id, email, invited_by, role, status, failed_attempts,
          expires_at, created_at, accepted_at, revoked_at, revoked_by, superseded_by
  FROM public.invitations;
  BEGIN
    PERFORM code_hash FROM public.invitations;
    RAISE EXCEPTION 'admin read code_hash';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.invitations;
    RAISE EXCEPTION 'admin SELECT * allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.invitations WHERE code_hash = 'x';
    RAISE EXCEPTION 'admin filtered on code_hash';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.invitations SET failed_attempts = 0;
    RAISE EXCEPTION 'admin UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.invitations;
    RAISE EXCEPTION 'admin DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.invitations (auth_user_id, email, invited_by, role, code_hash, expires_at)
    VALUES (gen_random_uuid(), 'z@z.test', gen_random_uuid(), 'collector', t.h('z'), now());
    RAISE EXCEPTION 'admin INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM t.as_user(t.id('collector_active'));
  SELECT count(*) INTO n FROM (SELECT id FROM public.invitations) AS s;
  ASSERT n = 0, 'non-admin sees rows';
  PERFORM t.as_user(t.id('admin2'));
  SELECT count(*) INTO n FROM (SELECT id FROM public.invitations) AS s;
  ASSERT n = 0, 'inactive admin sees rows';
  BEGIN
    PERFORM t.become('anon');
    PERFORM id FROM public.invitations;
    RAISE EXCEPTION 'anon SELECT allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM t.become('postgres');
  ASSERT NOT has_column_privilege('authenticated', 'public.invitations', 'code_hash', 'SELECT');
  ASSERT has_column_privilege('authenticated', 'public.invitations', 'revoked_by', 'SELECT');
  ASSERT NOT has_table_privilege('anon', 'public.invitations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
  ASSERT NOT has_table_privilege('authenticated', 'public.invitations', 'INSERT,UPDATE,DELETE,TRUNCATE');
  PERFORM t.pass('admins read rows (incl. revoked_by) but never code_hash; no writes; non-admins 0 rows; anon nothing');
END $$;

-- 31
DO $$
DECLARE v_e UUID := t.id('e');
BEGIN
  ASSERT (SELECT count(*) FROM public.invitations WHERE auth_user_id = v_e) = 2;
  DELETE FROM auth.users WHERE id = v_e;
  ASSERT NOT EXISTS (SELECT 1 FROM public.invitations WHERE auth_user_id = v_e);
  PERFORM t.pass('deleting an Auth user cascades through a superseded chain');
END $$;

-- ============================================================ S1b: sites per role
-- Collectors and site managers need at least one site in register, reissue
-- and consume; recyclers may have none. All calls run as service_role.

-- 32: register
DO $$
DECLARE v_u UUID; v_inv UUID; v_role TEXT; v_sites UUID[]; k INTEGER := 0;
BEGIN
  PERFORM t.become('service_role');
  -- collector / site_manager with '{}' or NULL: refused, nothing written
  FOREACH v_role IN ARRAY ARRAY['collector', 'site_manager'] LOOP
    FOR i IN 1..2 LOOP
      k := k + 1;
      v_sites := CASE i WHEN 1 THEN '{}'::uuid[] ELSE NULL END;
      v_u := t.mkuser('s1b_reg_' || k, 's1b.reg' || k || '@example.test');
      BEGIN
        PERFORM public.register_invitation(v_u, 's1b.reg' || k || '@example.test', 'R',
          v_role::public.user_role, v_sites, t.id('admin'), t.h('s1b' || k));
        RAISE EXCEPTION '% registered with sites %', v_role, v_sites;
      EXCEPTION WHEN raise_exception THEN
        ASSERT SQLERRM = 'At least one site assignment is required', SQLERRM;
      END;
      ASSERT t.inv_count(v_u) = 0, v_role || ': invitation written';
      ASSERT t.sites_of(v_u) = '{}', v_role || ': sites written';
      ASSERT (SELECT p.role = 'collector' AND NOT p.is_active FROM t.profile(v_u) AS p),
        v_role || ': profile changed';
    END LOOP;
  END LOOP;

  -- recycler with '{}' and with NULL: accepted, zero sites
  FOR i IN 1..2 LOOP
    v_sites := CASE i WHEN 1 THEN '{}'::uuid[] ELSE NULL END;
    v_u := t.mkuser('s1b_rec_' || i, 's1b.rec' || i || '@example.test');
    v_inv := public.register_invitation(v_u, 's1b.rec' || i || '@example.test', 'Rec',
      'recycler', v_sites, t.id('admin'), t.h('s1brec' || i));
    PERFORM t.put('s1b_rec_inv_' || i, v_inv);
    ASSERT t.status(v_inv) = 'pending';
    ASSERT t.sites_of(v_u) = '{}', 'recycler got sites';
    ASSERT (SELECT p.role = 'recycler' AND NOT p.is_active FROM t.profile(v_u) AS p);
  END LOOP;

  -- recycler with sites: still allowed; duplicates still refused
  v_u := t.mkuser('s1b_rec_3', 's1b.rec3@example.test');
  v_inv := public.register_invitation(v_u, 's1b.rec3@example.test', 'Rec', 'recycler',
    ARRAY[t.site(4)], t.id('admin'), t.h('s1brec3'));
  ASSERT t.sites_of(v_u) = ARRAY[t.site(4)];
  v_u := t.mkuser('s1b_rec_4', 's1b.rec4@example.test');
  BEGIN
    PERFORM public.register_invitation(v_u, 's1b.rec4@example.test', 'Rec', 'recycler',
      ARRAY[t.site(4), t.site(4)], t.id('admin'), t.h('s1brec4'));
    RAISE EXCEPTION 'recycler duplicate sites accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'Duplicate site assignments are not allowed', SQLERRM;
  END;
  BEGIN
    PERFORM public.register_invitation(v_u, 's1b.rec4@example.test', 'Rec', 'recycler',
      ARRAY[gen_random_uuid()], t.id('admin'), t.h('s1brec4'));
    RAISE EXCEPTION 'recycler unknown site accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'One or more selected sites%', SQLERRM;
  END;
  ASSERT t.inv_count(v_u) = 0;

  -- site manager with one site: accepted (control)
  v_u := t.mkuser('s1b_mgr', 's1b.mgr@example.test');
  v_inv := public.register_invitation(v_u, 's1b.mgr@example.test', 'Mgr', 'site_manager',
    ARRAY[t.site(6)], t.id('admin'), t.h('s1bmgr'));
  PERFORM t.put('s1b_mgr_inv', v_inv);
  ASSERT t.sites_of(v_u) = ARRAY[t.site(6)];
  PERFORM t.pass('register: collector/site_manager need >= 1 site ({} and NULL refused, nothing written); recycler may have 0 (or some) sites');
END $$;

-- 33: consume
DO $$
DECLARE v_inv UUID; v_u UUID;
BEGIN
  PERFORM t.become('service_role');
  -- recyclers with zero sites activate
  FOR i IN 1..2 LOOP
    v_inv := t.id('s1b_rec_inv_' || i);
    v_u := t.id('s1b_rec_' || i);
    PERFORM t.confirm(v_u);
    ASSERT t.sites_of(v_u) = '{}';
    ASSERT t.consume(v_inv) = v_inv;
    ASSERT t.status(v_inv) = 'accepted';
    ASSERT (SELECT p.is_active AND p.role = 'recycler' FROM t.profile(v_u) AS p);
  END LOOP;

  -- a site manager whose sites were removed cannot activate
  v_inv := t.id('s1b_mgr_inv');
  v_u := t.id('s1b_mgr');
  PERFORM t.confirm(v_u);
  PERFORM t.as_owner(format('DELETE FROM public.user_sites WHERE user_id = %L', v_u));
  BEGIN
    PERFORM t.consume(v_inv);
    RAISE EXCEPTION 'site manager consumed without sites';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'No site assignment exists for this invitation', SQLERRM;
  END;
  ASSERT t.status(v_inv) = 'pending' AND NOT (t.profile(v_u)).is_active;
  -- with a site again it activates
  PERFORM t.assign(v_u, t.site(6));
  ASSERT t.consume(v_inv) = v_inv;
  ASSERT (SELECT p.is_active AND p.role = 'site_manager' FROM t.profile(v_u) AS p);
  -- (collector without sites: test 14)
  PERFORM t.pass('consume: recycler with 0 sites activates; site manager (and collector, test 14) with 0 sites refused, nothing changed');
END $$;

-- 34: reissue
DO $$
DECLARE v_u UUID; v_inv UUID; v_new UUID; v_before JSONB; v_role TEXT;
BEGIN
  PERFORM t.become('service_role');
  v_u := t.mkuser('s1b_re', 's1b.re@example.test');
  v_inv := public.register_invitation(v_u, 's1b.re@example.test', 'Re', 'collector',
    ARRAY[t.site(7)], t.id('admin'), t.h('s1bre1'));
  PERFORM t.expire(v_inv);
  v_before := to_jsonb(t.inv(v_inv));

  -- collector / site_manager with '{}' or NULL: refused, nothing changed
  FOREACH v_role IN ARRAY ARRAY['collector', 'site_manager'] LOOP
    BEGIN
      PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('s1bre2'), 'Re',
        v_role::public.user_role, '{}'::uuid[]);
      RAISE EXCEPTION '% reissued with no sites', v_role;
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'At least one site assignment is required', SQLERRM;
    END;
    BEGIN
      PERFORM public.reissue_invitation(v_inv, t.id('admin'), t.h('s1bre2'), 'Re',
        v_role::public.user_role, NULL);
      RAISE EXCEPTION '% reissued with NULL sites', v_role;
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'At least one site assignment is required', SQLERRM;
    END;
  END LOOP;
  ASSERT to_jsonb(t.inv(v_inv)) = v_before, 'old invitation changed';
  ASSERT t.inv_count(v_u) = 1;
  ASSERT t.sites_of(v_u) = ARRAY[t.site(7)], 'sites changed';
  ASSERT (t.profile(v_u)).role = 'collector';

  -- reissue as a recycler with no sites: old sites cleared, then consumable
  v_new := public.reissue_invitation(v_inv, t.id('admin'), t.h('s1bre3'), 'Re',
    'recycler', '{}'::uuid[]);
  ASSERT t.status(v_inv) = 'superseded' AND (t.inv(v_inv)).superseded_by = v_new;
  ASSERT t.sites_of(v_u) = '{}', 'sites not cleared';
  ASSERT (t.profile(v_u)).role = 'recycler';
  PERFORM t.confirm(v_u);
  ASSERT (t.v('s1b.re@example.test', 's1bre3')->>'is_valid')::bool;
  ASSERT t.consume(v_new) = v_new;
  ASSERT (SELECT p.is_active AND p.role = 'recycler' FROM t.profile(v_u) AS p);

  -- recycler reissue with NULL sites is also accepted
  v_u := t.mkuser('s1b_re2', 's1b.re2@example.test');
  v_inv := public.register_invitation(v_u, 's1b.re2@example.test', 'Re2', 'site_manager',
    ARRAY[t.site(8)], t.id('admin'), t.h('s1bre4'));
  PERFORM t.revoke_as(v_inv, t.id('admin'));
  v_new := public.reissue_invitation(v_inv, t.id('admin'), t.h('s1bre5'), 'Re2',
    'recycler', NULL);
  ASSERT t.status(v_new) = 'pending' AND t.sites_of(v_u) = '{}';
  PERFORM t.pass('reissue: collector/site_manager need >= 1 site ({} and NULL refused, nothing changed); recycler may be reissued with 0 sites and then consumed');
END $$;

-- ============================================================ activation claim
-- claim_invitation / release_invitation_claim / consume_invitation(id, token).
-- All calls run as service_role, as the accept-invitation Edge Function does.
-- Concurrent claims are in 50_invitations_concurrency.

-- 35
DO $$
DECLARE v_u UUID; v_inv UUID; v_tok UUID; v_bad UUID;
BEGIN
  PERFORM t.become('service_role');
  v_u := t.mkuser('cl1', 'claim1@example.test');
  v_inv := public.register_invitation(v_u, 'claim1@example.test', 'Claim One', 'collector',
    ARRAY[t.site(1)], t.id('admin'), t.h('claim-1'));
  PERFORM t.confirm(v_u);
  ASSERT t.claim_token(v_inv) IS NULL AND t.claim_expires_at(v_inv) IS NULL, 'new row has a claim';

  v_tok := public.claim_invitation(v_inv);
  ASSERT v_tok IS NOT NULL AND t.claim_token(v_inv) = v_tok, 'claim not stored';
  ASSERT t.claim_expires_at(v_inv) = now() + interval '2 minutes', '2-minute lease';
  ASSERT public.claim_invitation(v_inv) IS NULL, 'second claim while the first is live';
  ASSERT t.claim_token(v_inv) = v_tok, 'losing claim changed the token';
  ASSERT t.attempts(v_inv) = 0, 'claims count as failed attempts';

  FOREACH v_bad IN ARRAY ARRAY[NULL, gen_random_uuid()]::uuid[] LOOP
    BEGIN
      PERFORM public.consume_invitation(v_inv, v_bad);
      RAISE EXCEPTION 'consumed without the claim token (%)', v_bad;
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'Invitation claim is not held', SQLERRM;
    END;
  END LOOP;
  ASSERT t.status(v_inv) = 'pending' AND NOT (t.profile(v_u)).is_active;

  ASSERT public.consume_invitation(v_inv, v_tok) = v_inv;
  ASSERT t.status(v_inv) = 'accepted' AND (t.profile(v_u)).is_active;
  ASSERT t.claim_token(v_inv) IS NULL AND t.claim_expires_at(v_inv) IS NULL, 'accept kept the claim';
  ASSERT public.claim_invitation(v_inv) IS NULL, 'claimed an accepted invitation';
  BEGIN
    PERFORM public.consume_invitation(v_inv, v_tok);
    RAISE EXCEPTION 'consumed twice with the same token';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation is not valid', SQLERRM; END;
  PERFORM t.pass('claim: one live holder, 2-minute lease, not a failed attempt; consume needs the holder''s token; accept clears the claim');
END $$;

-- 36
DO $$
DECLARE v_u UUID; v_inv UUID; v_old UUID; v_new UUID;
BEGIN
  PERFORM t.become('service_role');
  v_u := t.mkuser('cl2', 'claim2@example.test');
  v_inv := public.register_invitation(v_u, 'claim2@example.test', 'Claim Two', 'collector',
    ARRAY[t.site(2)], t.id('admin'), t.h('claim-2'));
  PERFORM t.confirm(v_u);

  v_old := public.claim_invitation(v_inv);
  PERFORM t.expire_claim(v_inv);                      -- holder abandoned it
  v_new := public.claim_invitation(v_inv);
  ASSERT v_new IS NOT NULL AND v_new <> v_old, 'expired claim was not replaced';
  ASSERT NOT public.release_invitation_claim(v_inv, v_old), 'old token released the new claim';
  ASSERT NOT public.release_invitation_claim(v_inv, NULL), 'NULL token released a claim';
  ASSERT t.claim_token(v_inv) = v_new;
  BEGIN
    PERFORM public.consume_invitation(v_inv, v_old);
    RAISE EXCEPTION 'superseded claim holder consumed';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation claim is not held', SQLERRM; END;

  ASSERT public.release_invitation_claim(v_inv, v_new), 'holder could not release';
  ASSERT t.claim_token(v_inv) IS NULL AND t.claim_expires_at(v_inv) IS NULL;
  ASSERT NOT public.release_invitation_claim(v_inv, v_new), 'released twice';
  v_new := public.claim_invitation(v_inv);
  ASSERT v_new IS NOT NULL, 'released invitation is not claimable';
  ASSERT public.consume_invitation(v_inv, v_new) = v_inv;
  ASSERT (t.profile(v_u)).is_active;
  PERFORM t.pass('an expired claim is replaced and its old token can neither consume nor release; a released claim can be claimed again');
END $$;

-- 37
DO $$
DECLARE v_u UUID; v_inv UUID; c TEXT; v_before JSONB;
BEGIN
  PERFORM t.become('service_role');
  ASSERT public.claim_invitation(gen_random_uuid()) IS NULL, 'unknown id';
  ASSERT public.claim_invitation(NULL) IS NULL, 'NULL id';
  FOREACH c IN ARRAY ARRAY['expired', 'locked', 'revoked', 'superseded'] LOOP
    v_u := t.mkuser('cl3_' || c, 'claim3.' || c || '@example.test');
    v_inv := public.register_invitation(v_u, 'claim3.' || c || '@example.test', 'C3',
      'collector', ARRAY[t.site(3)], t.id('admin'), t.h('claim-3-' || c));
    PERFORM t.confirm(v_u);
    CASE c
      WHEN 'expired' THEN PERFORM t.expire(v_inv);
      WHEN 'locked' THEN PERFORM t.as_owner(format(
        'UPDATE public.invitations SET failed_attempts = 5 WHERE id = %L', v_inv));
      WHEN 'revoked' THEN PERFORM t.revoke_as(v_inv, t.id('admin'));
      WHEN 'superseded' THEN
        PERFORM t.revoke_as(v_inv, t.id('admin'));
        PERFORM t.put('cl3_new', public.reissue_invitation(v_inv, t.id('admin'),
          t.h('claim-3-new'), 'C3', 'collector', ARRAY[t.site(3)]));
    END CASE;
    v_before := to_jsonb(t.inv(v_inv));
    ASSERT public.claim_invitation(v_inv) IS NULL, 'claimed a ' || c || ' invitation';
    ASSERT to_jsonb(t.inv(v_inv)) = v_before, c || ' row changed by a refused claim';
  END LOOP;
  ASSERT public.claim_invitation(t.id('cl3_new')) IS NOT NULL, 'reissued invitation not claimable';
  PERFORM t.pass('claim returns NULL and changes nothing for unknown, expired, locked, revoked and superseded invitations');
END $$;

-- 38
DO $$
DECLARE v_u UUID; v_inv UUID; v_tok UUID; v_new UUID; v_tok2 UUID;
BEGIN
  PERFORM t.become('service_role');
  -- revoke clears a live claim, and its holder cannot consume
  v_u := t.mkuser('cl4', 'claim4@example.test');
  v_inv := public.register_invitation(v_u, 'claim4@example.test', 'Claim Four', 'collector',
    ARRAY[t.site(4)], t.id('admin'), t.h('claim-4'));
  PERFORM t.confirm(v_u);
  v_tok := public.claim_invitation(v_inv);
  PERFORM t.revoke_as(v_inv, t.id('admin'));
  ASSERT t.status(v_inv) = 'revoked' AND t.claim_token(v_inv) IS NULL
     AND t.claim_expires_at(v_inv) IS NULL, 'revoke kept the claim';
  BEGIN
    PERFORM public.consume_invitation(v_inv, v_tok);
    RAISE EXCEPTION 'consumed a revoked invitation';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation is not valid', SQLERRM; END;

  -- reissue: the new row starts unclaimed; the old token is useless on it
  v_new := public.reissue_invitation(v_inv, t.id('admin'), t.h('claim-4b'), 'Claim Four',
    'collector', ARRAY[t.site(4)]);
  ASSERT t.claim_token(v_new) IS NULL AND t.claim_token(v_inv) IS NULL, 'reissue left a claim';
  BEGIN
    PERFORM public.consume_invitation(v_new, v_tok);
    RAISE EXCEPTION 'old token consumed the reissued invitation';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'Invitation claim is not held', SQLERRM; END;

  -- an expired pending invitation with a live claim can still be reissued
  -- (the superseded row drops the claim)
  v_tok2 := public.claim_invitation(v_new);
  ASSERT v_tok2 IS NOT NULL, 'reissued row not claimable';
  PERFORM t.expire(v_new);
  v_inv := public.reissue_invitation(v_new, t.id('admin'), t.h('claim-4c'), 'Claim Four',
    'collector', ARRAY[t.site(4)]);
  ASSERT t.status(v_new) = 'superseded' AND t.claim_token(v_new) IS NULL, 'superseded row kept its claim';
  ASSERT (t.v('claim4@example.test', 'claim-4c')->>'is_valid')::bool, 'new code does not verify';
  ASSERT t.consume(v_inv) = v_inv, 'reissued row not consumable';
  ASSERT (t.profile(v_u)).is_active, 'profile not activated';
  PERFORM t.pass('revoke and reissue clear a live claim; the old holder cannot consume either row');
END $$;

-- 39: the accept-invitation failure path. The claim and the password are
-- committed before consume, so a failed consume leaves a confirmed, inactive
-- user; the Edge Function releases the claim and an admin recovers the
-- account with revoke + reissue.
DO $$
DECLARE v_u UUID; v_inv UUID; v_tok UUID; v_new UUID;
BEGIN
  PERFORM t.become('service_role');
  v_u := t.mkuser('cl5', 'claim5@example.test');
  v_inv := public.register_invitation(v_u, 'claim5@example.test', 'Claim Five', 'collector',
    ARRAY[t.site(5)], t.id('admin'), t.h('claim-5'));
  PERFORM t.as_owner(format('DELETE FROM public.user_sites WHERE user_id = %L', v_u));
  ASSERT (t.v('claim5@example.test', 'claim-5')->>'is_valid')::bool;
  v_tok := public.claim_invitation(v_inv);
  PERFORM t.confirm(v_u);                               -- password set, email confirmed
  BEGIN
    PERFORM public.consume_invitation(v_inv, v_tok);
    RAISE EXCEPTION 'consumed without sites';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'No site assignment exists for this invitation', SQLERRM;
  END;
  ASSERT t.claim_token(v_inv) = v_tok, 'failed consume dropped the claim';
  ASSERT public.release_invitation_claim(v_inv, v_tok);
  ASSERT t.status(v_inv) = 'pending' AND NOT (t.profile(v_u)).is_active;

  PERFORM t.revoke_as(v_inv, t.id('admin'));
  v_new := public.reissue_invitation(v_inv, t.id('admin'), t.h('claim-5b'), 'Claim Five',
    'collector', ARRAY[t.site(5), t.site(6)]);
  ASSERT (t.v('claim5@example.test', 'claim-5b')->>'is_valid')::bool;
  v_tok := public.claim_invitation(v_new);
  ASSERT public.consume_invitation(v_new, v_tok) = v_new;
  ASSERT (SELECT p.is_active AND p.role = 'collector' FROM t.profile(v_u) AS p);
  ASSERT t.sites_of(v_u) = t.sorted(ARRAY[t.site(5), t.site(6)]);
  PERFORM t.pass('failed consume after claim: claim released, profile inactive; revoke + reissue + claim + consume recovers');
END $$;

-- 40: claim CHECK (tamper as owner).
DO $$
DECLARE s TEXT; v_pending UUID := t.id('cl3_new'); v_accepted UUID := t.id('inv_c');
  v_stmts TEXT[];
BEGIN
  v_stmts := ARRAY[
    format('UPDATE public.invitations SET claim_token = gen_random_uuid(), claim_expires_at = NULL WHERE id = %L', v_pending),
    format('UPDATE public.invitations SET claim_token = NULL, claim_expires_at = now() WHERE id = %L', v_pending),
    format('UPDATE public.invitations SET claim_token = gen_random_uuid(), claim_expires_at = now() WHERE id = %L', v_accepted)];
  FOREACH s IN ARRAY v_stmts LOOP
    BEGIN
      PERFORM t.as_owner(s);
      RAISE EXCEPTION 'constraint allowed: %', s;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  PERFORM t.pass('claim CHECK: token and expiry both or neither, and only on pending rows');
END $$;
