-- Security tests for the schema. Run against a throwaway Postgres
-- (see scripts/test-db.sh) — never against your real Supabase project.
\set QUIET on
\set ON_ERROR_STOP on

create function public.t_fail(label text, q text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'PASS (blocked) %: %', label, sqlerrm; return; end;
  raise exception 'FAIL: % should have been blocked', label;
end $$;
create function public.t_rows(label text, q text, expected int) returns void language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  if n <> expected then raise exception 'FAIL: % expected % rows, got %', label, expected, n; end if;
  raise notice 'PASS %: % rows', label, n;
end $$;
create function public.t_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, false);
end $$;
grant execute on function public.t_fail(text, text), public.t_rows(text, text, int), public.t_as(text) to anon, authenticated;
create table public.t_ids (k text primary key, v uuid);
grant all on public.t_ids to authenticated;

-- Accounts, in creation order. The first one becomes the owner.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at) values
  ('00000000-0000-0000-0000-0000000000ff', 'Owner@Example.com', now(), '{"display_name":"Owner"}', now() - interval '5 min');
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at) values
  ('a0000000-0000-0000-0000-000000000000', 'alice@example.com', now(), '{"display_name":"Alice"}', now() - interval '4 min'),
  ('b0000000-0000-0000-0000-000000000000', 'bob@example.com', now(), '{"full_name":"Bob B"}', now() - interval '3 min'),
  ('c0000000-0000-0000-0000-000000000000', 'carol@example.com', now(), '{}', now() - interval '2 min'),
  ('e0000000-0000-0000-0000-000000000000', 'stranger@example.com', now(), '{}', now() - interval '1 min');
select t_rows('profiles created for every account', 'select 1 from public.profiles', 5);
select t_rows('first account is the owner', $q$select 1 from public.app_admins where user_id = '00000000-0000-0000-0000-0000000000ff'$q$, 1);
select t_rows('only the owner starts approved', 'select 1 from public.profiles where approved', 1);

set role authenticated;

-- ===================== Not-yet-approved accounts can do nothing
select t_as('a0000000-0000-0000-0000-000000000000');
select t_rows('alice is not owner, not approved', 'select 1 from public.whoami() where not is_owner and not approved', 1);
select t_fail('non-owner cannot create organizations', $q$select public.create_organization('Mine')$q$);
select t_fail('non-owner cannot list accounts', 'select * from public.admin_accounts()');
select t_fail('non-owner cannot approve', $q$select public.admin_set_approved('a0000000-0000-0000-0000-000000000000', true)$q$);
select t_fail('non-owner cannot set passwords', $q$select public.admin_set_password('b0000000-0000-0000-0000-000000000000', 'hunter2hunter2')$q$);
select t_fail('cannot approve yourself directly', $q$update public.profiles set approved = true where id = 'a0000000-0000-0000-0000-000000000000'$q$);
select t_fail('cannot make yourself owner', $q$insert into public.app_admins values ('a0000000-0000-0000-0000-000000000000')$q$);

-- ===================== Owner sets everything up from the app
select t_as('00000000-0000-0000-0000-0000000000ff');
select t_rows('owner sees every account', 'select 1 from public.admin_accounts()', 5);
select public.admin_set_approved('a0000000-0000-0000-0000-000000000000', true);
select public.admin_set_approved('b0000000-0000-0000-0000-000000000000', true);
select public.admin_set_approved('c0000000-0000-0000-0000-000000000000', true);
select t_fail('cannot make an unapproved account an org admin', $q$select public.create_organization('X', 'e0000000-0000-0000-0000-000000000000')$q$);
insert into public.t_ids values ('orgA', public.create_organization('Alice Club', 'a0000000-0000-0000-0000-000000000000'));
insert into public.t_ids values ('orgB', public.create_organization('Bob Club', 'b0000000-0000-0000-0000-000000000000'));
select t_rows('owner sees all organizations', 'select 1 from public.admin_organizations()', 2);
select t_rows('owner is not a member, so sees no game data', 'select 1 from public.games', 0);
select public.admin_set_password('c0000000-0000-0000-0000-000000000000', 'correct-horse-9');
reset role;
select t_rows('owner set carol''s password', $q$select 1 from auth.users where email = 'carol@example.com' and encrypted_password = extensions.crypt('correct-horse-9', encrypted_password)$q$, 1);
set role authenticated;
select t_fail('passwords need 8+ characters', $q$select public.admin_set_password('c0000000-0000-0000-0000-000000000000', 'short')$q$);

-- ===================== Alice runs Org A, Bob runs Org B
select t_as('a0000000-0000-0000-0000-000000000000');
select t_rows('alice is admin of her org', $q$select 1 from public.my_organizations() where role = 'admin'$q$, 1);
update public.organizations set tip_tax_pct = 10, loss_discount_pct = 5 where id = (select v from t_ids where k = 'orgA');
insert into public.players (id, org_id, name) select 'a1000000-0000-0000-0000-000000000000', v, 'Ali' from t_ids where k = 'orgA';
insert into public.games (id, org_id, name) select 'a2000000-0000-0000-0000-000000000000', v, 'Friday' from t_ids where k = 'orgA';
select t_rows('game picked up org house rules', $q$select 1 from public.games where tip_tax_pct = 10 and loss_discount_pct = 5$q$, 1);
insert into public.partners (id, org_id, name, share_pct) select 'a3000000-0000-0000-0000-000000000000', v, 'Alice', 100 from t_ids where k = 'orgA';
insert into public.transactions (org_id, game_id, player_id, kind, amount)
  values ('b9999999-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'buy_in', 1000);
select t_rows('child org_id forced from parent', $q$select 1 from public.transactions t join t_ids i on i.k = 'orgA' where t.org_id = i.v$q$, 1);

select t_as('b0000000-0000-0000-0000-000000000000');
insert into public.players (id, org_id, name) select 'b1000000-0000-0000-0000-000000000000', v, 'Ali' from t_ids where k = 'orgB';
insert into public.games (id, org_id, name) select 'b2000000-0000-0000-0000-000000000000', v, 'Bob game' from t_ids where k = 'orgB';
select t_rows('bob sees only his org', 'select 1 from public.organizations', 1);
select t_rows('bob cannot see alice transactions', 'select 1 from public.transactions', 0);
select t_rows('bob cannot see alice history', $q$select 1 from public.audit_log a join t_ids i on i.k = 'orgA' where a.org_id = i.v$q$, 0);
select t_rows('bob cannot see alice profile', $q$select 1 from public.profiles where id = 'a0000000-0000-0000-0000-000000000000'$q$, 0);
select t_fail('bob cannot add a player to alice org', $q$insert into public.players (org_id, name) select v, 'X' from t_ids where k = 'orgA'$q$);
select t_fail('bob cannot add himself to alice org', $q$select public.add_member((select v from t_ids where k = 'orgA'), 'bob@example.com', 'admin')$q$);
select t_fail('bob cannot insert a membership directly', $q$insert into public.memberships (org_id, user_id) select v, 'b0000000-0000-0000-0000-000000000000' from t_ids where k = 'orgA'$q$);
update public.games set name = 'hacked' where id = 'a2000000-0000-0000-0000-000000000000';
update public.players set org_id = (select v from t_ids where k = 'orgA') where id = 'b1000000-0000-0000-0000-000000000000';
select t_rows('bob player stayed in his org', $q$select 1 from public.players p join t_ids i on i.k = 'orgB' where p.org_id = i.v$q$, 1);

-- ===================== Org admin adds members by email (approved accounts only)
select t_as('a0000000-0000-0000-0000-000000000000');
select t_rows('alice game untouched', $q$select 1 from public.games where name = 'Friday'$q$, 1);
select t_fail('cannot add an unapproved account', $q$select public.add_member((select v from t_ids where k = 'orgA'), 'stranger@example.com')$q$);
select t_fail('cannot add an unknown email', $q$select public.add_member((select v from t_ids where k = 'orgA'), 'nobody@example.com')$q$);
select t_rows('alice adds bob as organizer', $q$select public.add_member((select v from t_ids where k = 'orgA'), 'BOB@example.com', 'organizer')$q$, 1);

select t_as('b0000000-0000-0000-0000-000000000000');
select t_rows('bob now in two orgs', 'select 1 from public.my_organizations()', 2);
select t_rows('bob sees alice games now', $q$select 1 from public.games where id = 'a2000000-0000-0000-0000-000000000000'$q$, 1);
select t_rows('bob sees teammate alice profile', $q$select 1 from public.profiles where id = 'a0000000-0000-0000-0000-000000000000'$q$, 1);
select t_fail('organizer cannot add members', $q$select public.add_member((select v from t_ids where k = 'orgA'), 'carol@example.com')$q$);
select t_fail('organizer cannot add partner', $q$insert into public.partners (org_id, name) select v, 'Bob' from t_ids where k = 'orgA'$q$);
select t_fail('organizer cannot pay partners', $q$insert into public.partner_entries (partner_id, kind, amount) values ('a3000000-0000-0000-0000-000000000000', 'payout', 10)$q$);
update public.memberships set role = 'admin' where user_id = 'b0000000-0000-0000-0000-000000000000' and org_id = (select v from t_ids where k = 'orgA');
select t_rows('organizer cannot promote himself', $q$select 1 from public.my_organizations() where role = 'organizer'$q$, 1);
update public.organizations set tip_tax_pct = 99 where id = (select v from t_ids where k = 'orgA');
select t_rows('organizer cannot change house rules', $q$select 1 from public.organizations where tip_tax_pct = 10$q$, 1);
select t_fail('player from org B in an org A game', $q$insert into public.transactions (game_id, player_id, kind, amount) values ('a2000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'buy_in', 5)$q$);
insert into public.transactions (game_id, player_id, kind, amount) values ('a2000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'cash_out', 1400);
insert into public.dealer_tips (game_id, dealer_name, amount) values ('a2000000-0000-0000-0000-000000000000', 'Marco', 100);
insert into public.expenses (game_id, category, amount, paid_by, partner_id) values ('a2000000-0000-0000-0000-000000000000', 'food', 50, 'x', 'a3000000-0000-0000-0000-000000000000');
select t_rows('expense paid_by synced', $q$select 1 from public.expenses where paid_by = 'Alice'$q$, 1);
select t_fail('org B partner on an org A expense', $q$insert into public.expenses (game_id, category, amount, partner_id) select 'b2000000-0000-0000-0000-000000000000', 'food', 5, 'a3000000-0000-0000-0000-000000000000'$q$);
update public.games set status = 'closed' where id = 'a2000000-0000-0000-0000-000000000000';
select t_rows('totals with tip tax', $q$select 1 from public.game_totals where id = 'a2000000-0000-0000-0000-000000000000' and tip_tax = 10 and net_profit = -540$q$, 1);
select t_rows('partner share posted on close', $q$select 1 from public.partner_shares where amount = -540 and share_pct = 100$q$, 1);
select t_fail('closed game locked', $q$insert into public.transactions (game_id, player_id, kind, amount) values ('a2000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'buy_in', 5)$q$);
update public.games set status = 'open' where id = 'a2000000-0000-0000-0000-000000000000';
select t_rows('organizer cannot reopen', $q$select 1 from public.games where id = 'a2000000-0000-0000-0000-000000000000' and status = 'closed'$q$, 1);
select t_fail('organizer cannot write history', $q$insert into public.audit_log (table_name, action) values ('x', 'INSERT')$q$);
select t_fail('organizer cannot edit history', $q$update public.audit_log set actor_email = 'x'$q$);
select t_fail('organizer cannot write shares', $q$insert into public.partner_shares (org_id, game_id, partner_id, share_pct, game_profit, amount) select v, 'a2000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', 1, 1, 1 from t_ids where k = 'orgA'$q$);
select t_fail('cannot change own profile email', $q$update public.profiles set email = 'x@y.z' where id = 'b0000000-0000-0000-0000-000000000000'$q$);
update public.profiles set display_name = 'Bobby' where id = 'b0000000-0000-0000-0000-000000000000';
update public.profiles set display_name = 'pwned' where id = 'a0000000-0000-0000-0000-000000000000';
select t_rows('edit own profile name only', $q$select 1 from public.profiles where display_name in ('Bobby', 'Alice')$q$, 2);

-- ===================== Admin powers, last admin, leaving
select t_as('a0000000-0000-0000-0000-000000000000');
select t_fail('cannot demote the last admin', $q$update public.memberships set role = 'organizer' where user_id = 'a0000000-0000-0000-0000-000000000000'$q$);
select t_fail('last admin cannot leave', $q$delete from public.memberships where user_id = 'a0000000-0000-0000-0000-000000000000'$q$);
update public.memberships set active = false where user_id = 'b0000000-0000-0000-0000-000000000000' and org_id = (select v from t_ids where k = 'orgA');
update public.games set status = 'open' where id = 'a2000000-0000-0000-0000-000000000000';
select t_rows('admin reopened, shares reversed', 'select 1 from public.partner_shares', 0);

select t_as('b0000000-0000-0000-0000-000000000000');
select t_rows('paused member loses access to that org', $q$select 1 from public.games where id = 'a2000000-0000-0000-0000-000000000000'$q$, 0);
select t_rows('paused member keeps his own org', $q$select 1 from public.games where id = 'b2000000-0000-0000-0000-000000000000'$q$, 1);
delete from public.memberships where user_id = 'b0000000-0000-0000-0000-000000000000' and org_id = (select v from t_ids where k = 'orgA');
select t_rows('member can leave', 'select 1 from public.my_organizations()', 1);

-- ===================== Owner can step in anywhere; un-approving cuts access
select t_as('00000000-0000-0000-0000-0000000000ff');
select t_rows('owner adds carol to org A', $q$select public.add_member((select v from t_ids where k = 'orgA'), 'carol@example.com', 'admin')$q$, 1);
update public.memberships set role = 'organizer' where user_id = 'c0000000-0000-0000-0000-000000000000';
select t_rows('owner changed carol role', $q$select 1 from public.memberships where user_id = 'c0000000-0000-0000-0000-000000000000' and role = 'organizer'$q$, 1);
select t_fail('owner account cannot be un-approved', $q$select public.admin_set_approved('00000000-0000-0000-0000-0000000000ff', false)$q$);
select public.admin_set_approved('c0000000-0000-0000-0000-000000000000', false);
select t_as('c0000000-0000-0000-0000-000000000000');
select t_rows('un-approved carol loses access', 'select 1 from public.games', 0);

-- ===================== Strangers and signed-out visitors
select t_as('e0000000-0000-0000-0000-000000000000');
select t_rows('stranger sees no orgs', 'select 1 from public.organizations', 0);
select t_rows('stranger sees no players', 'select 1 from public.players', 0);
select t_rows('stranger sees no profiles but own', 'select 1 from public.profiles', 1);
reset request.jwt.claims;
set role anon;
select t_fail('anon: players', 'select * from public.players');
select t_fail('anon: organizations', 'select * from public.organizations');
select t_fail('anon: audit', 'select * from public.audit_log');
select t_fail('anon: create org', $q$select public.create_organization('x')$q$);
select t_fail('anon: add member', $q$select public.add_member('a0000000-0000-0000-0000-000000000000', 'x')$q$);
select t_fail('anon: admin accounts', 'select * from public.admin_accounts()');
reset role;

-- ===================== History is complete and attributed
select t_rows('history: org scoped, with actor', $q$select 1 from public.audit_log a join t_ids i on i.k = 'orgA' where a.org_id = i.v and a.table_name = 'transactions' and a.actor_email = 'bob@example.com'$q$, 1);
select t_rows('history: membership changes logged', $q$select 1 from public.audit_log a join t_ids i on i.k = 'orgA' where a.org_id = i.v and a.table_name = 'memberships'$q$, 7);
