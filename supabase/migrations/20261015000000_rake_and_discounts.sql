-- =====================================================================
-- Poker Ledger — upgrade 3: dealer-reported rake, per-player discounts
--
-- Run this ONCE in Supabase → SQL Editor, after the first two files.
-- It only adds things; existing games, players and history are kept.
--
--  * Dealer rounds: at the end of each round the dealer reports their tips
--    AND the rake they took (a different amount every round). Rounds live in
--    the existing dealer_tips table, which gains a `rake` column.
--  * Players can have their own loss discount %:
--      null = use the game's rate · 0 = never · anything else = their rate.
--  * game_totals gains total_rake, over_short (chips nobody accounted for:
--    buy-ins − cash-outs − tips − reported rake), seated_count and
--    last_round_at. house_take is now counted BEFORE loss discounts, because
--    discounts are booked as an expense. net_profit is exactly what it was.
-- =====================================================================

do $$
begin
  if to_regclass('public.app_admins') is null then
    raise exception 'Run 20261014000000_owner_accounts.sql first, then this file.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dealer_tips' and column_name = 'rake'
  ) then
    raise exception 'This upgrade is already installed, so there is nothing to do. (Did you click Run twice?)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Dealer rounds: tips + rake (either can be 0, not both)
-- ---------------------------------------------------------------------
alter table public.dealer_tips add column rake numeric(12, 2) not null default 0;
alter table public.dealer_tips drop constraint if exists dealer_tips_amount_check;
alter table public.dealer_tips
  add constraint dealer_tips_amount_check check (amount >= 0 and amount <= 10000000),
  add constraint dealer_tips_rake_check check (rake >= 0 and rake <= 10000000),
  add constraint dealer_tips_not_empty check (amount + rake > 0);

-- ---------------------------------------------------------------------
-- Per-player loss discount
-- ---------------------------------------------------------------------
alter table public.players
  add column loss_discount_pct numeric(5, 2) check (loss_discount_pct is null or loss_discount_pct between 0 and 100);

-- ---------------------------------------------------------------------
-- Reporting views (same columns as before, new ones added at the end)
-- ---------------------------------------------------------------------
create or replace view public.game_totals with (security_invoker = true) as
select
  g.id, g.org_id, g.name, g.game_date, g.status, g.created_at, g.closed_at, g.tip_tax_pct, g.loss_discount_pct,
  coalesce(t.buy_ins, 0)      as total_buy_ins,
  coalesce(t.cash_outs, 0)    as total_cash_outs,
  coalesce(t.discounts, 0)    as total_discounts,
  coalesce(t.player_count, 0) as player_count,
  coalesce(d.tips, 0)         as total_tips,
  round(coalesce(d.tips, 0) * g.tip_tax_pct / 100, 2) as tip_tax,
  coalesce(e.expenses, 0)     as total_expenses,
  -- reported rake + over/short + tip tax (loss discounts are an expense)
  coalesce(t.buy_ins, 0) - coalesce(t.cash_outs, 0) - coalesce(d.tips, 0)
    + round(coalesce(d.tips, 0) * g.tip_tax_pct / 100, 2) as house_take,
  coalesce(t.buy_ins, 0) - coalesce(t.cash_outs, 0) - coalesce(t.discounts, 0) - coalesce(d.tips, 0)
    + round(coalesce(d.tips, 0) * g.tip_tax_pct / 100, 2) - coalesce(e.expenses, 0) as net_profit,
  coalesce(d.rake, 0)         as total_rake,
  -- while players are seated this is the chips still in play
  coalesce(t.buy_ins, 0) - coalesce(t.cash_outs, 0) - coalesce(d.tips, 0) - coalesce(d.rake, 0) as over_short,
  coalesce(s.seated, 0)       as seated_count,
  d.last_round_at
from public.games g
left join (
  select game_id,
         sum(amount) filter (where kind = 'buy_in')   as buy_ins,
         sum(amount) filter (where kind = 'cash_out') as cash_outs,
         sum(amount) filter (where kind = 'discount') as discounts,
         count(distinct player_id)                    as player_count
  from public.transactions group by game_id
) t on t.game_id = g.id
left join (
  select game_id, sum(amount) as tips, sum(rake) as rake, max(created_at) as last_round_at
  from public.dealer_tips group by game_id
) d on d.game_id = g.id
left join (select game_id, sum(amount) as expenses from public.expenses group by game_id) e on e.game_id = g.id
left join (
  -- a player is seated until a cash-out follows their latest buy-in
  select game_id, count(*) as seated
  from (
    select game_id, player_id,
           max(created_at) filter (where kind = 'buy_in')   as last_in,
           max(created_at) filter (where kind = 'cash_out') as last_out
    from public.transactions group by game_id, player_id
  ) x
  where last_in is not null and (last_out is null or last_out < last_in)
  group by game_id
) s on s.game_id = g.id;

create or replace view public.player_totals with (security_invoker = true) as
select
  p.id, p.org_id, p.name, p.phone, p.notes, p.created_at,
  coalesce(r.games_played, 0)    as games_played,
  coalesce(r.total_buy_ins, 0)   as total_buy_ins,
  coalesce(r.total_cash_outs, 0) as total_cash_outs,
  coalesce(r.total_discounts, 0) as total_discounts,
  coalesce(r.net, 0)             as net,
  r.last_played,
  coalesce(a.on_account, 0) + coalesce(pay.settled, 0) as balance,
  p.loss_discount_pct
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

-- Views stay read-only (create or replace keeps grants, this is belt and braces).
revoke all on public.game_totals, public.player_totals from anon;
revoke insert, update, delete, truncate on public.game_totals, public.player_totals from authenticated;
