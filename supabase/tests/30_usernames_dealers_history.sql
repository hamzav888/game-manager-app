-- Usernames, owner-only accounts, the append-only owner-only history and
-- dealer accounts. Runs after 10_ and 20_ in the same throwaway database.
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;

-- ===================== Usernames: only the owner creates accounts
select t_as('00000000-0000-0000-0000-0000000000ff');
select t_rows('owner creates an account by username', $q$select public.admin_create_account('Dealer.Dan', 'x', 'Dan')$q$, 1);
select t_rows('username saved lowercase, approved', $q$select 1 from public.profiles where username = 'dealer.dan' and approved and display_name = 'Dan'$q$, 1);
select t_fail('usernames are unique', $q$select public.admin_create_account('DEALER.dan', 'y')$q$);
select t_fail('usernames have a simple format', $q$select public.admin_create_account('two words', 'y')$q$);
select t_fail('a password is still needed', $q$select public.admin_create_account('newbie', '')$q$);
insert into public.t_ids values ('tiny', public.admin_create_account('tiny', 'a'));
select t_rows('one-letter passwords are fine', $q$select 1 from public.profiles where username = 'tiny'$q$, 1);
select public.admin_set_username((select v from t_ids where k = 'tiny'), 'tiny2');
reset role;
select t_rows('sign-in address follows the username',
  $q$select 1 from auth.users u join auth.identities i on i.user_id = u.id and i.provider = 'email'
     where u.email = 'tiny2@poker-ledger.invalid' and i.email = u.email and u.email_confirmed_at is not null$q$, 1);
select t_rows('password stored as a bcrypt hash',
  $q$select 1 from auth.users where email = 'dealer.dan@poker-ledger.invalid' and encrypted_password like '$2%' and encrypted_password = extensions.crypt('x', encrypted_password)$q$, 1);
select t_rows('Supabase token columns are blank, not null',
  $q$select 1 from auth.users where email = 'dealer.dan@poker-ledger.invalid'
     and confirmation_token = '' and recovery_token = '' and email_change = '' and email_change_token_new = '' and aud = 'authenticated'$q$, 1);
set role authenticated;

select t_as('a0000000-0000-0000-0000-000000000000');
select t_fail('an org admin cannot create accounts', $q$select public.admin_create_account('sneaky', 'pw')$q$);
select t_fail('an org admin cannot rename logins', $q$select public.admin_set_username('a0000000-0000-0000-0000-000000000000', 'boss')$q$);
select t_fail('an org admin cannot set passwords', $q$select public.admin_set_password('b0000000-0000-0000-0000-000000000000', 'pw')$q$);
select t_fail('nobody can make themselves owner', $q$insert into public.app_admins values ('a0000000-0000-0000-0000-000000000000')$q$);
select t_fail('nobody can pick their own username', $q$update public.profiles set username = 'boss' where id = 'a0000000-0000-0000-0000-000000000000'$q$);
select t_rows('an org admin adds a member by username', $q$select public.add_member((select v from t_ids where k = 'orgA'), '@Dealer.Dan', 'organizer')$q$, 1);
select t_rows('whoami includes the username', $q$select 1 from public.whoami() where username = 'alice' and not is_owner$q$, 1);

select t_as((select v::text from t_ids where k = 'tiny'));
select t_fail('changing your password needs the current one', $q$select public.change_my_password('wrong', 'b')$q$);
select public.change_my_password('a', 'b');
reset role;
select t_rows('own password changed', $q$select 1 from auth.users where email = 'tiny2@poker-ledger.invalid' and encrypted_password = extensions.crypt('b', encrypted_password)$q$, 1);
set role authenticated;

-- ===================== History: everything recorded, owner-only, append-only
select t_as('a0000000-0000-0000-0000-000000000000');
select t_rows('members cannot read the history', 'select 1 from public.audit_log', 0);
select t_fail('members cannot add to the history', $q$insert into public.audit_log (table_name, action) values ('x', 'INSERT')$q$);
select t_as('00000000-0000-0000-0000-0000000000ff');
select t_rows('the owner reads the history', 'select 1 from public.audit_log limit 1', 1);
select t_fail('the owner cannot edit the history', $q$update public.audit_log set actor_email = 'x'$q$);
select t_fail('the owner cannot delete the history', $q$delete from public.audit_log$q$);
reset role;
select t_fail('not even the database can edit history', $q$update public.audit_log set actor_email = 'x'$q$);
select t_fail('not even the database can delete history', $q$delete from public.audit_log$q$);
select t_fail('not even the database can wipe history', $q$truncate public.audit_log$q$);
select t_rows('account creation recorded, by the owner',
  $q$select 1 from public.audit_log where table_name = 'profiles' and action = 'INSERT' and new_data ->> 'username' = 'dealer.dan'
     and actor_id = '00000000-0000-0000-0000-0000000000ff'$q$, 1);
select t_rows('username change recorded',
  $q$select 1 from public.audit_log where table_name = 'profiles' and action = 'UPDATE' and old_data ->> 'username' = 'tiny' and new_data ->> 'username' = 'tiny2'$q$, 1);
select t_rows('password changes recorded, never the password',
  $q$select 1 from public.audit_log where table_name = 'passwords' and new_data ->> 'by' = 'self' and new_data::text not like '%$2%'$q$, 1);
select t_rows('no history entry holds a password hash',
  $q$select 1 from public.audit_log where coalesce(new_data, old_data)::text like '%encrypted_password%'$q$, 0);
update auth.users set last_sign_in_at = now() where email = 'alice@example.com';
select t_rows('every sign-in is recorded', $q$select 1 from public.audit_log where table_name = 'sign_ins' and actor_email = 'alice@example.com'$q$, 1);
set role authenticated;

-- ===================== Dealer accounts
select t_as('a0000000-0000-0000-0000-000000000000');
insert into public.games (id, org_id, name) select 'a2200000-0000-0000-0000-000000000000', v, 'Dealer night' from t_ids where k = 'orgA';
insert into public.dealer_tips (game_id, dealer_name, amount, rake, method) values ('a2200000-0000-0000-0000-000000000000', 'Nina', 50, 100, 'account');
select t_rows('a new dealer name opens a dealer account', $q$select 1 from public.dealers where name = 'Nina'$q$, 1);
insert into public.dealer_tips (game_id, dealer_name, amount, rake) values ('a2200000-0000-0000-0000-000000000000', ' nina ', 30, 80);
select t_rows('same dealer, any spelling', $q$select 1 from public.dealers where lower(name) = 'nina'$q$, 1);
insert into public.t_ids select 'nina', id from public.dealers where name = 'Nina';
select t_rows('rounds point at the account', $q$select 1 from public.dealer_tips where dealer_id = (select v from t_ids where k = 'nina') and dealer_name = 'Nina'$q$, 2);
-- tip tax 10%: the on-account round leaves 50 − 5 = 45 owed; the cash round is settled
select t_rows('dealer account: rounds, rake, tips, balance',
  $q$select 1 from public.dealer_accounts where name = 'Nina' and rounds = 2 and games = 1 and total_rake = 180
     and total_tips = 80 and tip_tax = 8 and net_tips = 72 and balance = 45$q$, 1);
insert into public.dealer_payments (dealer_id, direction, amount) select v, 'to_dealer', 45 from t_ids where k = 'nina';
insert into public.expenses (game_id, category, amount, dealer_id) select 'a2200000-0000-0000-0000-000000000000', 'dealer_pay', 150, v from t_ids where k = 'nina';
select t_rows('paying the dealer settles the account; dealer pay shows on it',
  $q$select 1 from public.dealer_accounts where name = 'Nina' and balance = 0 and dealer_pay = 150$q$, 1);
select t_fail('dealers with rounds can''t be deleted', $q$delete from public.dealers where name = 'Nina'$q$);

select t_as('b0000000-0000-0000-0000-000000000000');
select t_rows('other org: no dealers', 'select 1 from public.dealers', 0);
select t_rows('other org: no dealer accounts', 'select 1 from public.dealer_accounts', 0);
select t_fail('other org dealer on a round', $q$insert into public.dealer_tips (game_id, dealer_id, rake) select 'b2000000-0000-0000-0000-000000000000', v, 10 from t_ids where k = 'nina'$q$);
select t_fail('other org dealer on an expense', $q$insert into public.expenses (game_id, category, amount, dealer_id) select 'b2000000-0000-0000-0000-000000000000', 'dealer_pay', 10, v from t_ids where k = 'nina'$q$);
select t_fail('cannot pay another org''s dealer', $q$insert into public.dealer_payments (dealer_id, direction, amount) select v, 'from_dealer', 10 from t_ids where k = 'nina'$q$);
select t_fail('only the owner gets the history''s names', 'select * from public.admin_names()');
select t_as('00000000-0000-0000-0000-0000000000ff');
select t_rows('the owner gets names across organizations', $q$select 1 from public.admin_names() where kind = 'dealer' and name = 'Nina'$q$, 1);
reset role;
select t_rows('dealer accounts and payments are in the history',
  $q$select 1 from public.audit_log where table_name in ('dealers', 'dealer_payments') and dealer_id = (select v from t_ids where k = 'nina')$q$, 2);

reset request.jwt.claims;
set role anon;
select t_fail('anon: dealers', 'select * from public.dealers');
select t_fail('anon: dealer accounts', 'select * from public.dealer_accounts');
select t_fail('anon: create an account', $q$select public.admin_create_account('x', 'y')$q$);
select t_fail('anon: change a password', $q$select public.change_my_password('x', 'y')$q$);
reset role;
