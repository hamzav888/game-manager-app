-- =====================================================================
-- Poker Ledger — complete database schema (organizations edition)
--
-- Run this ONE file in Supabase → SQL Editor on a fresh project.
--
-- Model
--   * Anyone can create an account (email + password, or Google).
--   * An account can create organizations and be a member of several.
--   * Every game, player, partner, ledger entry and history row belongs to
--     exactly one organization. Members only ever see their own
--     organizations' data — enforced here with Row Level Security, not in
--     the app.
--   * Admins bring people in with invite links (optionally locked to an
--     email address), manage members, partners and house rules.
--   * Every insert/update/delete is written to an append-only audit log.
-- =====================================================================

-- Stop early with a clear message if this project isn't empty.
do $$
begin
  if to_regclass('public.organizations') is not null and to_regclass('public.profiles') is not null then
    raise exception 'Poker Ledger is already installed in this project, so there is nothing to do. (Did you click Run twice?)';
  end if;
  if to_regclass('public.profiles') is not null then
    raise exception 'This project already has a "profiles" table (often from a Supabase starter template). Use a fresh project, or see SETUP.md > Troubleshooting.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text check (display_name is null or length(display_name) <= 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

-- Create a profile for every new account (any sign-in method).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    nullif(trim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the profile email in sync when an account changes email.
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- The signed-in account's email (for the audit log).
create or replace function public.auth_email()
returns text language sql stable security definer set search_path = ''
as $$ select lower(u.email) from auth.users u where u.id = auth.uid() $$;

-- The signed-in account's email, only if verified (for matching invites).
create or replace function public.verified_email()
returns text language sql stable security definer set search_path = ''
as $$ select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null $$;

-- ---------------------------------------------------------------------
-- Organizations, members, invitations
-- ---------------------------------------------------------------------
create table public.organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(trim(name)) between 1 and 80),
  -- house rules: copied onto each new game
  tip_tax_pct       numeric(5, 2) not null default 0 check (tip_tax_pct between 0 and 100),
  loss_discount_pct numeric(5, 2) not null default 0 check (loss_discount_pct between 0 and 100),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz,
  updated_by        uuid
);

create table public.memberships (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'organizer' check (role in ('admin', 'organizer')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz,
  updated_by uuid,
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  org_name    text,
  -- when set, only an account with this verified email can accept
  email       text check (email is null or (email = lower(trim(email)) and email like '%@%')),
  role        text not null default 'organizer' check (role in ('admin', 'organizer')),
  token       text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid
);
create index invitations_org_idx on public.invitations (org_id);
create index invitations_email_idx on public.invitations (email) where accepted_at is null;

-- Orgs the signed-in account is an active member / admin of.
create or replace function public.my_org_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$ select m.org_id from public.memberships m where m.user_id = auth.uid() and m.active $$;

create or replace function public.my_admin_org_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$ select m.org_id from public.memberships m where m.user_id = auth.uid() and m.active and m.role = 'admin' $$;

-- ---------------------------------------------------------------------
-- Game data (every row carries org_id)
-- ---------------------------------------------------------------------
create table public.players (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  phone       text check (phone is null or length(phone) <= 30),
  notes       text check (notes is null or length(notes) <= 500),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create unique index players_name_unique on public.players (org_id, lower(trim(name)));

create table public.games (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (length(trim(name)) between 1 and 80),
  game_date         date not null default current_date,
  status            text not null default 'open' check (status in ('open', 'closed')),
  notes             text check (notes is null or length(notes) <= 1000),
  -- filled from the organization's house rules when left empty
  tip_tax_pct       numeric(5, 2) not null check (tip_tax_pct between 0 and 100),
  loss_discount_pct numeric(5, 2) not null check (loss_discount_pct between 0 and 100),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz,
  updated_by        uuid,
  closed_at         timestamptz,
  closed_by         uuid
);
create index games_org_date_idx on public.games (org_id, game_date desc, created_at desc);

create table public.partners (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  email       text check (email is null or (email = lower(trim(email)) and email like '%@%')),
  share_pct   numeric(5, 2) not null default 0 check (share_pct between 0 and 100),
  active      boolean not null default true,
  notes       text check (notes is null or length(notes) <= 500),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create unique index partners_name_unique on public.partners (org_id, lower(trim(name)));

create table public.transactions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  game_id     uuid not null references public.games (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete restrict,
  kind        text not null check (kind in ('buy_in', 'cash_out', 'discount')),
  -- a cash-out of 0 means the player busted; everything else must be > 0
  amount      numeric(12, 2) not null check (amount >= 0 and amount <= 10000000 and (kind = 'cash_out' or amount > 0)),
  -- 'account' = on credit, settled later through the player's account
  method      text not null default 'cash' check (method in ('cash', 'transfer', 'account', 'other')),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create index transactions_game_idx on public.transactions (game_id, created_at);
create index transactions_player_idx on public.transactions (player_id);
create index transactions_org_idx on public.transactions (org_id);

create table public.dealer_tips (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  game_id     uuid not null references public.games (id) on delete cascade,
  dealer_name text not null check (length(trim(dealer_name)) between 1 and 60),
  amount      numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create index dealer_tips_game_idx on public.dealer_tips (game_id, created_at);

create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  game_id     uuid not null references public.games (id) on delete cascade,
  category    text not null check (category in ('food', 'drinks', 'venue', 'dealer_pay', 'supplies', 'other')),
  description text check (description is null or length(description) <= 200),
  amount      numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  -- the partner who paid out of pocket; null = paid from the game bank
  partner_id  uuid references public.partners (id) on delete restrict,
  paid_by     text not null default 'Game bank' check (length(trim(paid_by)) between 1 and 60),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create index expenses_game_idx on public.expenses (game_id, created_at);
create index expenses_partner_idx on public.expenses (partner_id);

create table public.player_payments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete restrict,
  -- from_player: the player paid the house · to_player: the house paid the player
  direction   text not null check (direction in ('from_player', 'to_player')),
  amount      numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  method      text not null default 'cash' check (method in ('cash', 'transfer')),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create index player_payments_player_idx on public.player_payments (player_id, created_at desc);

create table public.partner_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  partner_id  uuid not null references public.partners (id) on delete restrict,
  -- payout: the business paid the partner · contribution: the partner put money in
  kind        text not null check (kind in ('payout', 'contribution')),
  amount      numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  method      text not null default 'cash' check (method in ('cash', 'transfer')),
  note        text check (note is null or length(note) <= 300),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz,
  updated_by  uuid
);
create index partner_entries_partner_idx on public.partner_entries (partner_id, created_at desc);

-- A partner's cut of one game, posted when the game is closed (never recalculated).
create table public.partner_shares (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  game_id     uuid not null references public.games (id) on delete cascade,
  partner_id  uuid not null references public.partners (id) on delete restrict,
  share_pct   numeric(5, 2) not null check (share_pct between 0 and 100),
  game_profit numeric(12, 2) not null,
  amount      numeric(12, 2) not null,
  created_at  timestamptz not null default now(),
  unique (game_id, partner_id)
);
create index partner_shares_partner_idx on public.partner_shares (partner_id, created_at desc);

-- Append-only history of every change.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  org_id       uuid,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  actor_email  text,
  table_name   text not null,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  record_id    text,
  -- no foreign keys on purpose: history must survive deletes
  game_id      uuid,
  player_id    uuid,
  partner_id   uuid,
  old_data     jsonb,
  new_data     jsonb
);
create index audit_log_org_idx on public.audit_log (org_id, id desc);
create index audit_log_game_idx on public.audit_log (game_id, id desc);
create index audit_log_player_idx on public.audit_log (player_id, id desc);
create index audit_log_partner_idx on public.audit_log (partner_id, id desc);

-- True if the game exists and is still open (closed games are locked).
create or replace function public.game_is_open(gid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.games g where g.id = gid and g.status = 'open') $$;

-- ---------------------------------------------------------------------
-- Triggers: organization scoping, stamps, defaults, audit
-- ---------------------------------------------------------------------

-- Child rows take their org from their parent (the client can't choose it),
-- and every reference must point inside the same organization.
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
  end if;
  return new;
end;
$$;

create or replace function public.stamp_row()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if to_jsonb(new) ? 'created_by' then
      new.created_by := auth.uid();
    end if;
  else
    new.created_at := old.created_at;
    if to_jsonb(new) ? 'created_by' then
      new.created_by := old.created_by;
    end if;
    if to_jsonb(new) ? 'updated_at' then
      new.updated_at := now();
    end if;
    if to_jsonb(new) ? 'updated_by' then
      new.updated_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

-- New games start open with the org's house rules; record who closed them.
create or replace function public.game_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'open';
    new.closed_at := null;
    new.closed_by := null;
    select coalesce(new.tip_tax_pct, o.tip_tax_pct), coalesce(new.loss_discount_pct, o.loss_discount_pct)
      into new.tip_tax_pct, new.loss_discount_pct
      from public.organizations o where o.id = new.org_id;
  elsif new.status is distinct from old.status then
    if new.status = 'closed' then
      new.closed_at := now();
      new.closed_by := auth.uid();
    else
      new.closed_at := null;
      new.closed_by := null;
    end if;
  else
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;
  return new;
end;
$$;

-- Keep the readable `paid_by` label in sync with the partner.
create or replace function public.expense_paid_by()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.partner_id is not null then
    select p.name into new.paid_by from public.partners p where p.id = new.partner_id;
  else
    new.paid_by := 'Game bank';
  end if;
  return new;
end;
$$;

-- Invitations remember the org's name so the invitee can see where they're going.
create or replace function public.invitation_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  select o.name into new.org_name from public.organizations o where o.id = new.org_id;
  new.accepted_at := null;
  new.accepted_by := null;
  new.created_at := now();
  new.created_by := auth.uid();
  return new;
end;
$$;

-- An organization always keeps at least one active admin.
create or replace function public.protect_last_admin()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (
       select 1 from public.memberships m
       where m.org_id = old.org_id and m.role = 'admin' and m.active and m.user_id <> old.user_id
     )
  then
    raise exception 'An organization needs at least one active admin. Make someone else an admin first.';
  end if;
  return coalesce(new, old);
end;
$$;

-- Post / reverse partner shares when a game is closed / reopened.
create or replace function public.post_partner_shares()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profit numeric(12, 2);
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    select gt.net_profit into v_profit from public.game_totals gt where gt.id = new.id;
    insert into public.partner_shares (org_id, game_id, partner_id, share_pct, game_profit, amount)
    select new.org_id, new.id, p.id, p.share_pct, coalesce(v_profit, 0), round(coalesce(v_profit, 0) * p.share_pct / 100, 2)
    from public.partners p
    where p.org_id = new.org_id and p.active and p.share_pct > 0;
  elsif new.status = 'open' and old.status = 'closed' then
    delete from public.partner_shares where game_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  -- never copy invite tokens into the (widely readable) history
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token' end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
    return new;
  end if;

  insert into public.audit_log (org_id, actor_id, actor_email, table_name, action, record_id, game_id, player_id, partner_id, old_data, new_data)
  values (
    case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid else (v_row ->> 'org_id')::uuid end,
    auth.uid(),
    public.auth_email(),
    tg_table_name,
    tg_op,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    case when tg_table_name = 'games' then (v_row ->> 'id')::uuid else (v_row ->> 'game_id')::uuid end,
    case when tg_table_name = 'players' then (v_row ->> 'id')::uuid else (v_row ->> 'player_id')::uuid end,
    case when tg_table_name = 'partners' then (v_row ->> 'id')::uuid else (v_row ->> 'partner_id')::uuid end,
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

-- scope (before) → defaults/stamps (before) → audit (after)
create trigger a_scope before insert or update on public.players for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.games for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.partners for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.transactions for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.dealer_tips for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.expenses for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.player_payments for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.partner_entries for each row execute function public.scope_row();
create trigger a_scope before insert or update on public.invitations for each row execute function public.scope_row();

create trigger b_stamp before insert or update on public.organizations for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.memberships for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.players for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.games for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.partners for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.transactions for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.dealer_tips for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.expenses for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.player_payments for each row execute function public.stamp_row();
create trigger b_stamp before insert or update on public.partner_entries for each row execute function public.stamp_row();

create trigger c_game_defaults before insert or update on public.games for each row execute function public.game_defaults();
create trigger c_paid_by before insert or update on public.expenses for each row execute function public.expense_paid_by();
create trigger c_invitation before insert on public.invitations for each row execute function public.invitation_defaults();
create trigger c_last_admin before update or delete on public.memberships for each row execute function public.protect_last_admin();

create trigger d_post_shares after update of status on public.games for each row execute function public.post_partner_shares();

create trigger z_audit after insert or update or delete on public.organizations for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.memberships for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.invitations for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.players for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.games for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.partners for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.transactions for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.dealer_tips for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.expenses for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.player_payments for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.partner_entries for each row execute function public.log_audit();
create trigger z_audit after insert or update or delete on public.partner_shares for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Onboarding functions (the only way to create orgs / join them)
-- ---------------------------------------------------------------------
create or replace function public.ensure_profile()
returns void language sql security definer set search_path = ''
as $$
  insert into public.profiles (id, email)
  select u.id, lower(u.email) from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing
$$;

create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  perform public.ensure_profile();
  insert into public.organizations (name) values (trim(p_name)) returning id into v_id;
  insert into public.memberships (org_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return v_id;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invitations;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  select * into inv from public.invitations where token = trim(p_token) for update;
  if not found then
    raise exception 'This invite link isn’t valid.';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invite has already been used. Ask for a new one.';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invite has expired. Ask for a new one.';
  end if;
  if inv.email is not null then
    v_email := public.verified_email();
    if v_email is null or v_email <> inv.email then
      raise exception 'This invite is for %. Sign in with that email to accept it.', inv.email;
    end if;
  end if;

  perform public.ensure_profile();
  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do update set active = true;

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.org_id;
end;
$$;

-- All of the signed-in account's organizations, including paused ones.
create or replace function public.my_organizations()
returns table (id uuid, name text, role text, active boolean, tip_tax_pct numeric, loss_discount_pct numeric, joined_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.name, m.role, m.active, o.tip_tax_pct, o.loss_discount_pct, m.created_at
  from public.memberships m join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by m.created_at
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- (`in (select …)` lets Postgres evaluate membership once per query.)
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.organizations   enable row level security;
alter table public.memberships     enable row level security;
alter table public.invitations     enable row level security;
alter table public.players         enable row level security;
alter table public.games           enable row level security;
alter table public.partners        enable row level security;
alter table public.transactions    enable row level security;
alter table public.dealer_tips     enable row level security;
alter table public.expenses        enable row level security;
alter table public.player_payments enable row level security;
alter table public.partner_entries enable row level security;
alter table public.partner_shares  enable row level security;
alter table public.audit_log       enable row level security;

-- Profiles: yourself, plus anyone you share an organization with.
create policy "profiles: self and teammates" on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or exists (select 1 from public.memberships m where m.user_id = profiles.id and m.org_id in (select public.my_org_ids()))
);
create policy "profiles: edit own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Organizations: members read; admins edit name and house rules. Created via create_organization().
create policy "orgs: members read" on public.organizations for select to authenticated
  using (id in (select public.my_org_ids()));
create policy "orgs: admins edit" on public.organizations for update to authenticated
  using (id in (select public.my_admin_org_ids())) with check (id in (select public.my_admin_org_ids()));

-- Memberships: see your own and your teammates'; admins change roles/pause/remove; anyone can leave.
create policy "memberships: read" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or org_id in (select public.my_org_ids()));
create policy "memberships: admins edit" on public.memberships for update to authenticated
  using (org_id in (select public.my_admin_org_ids())) with check (org_id in (select public.my_admin_org_ids()));
create policy "memberships: admins remove, members leave" on public.memberships for delete to authenticated
  using (org_id in (select public.my_admin_org_ids()) or user_id = (select auth.uid()));

-- Invitations: admins manage their org's; an invitee can see invites sent to their verified email.
create policy "invitations: admins and invitee read" on public.invitations for select to authenticated
  using (org_id in (select public.my_admin_org_ids()) or (email is not null and email = (select public.verified_email())));
create policy "invitations: admins create" on public.invitations for insert to authenticated
  with check (org_id in (select public.my_admin_org_ids()));
create policy "invitations: admins revoke" on public.invitations for delete to authenticated
  using (org_id in (select public.my_admin_org_ids()));

-- Players: members manage; admins delete (only players with no history, by FK).
create policy "players: members read" on public.players for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "players: members add" on public.players for insert to authenticated with check (org_id in (select public.my_org_ids()));
create policy "players: members edit" on public.players for update to authenticated
  using (org_id in (select public.my_org_ids())) with check (org_id in (select public.my_org_ids()));
create policy "players: admins delete" on public.players for delete to authenticated using (org_id in (select public.my_admin_org_ids()));

-- Games: members create/edit/close open games; closed games only by admins; admins delete.
create policy "games: members read" on public.games for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "games: members create" on public.games for insert to authenticated with check (org_id in (select public.my_org_ids()));
create policy "games: edit open (admins any)" on public.games for update to authenticated
  using (org_id in (select public.my_org_ids()) and (status = 'open' or org_id in (select public.my_admin_org_ids())))
  with check (org_id in (select public.my_org_ids()));
create policy "games: admins delete" on public.games for delete to authenticated using (org_id in (select public.my_admin_org_ids()));

-- Money inside a game: members, and only while the game is open.
create policy "transactions: read" on public.transactions for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "transactions: add" on public.transactions for insert to authenticated
  with check (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));
create policy "transactions: edit" on public.transactions for update to authenticated
  using (org_id in (select public.my_org_ids()) and public.game_is_open(game_id))
  with check (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));
create policy "transactions: delete" on public.transactions for delete to authenticated
  using (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));

create policy "dealer_tips: read" on public.dealer_tips for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "dealer_tips: add" on public.dealer_tips for insert to authenticated
  with check (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));
create policy "dealer_tips: edit" on public.dealer_tips for update to authenticated
  using (org_id in (select public.my_org_ids()) and public.game_is_open(game_id))
  with check (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));
create policy "dealer_tips: delete" on public.dealer_tips for delete to authenticated
  using (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));

create policy "expenses: read" on public.expenses for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "expenses: add" on public.expenses for insert to authenticated
  with check (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));
create policy "expenses: edit" on public.expenses for update to authenticated
  using (org_id in (select public.my_org_ids()) and public.game_is_open(game_id))
  with check (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));
create policy "expenses: delete" on public.expenses for delete to authenticated
  using (org_id in (select public.my_org_ids()) and public.game_is_open(game_id));

-- Partners and their payouts move the business's money: admins only (members read).
create policy "partners: read" on public.partners for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "partners: admins add" on public.partners for insert to authenticated with check (org_id in (select public.my_admin_org_ids()));
create policy "partners: admins edit" on public.partners for update to authenticated
  using (org_id in (select public.my_admin_org_ids())) with check (org_id in (select public.my_admin_org_ids()));
create policy "partners: admins delete" on public.partners for delete to authenticated using (org_id in (select public.my_admin_org_ids()));

create policy "partner_entries: read" on public.partner_entries for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "partner_entries: admins add" on public.partner_entries for insert to authenticated with check (org_id in (select public.my_admin_org_ids()));
create policy "partner_entries: admins edit" on public.partner_entries for update to authenticated
  using (org_id in (select public.my_admin_org_ids())) with check (org_id in (select public.my_admin_org_ids()));
create policy "partner_entries: admins delete" on public.partner_entries for delete to authenticated using (org_id in (select public.my_admin_org_ids()));

-- Player payments happen at the table: any member.
create policy "player_payments: read" on public.player_payments for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "player_payments: add" on public.player_payments for insert to authenticated with check (org_id in (select public.my_org_ids()));
create policy "player_payments: edit" on public.player_payments for update to authenticated
  using (org_id in (select public.my_org_ids())) with check (org_id in (select public.my_org_ids()));
create policy "player_payments: delete" on public.player_payments for delete to authenticated using (org_id in (select public.my_org_ids()));

-- Posted shares and the audit log: read-only (only triggers write them).
create policy "partner_shares: read" on public.partner_shares for select to authenticated using (org_id in (select public.my_org_ids()));
create policy "audit_log: read" on public.audit_log for select to authenticated using (org_id in (select public.my_org_ids()));

-- ---------------------------------------------------------------------
-- Reporting views (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------
create view public.game_totals with (security_invoker = true) as
select
  g.id, g.org_id, g.name, g.game_date, g.status, g.created_at, g.closed_at, g.tip_tax_pct, g.loss_discount_pct,
  coalesce(t.buy_ins, 0)      as total_buy_ins,
  coalesce(t.cash_outs, 0)    as total_cash_outs,
  coalesce(t.discounts, 0)    as total_discounts,
  coalesce(t.player_count, 0) as player_count,
  coalesce(d.tips, 0)         as total_tips,
  round(coalesce(d.tips, 0) * g.tip_tax_pct / 100, 2) as tip_tax,
  coalesce(e.expenses, 0)     as total_expenses,
  coalesce(t.buy_ins, 0) - coalesce(t.cash_outs, 0) - coalesce(t.discounts, 0) - coalesce(d.tips, 0)
    + round(coalesce(d.tips, 0) * g.tip_tax_pct / 100, 2) as house_take,
  coalesce(t.buy_ins, 0) - coalesce(t.cash_outs, 0) - coalesce(t.discounts, 0) - coalesce(d.tips, 0)
    + round(coalesce(d.tips, 0) * g.tip_tax_pct / 100, 2) - coalesce(e.expenses, 0) as net_profit
from public.games g
left join (
  select game_id,
         sum(amount) filter (where kind = 'buy_in')   as buy_ins,
         sum(amount) filter (where kind = 'cash_out') as cash_outs,
         sum(amount) filter (where kind = 'discount') as discounts,
         count(distinct player_id)                    as player_count
  from public.transactions group by game_id
) t on t.game_id = g.id
left join (select game_id, sum(amount) as tips from public.dealer_tips group by game_id) d on d.game_id = g.id
left join (select game_id, sum(amount) as expenses from public.expenses group by game_id) e on e.game_id = g.id;

create view public.player_game_results with (security_invoker = true) as
select
  t.org_id, t.player_id, t.game_id, g.name as game_name, g.game_date, g.status as game_status,
  coalesce(sum(t.amount) filter (where t.kind = 'buy_in'), 0)   as buy_ins,
  coalesce(sum(t.amount) filter (where t.kind = 'cash_out'), 0) as cash_outs,
  coalesce(sum(t.amount) filter (where t.kind = 'discount'), 0) as discounts,
  count(*) filter (where t.kind = 'buy_in')                     as buy_in_count,
  coalesce(sum(t.amount) filter (where t.kind in ('cash_out', 'discount')), 0)
    - coalesce(sum(t.amount) filter (where t.kind = 'buy_in'), 0) as net
from public.transactions t
join public.games g on g.id = t.game_id
group by t.org_id, t.player_id, t.game_id, g.name, g.game_date, g.status;

-- balance: positive = the house owes the player, negative = the player owes
create view public.player_totals with (security_invoker = true) as
select
  p.id, p.org_id, p.name, p.phone, p.notes, p.created_at,
  coalesce(r.games_played, 0)    as games_played,
  coalesce(r.total_buy_ins, 0)   as total_buy_ins,
  coalesce(r.total_cash_outs, 0) as total_cash_outs,
  coalesce(r.total_discounts, 0) as total_discounts,
  coalesce(r.net, 0)             as net,
  r.last_played,
  coalesce(a.on_account, 0) + coalesce(pay.settled, 0) as balance
from public.players p
left join (
  select player_id,
         count(game_id) as games_played,
         sum(buy_ins)   filter (where game_status = 'closed') as total_buy_ins,
         sum(cash_outs) filter (where game_status = 'closed') as total_cash_outs,
         sum(discounts) filter (where game_status = 'closed') as total_discounts,
         sum(net)       filter (where game_status = 'closed') as net,
         max(game_date) as last_played
  from public.player_game_results group by player_id
) r on r.player_id = p.id
left join (
  select player_id, sum(case when kind = 'buy_in' then -amount else amount end) as on_account
  from public.transactions where method = 'account' group by player_id
) a on a.player_id = p.id
left join (
  select player_id, sum(case when direction = 'from_player' then amount else -amount end) as settled
  from public.player_payments group by player_id
) pay on pay.player_id = p.id;

-- balance: positive = the business owes the partner
create view public.partner_accounts with (security_invoker = true) as
select
  pa.id, pa.org_id, pa.name, pa.email, pa.share_pct, pa.active, pa.notes, pa.created_at,
  coalesce(x.expenses_paid, 0)  as expenses_paid,
  coalesce(s.profit_share, 0)   as profit_share,
  coalesce(c.contributions, 0)  as contributions,
  coalesce(c.payouts, 0)        as payouts,
  coalesce(x.expenses_paid, 0) + coalesce(s.profit_share, 0) + coalesce(c.contributions, 0) - coalesce(c.payouts, 0) as balance
from public.partners pa
left join (select partner_id, sum(amount) as expenses_paid from public.expenses group by partner_id) x on x.partner_id = pa.id
left join (select partner_id, sum(amount) as profit_share from public.partner_shares group by partner_id) s on s.partner_id = pa.id
left join (
  select partner_id,
         sum(amount) filter (where kind = 'contribution') as contributions,
         sum(amount) filter (where kind = 'payout')       as payouts
  from public.partner_entries group by partner_id
) c on c.partner_id = pa.id;

-- ---------------------------------------------------------------------
-- Privileges: nothing for signed-out visitors; column-level limits on edits
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke truncate on all tables in schema public from authenticated;
revoke insert, update, delete on public.audit_log, public.partner_shares from authenticated;
revoke insert, update, delete on public.game_totals, public.player_game_results, public.player_totals, public.partner_accounts
  from authenticated;
revoke insert, delete on public.profiles, public.organizations from authenticated;
revoke insert on public.memberships from authenticated;
revoke update on public.invitations from authenticated;

-- Only these columns can be changed through the API.
revoke update on public.profiles, public.organizations, public.memberships from authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (name, tip_tax_pct, loss_discount_pct) on public.organizations to authenticated;
grant update (role, active) on public.memberships to authenticated;

revoke execute on all functions in schema public from anon, public;
grant execute on function
  public.create_organization(text), public.accept_invitation(text), public.my_organizations(),
  public.my_org_ids(), public.my_admin_org_ids(), public.game_is_open(uuid),
  public.auth_email(), public.verified_email(), public.ensure_profile()
  to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: push changes to every member's screen (RLS still applies)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.organizations, public.memberships, public.players, public.games, public.partners,
  public.transactions, public.dealer_tips, public.expenses, public.player_payments,
  public.partner_entries, public.partner_shares, public.audit_log;
