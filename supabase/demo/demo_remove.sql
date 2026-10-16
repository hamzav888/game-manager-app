-- =====================================================================
-- Poker Ledger — remove the DEMO organization
--
-- Paste into Supabase → SQL Editor and click Run. Deletes the organization
-- made by demo_create.sql and everything in it (its players, dealers, games,
-- rounds, expenses, partners and payments). Nothing else is touched.
-- It finds the demo by its fixed id, so it still works if you renamed it.
--
-- The history is never deleted, so the demo's entries (and a record of this
-- removal) stay in the owner's history.
-- =====================================================================

begin;

do $$
declare
  v_org constant uuid := '00000000-0000-4000-8000-00000000de30';
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'There is no demo organization to remove.';
  end if;

  -- Recorded in the history as done by the app owner.
  perform set_config('request.jwt.claims', json_build_object('sub', (select a.user_id from public.app_admins a order by a.created_at limit 1))::text, true);

  -- Children first: players, partners and dealers can't be deleted while anything uses them.
  delete from public.partner_shares  where org_id = v_org;
  delete from public.transactions    where org_id = v_org;
  delete from public.dealer_tips     where org_id = v_org;
  delete from public.expenses        where org_id = v_org;
  delete from public.player_payments where org_id = v_org;
  delete from public.partner_entries where org_id = v_org;
  delete from public.dealer_payments where org_id = v_org;
  delete from public.games           where org_id = v_org;
  delete from public.players         where org_id = v_org;
  delete from public.partners        where org_id = v_org;
  delete from public.dealers         where org_id = v_org;

  -- The "keep one admin" guard would stop the organization's members being removed.
  execute 'alter table public.memberships disable trigger c_last_admin';
  delete from public.organizations where id = v_org;
  execute 'alter table public.memberships enable trigger c_last_admin';
end $$;

commit;

select 'Demo organization removed.' as done;
