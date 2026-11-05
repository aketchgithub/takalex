-- Read-only privilege catalog report for the LOCAL Supabase stack.
-- See README.md in this directory for how to run it.
--
-- Prints the effective privilege matrix (has_table_privilege /
-- has_column_privilege / has_function_privilege) for PUBLIC, anon,
-- authenticated and service_role on every table, column and function in
-- public, next to the expected values. The expected values are a copy of
-- the matrix in supabase/tests/sql/suites/60_privileges.sql: keep the two in
-- sync. Any row whose last column is not "ok" is a difference.
-- Runs in a READ ONLY transaction and creates nothing.
BEGIN TRANSACTION READ ONLY;
\pset pager off
WITH roles(role) AS (VALUES ('public'),('anon'),('authenticated'),('service_role')),
tbls AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
tp AS (
  SELECT t.relname, r.role, p.priv, p.ord, has_table_privilege(r.role, t.oid, p.priv) AS has
  FROM tbls t CROSS JOIN roles r CROSS JOIN (VALUES ('SELECT',1),('INSERT',2),('UPDATE',3),('DELETE',4),('TRUNCATE',5),('REFERENCES',6),('TRIGGER',7)) p(priv,ord)),
tabl AS (SELECT relname, role, string_agg(priv, ',' ORDER BY ord) FILTER (WHERE has) AS tl FROM tp GROUP BY relname, role),
colp AS (
  SELECT t.relname, r.role, p.priv, p.ord,
    (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname::text) FROM pg_attribute a
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(r.role, t.oid, a.attnum, p.priv)) AS cols
  FROM tbls t CROSS JOIN roles r CROSS JOIN (VALUES ('SELECT',1),('INSERT',2),('UPDATE',3),('REFERENCES',4)) p(priv,ord)
  WHERE NOT has_table_privilege(r.role, t.oid, p.priv)),
cl AS (SELECT relname, role, string_agg(priv||'('||cols||')', ' ' ORDER BY ord) FILTER (WHERE cols IS NOT NULL) AS cl FROM colp GROUP BY relname, role),
actual AS (SELECT tabl.relname AS tbl, tabl.role, COALESCE(tl,'-')||' | '||COALESCE(cl.cl,'-') AS privs FROM tabl LEFT JOIN cl USING (relname, role)),
expected(tbl, role, privs) AS (VALUES
  ('access_requests', 'public',        '- | -'),
  ('access_requests', 'anon',          '- | INSERT(email,full_name,phone,referral_source,role,site_name)'),
  ('access_requests', 'authenticated', 'SELECT | INSERT(email,full_name,phone,referral_source,role,site_name) UPDATE(notes,status)'),
  ('access_requests', 'service_role',  '- | SELECT(email,full_name,id,phone,role,site_name,status) UPDATE(status)'),
  ('collection_events', 'public',        '- | -'),
  ('collection_events', 'anon',          '- | -'),
  ('collection_events', 'authenticated', 'SELECT | -'),
  ('collection_events', 'service_role',  '- | -'),
  ('collection_evidence', 'public',        '- | -'),
  ('collection_evidence', 'anon',          '- | -'),
  ('collection_evidence', 'authenticated', 'SELECT,INSERT | -'),
  ('collection_evidence', 'service_role',  '- | -'),
  ('collection_logs', 'public',        '- | -'),
  ('collection_logs', 'anon',          '- | -'),
  ('collection_logs', 'authenticated', 'SELECT | INSERT(captured_at,client_record_id,device_accuracy_m,device_latitude,device_longitude,material_code,reported_weight_kg,site_id)'),
  ('collection_logs', 'service_role',  '- | -'),
  ('collection_verified_items', 'public',        '- | -'),
  ('collection_verified_items', 'anon',          '- | -'),
  ('collection_verified_items', 'authenticated', 'SELECT | -'),
  ('collection_verified_items', 'service_role',  '- | -'),
  ('invitations', 'public',        '- | -'),
  ('invitations', 'anon',          '- | -'),
  ('invitations', 'authenticated', '- | SELECT(accepted_at,auth_user_id,created_at,email,expires_at,failed_attempts,id,invited_by,revoked_at,revoked_by,role,status,superseded_by)'),
  ('invitations', 'service_role',  '- | SELECT(accepted_at,auth_user_id,created_at,email,expires_at,failed_attempts,id,invited_by,revoked_at,revoked_by,role,status,superseded_by)'),
  ('materials', 'public',        '- | -'),
  ('materials', 'anon',          '- | -'),
  ('materials', 'authenticated', 'SELECT | -'),
  ('materials', 'service_role',  '- | -'),
  ('profiles', 'public',        '- | -'),
  ('profiles', 'anon',          '- | -'),
  ('profiles', 'authenticated', 'SELECT | -'),
  ('profiles', 'service_role',  'SELECT | -'),
  ('sites', 'public',        '- | -'),
  ('sites', 'anon',          '- | -'),
  ('sites', 'authenticated', 'SELECT | -'),
  ('sites', 'service_role',  'SELECT | -'),
  ('sme_groups', 'public',        '- | -'),
  ('sme_groups', 'anon',          '- | -'),
  ('sme_groups', 'authenticated', 'SELECT | -'),
  ('sme_groups', 'service_role',  '- | -'),
  ('user_sites', 'public',        '- | -'),
  ('user_sites', 'anon',          '- | -'),
  ('user_sites', 'authenticated', 'SELECT | -'),
  ('user_sites', 'service_role',  'SELECT | -'))
SELECT COALESCE(a.tbl,e.tbl) tbl, COALESCE(a.role,e.role) role, a.privs AS actual,
  CASE WHEN e.privs IS NULL THEN 'NOT IN MATRIX' WHEN a.privs IS NULL THEN 'MISSING TABLE'
       WHEN a.privs = e.privs THEN 'ok' ELSE 'DIFF expected: '||e.privs END AS vs_expected
FROM actual a FULL JOIN expected e ON e.tbl=a.tbl AND e.role=a.role
ORDER BY 1, array_position(ARRAY['public','anon','authenticated','service_role'], COALESCE(a.role,e.role));

\echo === functions
WITH expected(sig, kind, definer, anon, authn, service) AS (VALUES
  ('public.enforce_collection_insert()','trigger',false,false,false,false),
  ('public.protect_collection_update()','trigger',false,false,false,false),
  ('public.record_collection_submitted()','trigger',true,false,false,false),
  ('public.protect_collection_verified_item()','trigger',false,false,false,false),
  ('public.handle_new_auth_user()','trigger',true,false,false,false),
  ('public.sync_auth_user_profile()','trigger',true,false,false,false),
  ('public.set_access_request_reviewer()','trigger',false,false,false,false),
  ('public.is_active_admin()','rls_helper',true,false,true,false),
  ('public.is_active_site_member(uuid)','rls_helper',true,false,true,false),
  ('public.can_review_site(uuid)','rls_helper',true,false,true,false),
  ('public.review_collection(uuid,boolean,jsonb,text)','rpc',true,false,true,false),
  ('public.revoke_invitation(uuid)','rpc',true,false,true,false),
  ('public.register_invitation(uuid,text,text,public.user_role,uuid[],uuid,text)','rpc',true,false,false,true),
  ('public.verify_invitation_code(text,text)','rpc',true,false,false,true),
  ('public.consume_invitation(uuid)','rpc',true,false,false,true),
  ('public.reissue_invitation(uuid,uuid,text,text,public.user_role,uuid[])','rpc',true,false,false,true),
  ('public.bootstrap_first_admin(text)','owner_only',true,false,false,false)),
f AS (SELECT p.oid, p.oid::regprocedure::text sig, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
SELECT COALESCE(f.sig, e.sig) sig, e.kind,
  has_function_privilege('public', f.oid,'EXECUTE') pub, has_function_privilege('anon', f.oid,'EXECUTE') anon,
  has_function_privilege('authenticated', f.oid,'EXECUTE') authn, has_function_privilege('service_role', f.oid,'EXECUTE') svc,
  f.prosecdef definer, array_to_string(f.proconfig,',') cfg,
  CASE WHEN e.sig IS NULL THEN 'NOT IN MATRIX' WHEN f.oid IS NULL THEN 'MISSING FUNCTION'
    WHEN has_function_privilege('public', f.oid,'EXECUTE') OR has_function_privilege('anon', f.oid,'EXECUTE')<>e.anon
      OR has_function_privilege('authenticated', f.oid,'EXECUTE')<>e.authn OR has_function_privilege('service_role', f.oid,'EXECUTE')<>e.service
      OR f.prosecdef<>e.definer OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN 'DIFF' ELSE 'ok' END vs_expected
FROM f FULL JOIN expected e ON to_regprocedure(e.sig)=f.oid ORDER BY e.kind NULLS FIRST, 1;

\echo === RLS / ownership
SELECT c.relname, c.relrowsecurity rls, c.relforcerowsecurity force_rls, pg_get_userbyid(c.relowner) owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;
\echo === non-table relations in public
SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind NOT IN ('r','i');
\echo === sites.location type
SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid='public.sites'::regclass AND a.attname='location';
SELECT postgis_typmod_type(a.atttypmod) AS geo_type, postgis_typmod_srid(a.atttypmod) AS srid FROM pg_attribute a WHERE a.attrelid='public.sites'::regclass AND a.attname='location';
\echo === role membership of API roles
SELECT pg_get_userbyid(member) member, pg_get_userbyid(roleid) in_role FROM pg_auth_members WHERE pg_get_userbyid(member) IN ('anon','authenticated','service_role');
SELECT rolname, rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY 1;
\echo === default ACLs (public schema + global)
SELECT pg_get_userbyid(d.defaclrole) role, COALESCE(n.nspname,'<global>') nsp, d.defaclobjtype type, array_to_string(d.defaclacl,' ') acl
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' OR d.defaclnamespace=0 ORDER BY 1,2,3;
\echo === postgres default ACLs in public that still grant API roles (expected: 0 rows)
SELECT d.defaclobjtype type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee, a.privilege_type
FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace, aclexplode(d.defaclacl) a
WHERE n.nspname='public' AND pg_get_userbyid(d.defaclrole)='postgres'
  AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role'))
ORDER BY 1,2,3;
\echo === raw ACL anomalies (PUBLIC entries, grant options, unexpected grantees)
SELECT obj, CASE WHEN grantee_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee_oid) END grantee, privilege_type, is_grantable FROM (
  SELECT c.relname obj, a.grantee grantee_oid, a.privilege_type, a.is_grantable, c.relowner owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, aclexplode(c.relacl) a WHERE n.nspname='public' AND c.relkind='r'
  UNION ALL SELECT c.relname||'.'||att.attname, a.grantee, a.privilege_type, a.is_grantable, c.relowner FROM pg_attribute att JOIN pg_class c ON c.oid=att.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace, aclexplode(att.attacl) a WHERE n.nspname='public' AND att.attnum>0
  UNION ALL SELECT p.oid::regprocedure::text, a.grantee, a.privilege_type, a.is_grantable, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, aclexplode(p.proacl) a WHERE n.nspname='public') s
WHERE grantee_oid=0 OR (grantee_oid<>owner AND (is_grantable OR pg_get_userbyid(grantee_oid) NOT IN ('anon','authenticated','service_role')));
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proacl IS NULL;
ROLLBACK;
