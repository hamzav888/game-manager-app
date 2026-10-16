-- =====================================================================
-- Poker Ledger — upgrade 4: usernames, dealer accounts, owner-only history
--
-- Run this ONCE in Supabase → SQL Editor, after the first three files.
-- Existing games, players, partners and history are kept.
--
--  * Sign-in is by USERNAME, not email. The app owner signs in as "avayani";
--    everyone else gets a username from their old email (shown in Admin).
--    Passwords keep working and can be any length.
--  * Only the owner can create accounts — now done inside the database,
--    so Supabase's "Allow new users to sign up" can (and should) be OFF.
--  * Every dealer has an account and a ledger, like players and partners.
--  * The history records everything — including account changes, password
--    changes (never the password) and sign-ins — and ONLY the owner can
--    read it. Nobody can edit or delete it, from the app or the API.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dealer_tips' and column_name = 'rake'
  ) then
    raise exception 'Run 20261015000000_rake_and_discounts.sql first, then this file.';
  end if;
  if to_regclass('public.dealers') is not null then
    raise exception 'The usernames, dealers & history upgrade (20261016000000_usernames_dealers_history.sql) is already installed, so there is nothing to do. You are up to date.';
  end if;
end $$;

-- =====================================================================
-- 1. Usernames
-- =====================================================================

-- Supabase Auth still needs an email address behind the scenes, so each
-- username signs in as <username>@poker-ledger.invalid. ".invalid" is a
-- reserved domain that can never receive mail; nobody types or sees it.
create or replace function public.login_email(p_username text)
returns text language sql immutable set search_path = ''
as $$ select lower(trim(p_username)) || '@poker-ledger.invalid' $$;

alter table public.profiles
  add column username text check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{0,31}$');
create unique index profiles_username_unique on public.profiles (username);

-- A free username based on p_base: "jordan", then "jordan2", "jordan3"…
create or replace function public.free_username(p_base text)
returns text language plpgsql stable set search_path = ''
as $$
declare
  v_base text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9._-]', '', 'g'), 28);
  v_try  text;
  n      int := 1;
begin
  v_base := regexp_replace(v_base, '^[._-]+', '');
  if v_base = '' then
    v_base := 'user';
  end if;
  v_try := v_base;
  while exists (select 1 from public.profiles where username = v_try) loop
    n := n + 1;
    v_try := v_base || n;
  end loop;
  return v_try;
end;
$$;

-- The owner is "avayani"; everyone else gets a username from their email.
update public.profiles set username = 'avayani'
 where id = (select a.user_id from public.app_admins a order by a.created_at limit 1);
do $$
declare
  r record;
begin
  for r in
    select p.id, p.email from public.profiles p join auth.users u on u.id = p.id
    where p.username is null order by u.created_at
  loop
    update public.profiles set username = public.free_username(split_part(coalesce(r.email, ''), '@', 1)) where id = r.id;
  end loop;
end $$;

-- Password accounts now sign in with their username. The old email is kept
-- in the account's metadata (original_email), just in case.
update auth.users u
   set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
                            || jsonb_build_object('original_email', u.email, 'username', p.username),
       email = public.login_email(p.username),
       updated_at = now()
  from public.profiles p
 where p.id = u.id
   and exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email')
   and u.email is distinct from public.login_email(p.username);
update auth.identities i
   set identity_data = i.identity_data || jsonb_build_object('email', u.email),
       updated_at = now()
  from auth.users u
 where u.id = i.user_id and i.provider = 'email' and i.identity_data ->> 'email' is distinct from u.email;

-- New accounts: profile + username; the very first account becomes the owner.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_first    boolean := not exists (select 1 from public.app_admins);
  v_username text := coalesce(
    nullif(lower(trim(new.raw_user_meta_data ->> 'username')), ''),
    case when new.email like '%@poker-ledger.invalid' then split_part(new.email, '@', 1) end
  );
begin
  if v_username is null
     or v_username !~ '^[a-z0-9][a-z0-9._-]{0,31}$'
     or exists (select 1 from public.profiles where username = v_username) then
    v_username := public.free_username(coalesce(v_username, split_part(coalesce(new.email, ''), '@', 1)));
  end if;
  insert into public.profiles (id, email, username, display_name, approved, approved_at)
  values (
    new.id,
    lower(new.email),
    v_username,
    nullif(trim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      v_username
    )), ''),
    v_first,
    case when v_first then now() end
  )
  on conflict (id) do nothing;
  if v_first then
    insert into public.app_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 2. The history: complete, append-only, owner-only
-- =====================================================================

alter table public.audit_log add column dealer_id uuid;
create index audit_log_dealer_idx on public.audit_log (dealer_id, id desc);
create index audit_log_actor_idx on public.audit_log (actor_id, id desc);

-- Write one history entry for something that isn't a table row (a password
-- change, a sign-in). Used inside the database only.
create or replace function public.log_event(p_table text, p_record uuid, p_data jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_email, table_name, action, record_id, new_data)
  values (auth.uid(), public.auth_email(), p_table, 'INSERT', p_record::text, p_data)
$$;

create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token' - 'encrypted_password' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token' - 'encrypted_password' end;
  v_row jsonb := coalesce(v_new, v_old);
  v_at  timestamptz := now();
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
    return new;
  end if;
  -- Only a script run by hand in the SQL editor (never the app or the API)
  -- can date an entry, e.g. demo_create.sql's made-up season.
  if session_user not in ('authenticator', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin') then
    v_at := coalesce(nullif(current_setting('poker_ledger.event_time', true), '')::timestamptz, now());
  end if;

  insert into public.audit_log (
    occurred_at, org_id, actor_id, actor_email, table_name, action, record_id,
    game_id, player_id, partner_id, dealer_id, old_data, new_data
  )
  values (
    v_at,
    case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid else (v_row ->> 'org_id')::uuid end,
    auth.uid(),
    public.auth_email(),
    tg_table_name,
    tg_op,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    case when tg_table_name = 'games' then (v_row ->> 'id')::uuid else (v_row ->> 'game_id')::uuid end,
    case when tg_table_name = 'players' then (v_row ->> 'id')::uuid else (v_row ->> 'player_id')::uuid end,
    case when tg_table_name = 'partners' then (v_row ->> 'id')::uuid else (v_row ->> 'partner_id')::uuid end,
    case when tg_table_name = 'dealers' then (v_row ->> 'id')::uuid else (v_row ->> 'dealer_id')::uuid end,
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

-- Nobody can change or delete history: not members, not admins, not the owner.
create or replace function public.audit_log_is_append_only()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'The history can’t be changed or deleted.';
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_is_append_only();

-- Only the app owner can read it.
drop policy "audit_log: read" on public.audit_log;
create policy "audit_log: owner only" on public.audit_log for select to authenticated
  using ((select public.is_app_admin()));

-- Account changes are history too (who created, approved, renamed or blocked whom).
create trigger z_audit after insert or update or delete on public.profiles
  for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.app_admins
  for each row execute function public.log_audit();

-- Every sign-in, with the time. Never blocks a sign-in if logging fails.
create or replace function public.log_sign_in()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
    begin
      insert into public.audit_log (occurred_at, actor_id, actor_email, table_name, action, record_id, new_data)
      values (
        new.last_sign_in_at, new.id, lower(new.email), 'sign_ins', 'INSERT', new.id::text,
        jsonb_build_object('username', (select p.username from public.profiles p where p.id = new.id))
      );
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_signed_in after update of last_sign_in_at on auth.users
  for each row execute function public.log_sign_in();

-- =====================================================================
-- 3. Accounts: only the owner creates them; passwords can be any length
-- =====================================================================

-- Owner only: create a login. Done in the database, so Supabase's public
-- sign-up can stay switched off and nobody else can make accounts.
create or replace function public.admin_create_account(p_username text, p_password text, p_name text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_username text := lower(trim(coalesce(p_username, '')));
  v_email    text;
  v_id       uuid := gen_random_uuid();
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can create accounts.';
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{0,31}$' then
    raise exception 'Usernames are up to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.';
  end if;
  if coalesce(p_password, '') = '' then
    raise exception 'Enter a password.';
  end if;
  v_email := public.login_email(v_username);
  if exists (select 1 from public.profiles where username = v_username)
     or exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'The username % is already taken.', v_username;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('username', v_username, 'display_name', nullif(trim(coalesce(p_name, '')), '')),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now()
  );

  -- handle_new_user() made the profile; accounts the owner makes are approved.
  update public.profiles
     set approved = true, approved_at = now(), approved_by = auth.uid()
   where id = v_id;
  return v_id;
end;
$$;

-- Owner only: change someone's username (their login changes with it).
create or replace function public.admin_set_username(p_user uuid, p_username text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_username text := lower(trim(coalesce(p_username, '')));
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can change usernames.';
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{0,31}$' then
    raise exception 'Usernames are up to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.';
  end if;
  if exists (select 1 from public.profiles where username = v_username and id <> p_user) then
    raise exception 'The username % is already taken.', v_username;
  end if;
  update public.profiles set username = v_username where id = p_user;
  if not found then
    raise exception 'Account not found.';
  end if;
  if exists (select 1 from auth.identities i where i.user_id = p_user and i.provider = 'email') then
    update auth.users set email = public.login_email(v_username), updated_at = now() where id = p_user;
    update auth.identities
       set identity_data = identity_data || jsonb_build_object('email', public.login_email(v_username)), updated_at = now()
     where user_id = p_user and provider = 'email';
  end if;
end;
$$;

-- Owner only: give an account a new password (any length).
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can set passwords.';
  end if;
  if coalesce(p_password, '') = '' then
    raise exception 'Enter a password.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user;
  if not found then
    raise exception 'Account not found.';
  end if;
  perform public.log_event('passwords', p_user, jsonb_build_object(
    'username', (select p.username from public.profiles p where p.id = p_user), 'by', 'owner'));
end;
$$;

-- Anyone: change your own password (any length). Needs the current one.
create or replace function public.change_my_password(p_current text, p_new text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if coalesce(p_new, '') = '' then
    raise exception 'Enter a new password.';
  end if;
  select u.encrypted_password into v_hash from auth.users u where u.id = auth.uid();
  if coalesce(v_hash, '') = '' or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    raise exception 'Your current password isn’t right.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = auth.uid();
  perform public.log_event('passwords', auth.uid(), jsonb_build_object(
    'username', (select p.username from public.profiles p where p.id = auth.uid()), 'by', 'self'));
end;
$$;

-- Who am I (now with my username).
drop function public.whoami();
create function public.whoami()
returns table (is_owner boolean, approved boolean, username text)
language sql stable security definer set search_path = ''
as $$
  select public.is_app_admin(),
         coalesce((select p.approved from public.profiles p where p.id = auth.uid()), false),
         (select p.username from public.profiles p where p.id = auth.uid())
$$;

-- Organization admins (or the owner): add an approved account by username.
drop function public.add_member(uuid, text, text);
create function public.add_member(p_org uuid, p_login text, p_role text default 'organizer')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_login text := lower(trim(coalesce(p_login, '')));
  v_user  uuid;
begin
  if not (public.is_app_admin() or p_org in (select public.my_admin_org_ids())) then
    raise exception 'Only admins of this organization can add members.';
  end if;
  if p_role not in ('admin', 'organizer') then
    raise exception 'Role must be admin or organizer.';
  end if;
  select p.id into v_user from public.profiles p
   where (p.username = ltrim(v_login, '@') or p.email = v_login) and p.approved;
  if v_user is null then
    raise exception 'No account is called %. Ask the app owner to create it first.', v_login;
  end if;
  insert into public.memberships (org_id, user_id, role)
  values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role, active = true;
  return v_user;
end;
$$;

-- Owner: every account, with its username and organizations.
drop function public.admin_accounts();
create function public.admin_accounts()
returns table (
  id uuid, username text, email text, display_name text, approved boolean, is_owner boolean,
  created_at timestamptz, last_sign_in_at timestamptz, organizations text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can see all accounts.';
  end if;
  return query
  select p.id, p.username, p.email, p.display_name, p.approved,
         exists (select 1 from public.app_admins a where a.user_id = p.id),
         u.created_at, u.last_sign_in_at,
         (select string_agg(o.name || case when m.role = 'admin' then ' (admin)' else '' end, ', ' order by o.name)
            from public.memberships m join public.organizations o on o.id = m.org_id
           where m.user_id = p.id and m.active)
  from public.profiles p join auth.users u on u.id = p.id
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_organizations()
returns table (id uuid, name text, created_at timestamptz, members bigint, admins text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can see all organizations.';
  end if;
  return query
  select o.id, o.name, o.created_at,
         (select count(*) from public.memberships m where m.org_id = o.id and m.active),
         (select string_agg(coalesce(p.display_name, p.username), ', ' order by p.display_name)
            from public.memberships m join public.profiles p on p.id = m.user_id
           where m.org_id = o.id and m.role = 'admin' and m.active)
  from public.organizations o
  order by o.created_at desc;
end;
$$;

-- Owner only: names behind the ids in the history, across every organization
-- (the owner isn't necessarily a member, so can't read these tables directly).
create or replace function public.admin_names()
returns table (kind text, id uuid, name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can read the history.';
  end if;
  return query
            select 'org'::text, o.id, o.name from public.organizations o
  union all select 'player', p.id, p.name from public.players p
  union all select 'game', g.id, g.name || ' · ' || to_char(g.game_date, 'Mon FMDD') from public.games g
  union all select 'partner', p.id, p.name from public.partners p
  union all select 'dealer', d.id, d.name from public.dealers d
  union all select 'account', p.id, coalesce(p.display_name, p.username) from public.profiles p;
end;
$$;

-- =====================================================================
-- 4. Dealer accounts
-- =====================================================================
create table public.dealers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  phone       text check (phone is null or length(phone) <= 30),
  notes       text check (notes is null or length(notes) <= 500),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create unique index dealers_name_unique on public.dealers (org_id, lower(trim(name)));

-- Every dealer who has already reported a round gets an account.
insert into public.dealers (org_id, name, created_at)
select distinct on (t.org_id, lower(trim(t.dealer_name))) t.org_id, trim(t.dealer_name), t.created_at
from public.dealer_tips t
order by t.org_id, lower(trim(t.dealer_name)), t.created_at;

-- Rounds point at the dealer's account; tips can be paid on the spot or owed.
alter table public.dealer_tips
  add column dealer_id uuid references public.dealers (id) on delete restrict,
  add column method text not null default 'cash' check (method in ('cash', 'transfer', 'account'));
alter table public.dealer_tips disable trigger user;
update public.dealer_tips t set dealer_id = d.id
  from public.dealers d
 where d.org_id = t.org_id and lower(trim(d.name)) = lower(trim(t.dealer_name));
alter table public.dealer_tips enable trigger user;
alter table public.dealer_tips alter column dealer_id set not null;
create index dealer_tips_dealer_idx on public.dealer_tips (dealer_id, created_at);

-- Dealer pay (an expense) can name the dealer it went to.
alter table public.expenses add column dealer_id uuid references public.dealers (id) on delete restrict;
create index expenses_dealer_idx on public.expenses (dealer_id) where dealer_id is not null;

-- Money paid to (or received from) a dealer outside a round.
create table public.dealer_payments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  dealer_id   uuid not null references public.dealers (id) on delete restrict,
  -- to_dealer: the house paid the dealer · from_dealer: the dealer paid the house
  direction   text not null check (direction in ('to_dealer', 'from_dealer')),
  amount      numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  method      text not null default 'cash' check (method in ('cash', 'transfer')),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create index dealer_payments_dealer_idx on public.dealer_payments (dealer_id, created_at desc);

-- Child rows take their org from their parent; references stay inside the org.
create or replace function public.scope_row()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
begin
  case tg_table_name
    when 'transactions', 'dealer_tips', 'expenses' then
      select g.org_id into v_org from public.games g where g.id = new.game_id;
    when 'player_payments' then
      select p.org_id into v_org from public.players p where p.id = new.player_id;
    when 'partner_entries' then
      select p.org_id into v_org from public.partners p where p.id = new.partner_id;
    when 'dealer_payments' then
      select d.org_id into v_org from public.dealers d where d.id = new.dealer_id;
    else
      -- top-level rows keep the org they were created in
      if tg_op = 'UPDATE' then v_org := old.org_id; else v_org := new.org_id; end if;
  end case;
  if v_org is null then
    raise exception 'Unknown organization.';
  end if;
  new.org_id := v_org;

  if tg_table_name = 'transactions' then
    if not exists (select 1 from public.players p where p.id = new.player_id and p.org_id = v_org) then
      raise exception 'That player belongs to a different organization.';
    end if;
  elsif tg_table_name = 'expenses' then
    if new.partner_id is not null and not exists (select 1 from public.partners p where p.id = new.partner_id and p.org_id = v_org) then
      raise exception 'That partner belongs to a different organization.';
    end if;
    if new.dealer_id is not null and not exists (select 1 from public.dealers d where d.id = new.dealer_id and d.org_id = v_org) then
      raise exception 'That dealer belongs to a different organization.';
    end if;
  elsif tg_table_name = 'dealer_tips' then
    if new.dealer_id is not null and not exists (select 1 from public.dealers d where d.id = new.dealer_id and d.org_id = v_org) then
      raise exception 'That dealer belongs to a different organization.';
    end if;
  end if;
  return new;
end;
$$;

-- A round names its dealer by account or just by name; a new name opens an account.
create or replace function public.round_dealer()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if new.dealer_id is null then
    v_name := trim(coalesce(new.dealer_name, ''));
    if v_name = '' then
      raise exception 'Choose the dealer for this round.';
    end if;
    select d.id into new.dealer_id from public.dealers d
     where d.org_id = new.org_id and lower(trim(d.name)) = lower(v_name);
    if new.dealer_id is null then
      insert into public.dealers (org_id, name) values (new.org_id, v_name) returning id into new.dealer_id;
    end if;
  end if;
  select d.name into new.dealer_name from public.dealers d where d.id = new.dealer_id;
  return new;
end;
$$;

create trigger a_scope before insert or update on public.dealers for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.dealer_payments for each row execute function public.scope_row();
create trigger b_stamp before insert or update on public.dealers for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.dealer_payments for each row execute function public.stamp_row();
create trigger c_round_dealer before insert or update on public.dealer_tips for each row execute function public.round_dealer();
create trigger z_audit after insert or update or delete on public.dealers for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.dealer_payments for each row execute function public.log_audit();

alter table public.dealers         enable row level security;
alter table public.dealer_payments enable row level security;

create policy "dealers: members read" on public.dealers for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "dealers: members add" on public.dealers for insert to authenticated with check (org_id in (select public.my_org_ids()));
create policy "dealers: members edit" on public.dealers for update to authenticated
  using (org_id in (select public.my_org_ids())) with check (org_id in (select public.my_org_ids()));
create policy "dealers: admins delete" on public.dealers for delete to authenticated using (org_id in (select public.my_admin_org_ids()));

create policy "dealer_payments: read" on public.dealer_payments for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "dealer_payments: add" on public.dealer_payments for insert to authenticated with check (org_id in (select public.my_org_ids()));
create policy "dealer_payments: edit" on public.dealer_payments for update to authenticated
  using (org_id in (select public.my_org_ids())) with check (org_id in (select public.my_org_ids()));
create policy "dealer_payments: delete" on public.dealer_payments for delete to authenticated using (org_id in (select public.my_org_ids()));

-- balance: positive = the house owes the dealer
create view public.dealer_accounts with (security_invoker = true) as
select
  d.id, d.org_id, d.name, d.phone, d.notes, d.active, d.created_at,
  coalesce(r.rounds, 0)                       as rounds,
  coalesce(r.games, 0)                        as games,
  coalesce(r.rake, 0)                         as total_rake,
  coalesce(r.tips, 0)                         as total_tips,
  coalesce(r.tip_tax, 0)                      as tip_tax,
  coalesce(r.tips, 0) - coalesce(r.tip_tax, 0) as net_tips,
  coalesce(x.pay, 0)                          as dealer_pay,
  r.last_dealt,
  coalesce(r.on_account, 0) + coalesce(p.settled, 0) as balance
from public.dealers d
left join (
  select t.dealer_id,
         count(*)                                                        as rounds,
         count(distinct t.game_id)                                       as games,
         sum(t.rake)                                                     as rake,
         sum(t.amount)                                                   as tips,
         sum(round(t.amount * g.tip_tax_pct / 100, 2))                   as tip_tax,
         sum(t.amount - round(t.amount * g.tip_tax_pct / 100, 2)) filter (where t.method = 'account') as on_account,
         max(g.game_date)                                                as last_dealt
  from public.dealer_tips t join public.games g on g.id = t.game_id
  group by t.dealer_id
) r on r.dealer_id = d.id
left join (select dealer_id, sum(amount) as pay from public.expenses where dealer_id is not null group by dealer_id) x on x.dealer_id = d.id
left join (
  select dealer_id, sum(case when direction = 'from_dealer' then amount else -amount end) as settled
  from public.dealer_payments group by dealer_id
) p on p.dealer_id = d.id;

-- Partner shares are dated when the game ended.
create or replace function public.post_partner_shares()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profit numeric(12, 2);
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    select gt.net_profit into v_profit from public.game_totals gt where gt.id = new.id;
    insert into public.partner_shares (org_id, game_id, partner_id, share_pct, game_profit, amount, created_at)
    select new.org_id, new.id, p.id, p.share_pct, coalesce(v_profit, 0), round(coalesce(v_profit, 0) * p.share_pct / 100, 2),
           coalesce(new.closed_at, now())
    from public.partners p
    where p.org_id = new.org_id and p.active and p.share_pct > 0;
  elsif new.status = 'open' and old.status = 'closed' then
    delete from public.partner_shares where game_id = new.id;
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 5. Privileges and live updates
-- =====================================================================
revoke all on public.dealers, public.dealer_payments, public.dealer_accounts from anon;
revoke truncate on public.dealers, public.dealer_payments from authenticated;
revoke insert, update, delete, truncate on public.dealer_accounts from authenticated;

revoke execute on all functions in schema public from anon, public;
-- internal helpers: never callable from the app
revoke execute on function
  public.login_email(text), public.free_username(text), public.log_event(text, uuid, jsonb)
  from authenticated;
grant execute on function
  public.whoami(), public.add_member(uuid, text, text), public.admin_accounts(), public.admin_organizations(),
  public.admin_create_account(text, text, text), public.admin_set_username(uuid, text),
  public.admin_set_password(uuid, text), public.change_my_password(text, text), public.admin_names()
  to authenticated;

alter publication supabase_realtime add table public.dealers, public.dealer_payments;
