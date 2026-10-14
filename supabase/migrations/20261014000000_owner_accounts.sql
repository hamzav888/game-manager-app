-- =====================================================================
-- Poker Ledger — owner-managed accounts
--
-- Run this AFTER 20261013000000_schema.sql (once).
--
-- * The app has an OWNER (you). The first account ever created becomes the
--   owner automatically.
-- * Only accounts the owner creates or approves can be put in an
--   organization. Any other account (someone who found the sign-up API,
--   or signed in with Google) sees nothing until the owner approves it.
-- * The owner creates organizations, puts accounts in them and resets
--   passwords — all from the app's Admin screen.
-- * Organization admins add members by email (owner-approved accounts only).
-- * Invite links are removed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Owners and approved accounts
-- ---------------------------------------------------------------------
create table public.app_admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

alter table public.profiles
  add column approved    boolean not null default false,
  add column approved_at timestamptz,
  add column approved_by uuid;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_admins a where a.user_id = auth.uid()) $$;

-- Profiles for any accounts created before this point.
insert into public.profiles (id, email, display_name)
select u.id, lower(u.email), nullif(split_part(coalesce(u.email, ''), '@', 1), '')
from auth.users u
on conflict (id) do nothing;

-- Anyone already in an organization is approved.
update public.profiles p set approved = true, approved_at = now()
where exists (select 1 from public.memberships m where m.user_id = p.id);

-- The earliest account becomes the owner (if there is one yet).
insert into public.app_admins (user_id)
select p.id from public.profiles p join auth.users u on u.id = p.id
order by u.created_at limit 1
on conflict do nothing;
update public.profiles set approved = true, approved_at = coalesce(approved_at, now())
where id in (select user_id from public.app_admins);

-- New accounts: create the profile; the very first account becomes the owner.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_first boolean := not exists (select 1 from public.app_admins);
begin
  insert into public.profiles (id, email, display_name, approved, approved_at)
  values (
    new.id,
    lower(new.email),
    nullif(trim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
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

-- ---------------------------------------------------------------------
-- Invite links are gone
-- ---------------------------------------------------------------------
drop function if exists public.accept_invitation(text);
drop table if exists public.invitations cascade;

-- ---------------------------------------------------------------------
-- Owner sees and manages every account, organization and membership
-- ---------------------------------------------------------------------
create policy "profiles: owner reads all" on public.profiles for select to authenticated
  using ((select public.is_app_admin()));
create policy "orgs: owner reads all" on public.organizations for select to authenticated
  using ((select public.is_app_admin()));
create policy "orgs: owner edits all" on public.organizations for update to authenticated
  using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
create policy "memberships: owner reads all" on public.memberships for select to authenticated
  using ((select public.is_app_admin()));
create policy "memberships: owner edits all" on public.memberships for update to authenticated
  using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
create policy "memberships: owner removes any" on public.memberships for delete to authenticated
  using ((select public.is_app_admin()));

-- ---------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------

-- Who am I: owner? approved?
create or replace function public.whoami()
returns table (is_owner boolean, approved boolean)
language sql stable security definer set search_path = ''
as $$
  select public.is_app_admin(), coalesce((select p.approved from public.profiles p where p.id = auth.uid()), false)
$$;

-- Owner only: create an organization and pick its first admin (default: yourself).
drop function if exists public.create_organization(text);
create or replace function public.create_organization(p_name text, p_admin uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_admin uuid := coalesce(p_admin, auth.uid());
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can create organizations.';
  end if;
  perform public.ensure_profile();
  if not exists (select 1 from public.profiles p where p.id = v_admin and p.approved) then
    raise exception 'That account isn’t approved yet.';
  end if;
  insert into public.organizations (name) values (trim(p_name)) returning id into v_id;
  insert into public.memberships (org_id, user_id, role) values (v_id, v_admin, 'admin');
  return v_id;
end;
$$;

-- Organization admins (or the owner): add an approved account by email.
create or replace function public.add_member(p_org uuid, p_email text, p_role text default 'organizer')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not (public.is_app_admin() or p_org in (select public.my_admin_org_ids())) then
    raise exception 'Only admins of this organization can add members.';
  end if;
  if p_role not in ('admin', 'organizer') then
    raise exception 'Role must be admin or organizer.';
  end if;
  select p.id into v_user from public.profiles p where p.email = lower(trim(p_email)) and p.approved;
  if v_user is null then
    raise exception 'No account uses %. Ask the app owner to create it first.', lower(trim(p_email));
  end if;
  insert into public.memberships (org_id, user_id, role)
  values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role, active = true;
  return v_user;
end;
$$;

-- Owner: every account with its organizations.
create or replace function public.admin_accounts()
returns table (
  id uuid, email text, display_name text, approved boolean, is_owner boolean,
  created_at timestamptz, last_sign_in_at timestamptz, organizations text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can see all accounts.';
  end if;
  return query
  select p.id, p.email, p.display_name, p.approved,
         exists (select 1 from public.app_admins a where a.user_id = p.id),
         u.created_at, u.last_sign_in_at,
         (select string_agg(o.name || case when m.role = 'admin' then ' (admin)' else '' end, ', ' order by o.name)
            from public.memberships m join public.organizations o on o.id = m.org_id
           where m.user_id = p.id and m.active)
  from public.profiles p join auth.users u on u.id = p.id
  order by u.created_at desc;
end;
$$;

-- Owner: every organization with its people.
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
         (select string_agg(coalesce(p.display_name, p.email), ', ' order by p.display_name)
            from public.memberships m join public.profiles p on p.id = m.user_id
           where m.org_id = o.id and m.role = 'admin' and m.active)
  from public.organizations o
  order by o.created_at desc;
end;
$$;

-- Owner: approve (or un-approve) an account.
create or replace function public.admin_set_approved(p_user uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can approve accounts.';
  end if;
  if not p_approved and exists (select 1 from public.app_admins a where a.user_id = p_user) then
    raise exception 'The owner account is always approved.';
  end if;
  update public.profiles
     set approved = p_approved,
         approved_at = case when p_approved then now() end,
         approved_by = case when p_approved then auth.uid() end
   where id = p_user;
  -- Un-approving also takes away access everywhere.
  if not p_approved then
    update public.memberships set active = false where user_id = p_user;
  end if;
end;
$$;

-- Owner: give an account a new password (no email needed).
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Only the app owner can set passwords.';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Passwords need at least 8 characters.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;
  if not found then
    raise exception 'Account not found.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from anon, public;
grant execute on function
  public.is_app_admin(), public.whoami(), public.create_organization(text, uuid), public.add_member(uuid, text, text),
  public.admin_accounts(), public.admin_organizations(), public.admin_set_approved(uuid, boolean),
  public.admin_set_password(uuid, text)
  to authenticated;
-- profile approval can only change through admin_set_approved()
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
