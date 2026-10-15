-- Dealer rounds (tips + rake) and per-player loss discounts.
-- Runs after 10_security.sql in the same throwaway database and reuses its
-- helpers and data: Alice is admin of org A, game a2 is open, Bob has left.
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t_as('a0000000-0000-0000-0000-000000000000');

-- ===================== Rounds: the dealer reports tips and rake
insert into public.dealer_tips (game_id, dealer_name, amount, rake) values ('a2000000-0000-0000-0000-000000000000', 'Lucy', 0, 120);
select t_rows('round with rake only', $q$select 1 from public.dealer_tips where dealer_name = 'Lucy' and amount = 0 and rake = 120$q$, 1);
select t_rows('older tip-only rows have rake 0', $q$select 1 from public.dealer_tips where dealer_name = 'Marco' and rake = 0$q$, 1);
select t_fail('a round needs tips or rake', $q$insert into public.dealer_tips (game_id, dealer_name, amount, rake) values ('a2000000-0000-0000-0000-000000000000', 'Lucy', 0, 0)$q$);
select t_fail('rake cannot be negative', $q$insert into public.dealer_tips (game_id, dealer_name, amount, rake) values ('a2000000-0000-0000-0000-000000000000', 'Lucy', 10, -5)$q$);
select t_fail('tips cannot be negative', $q$insert into public.dealer_tips (game_id, dealer_name, amount, rake) values ('a2000000-0000-0000-0000-000000000000', 'Lucy', -10, 50)$q$);

-- buy-ins 1000, cash-outs 1400, tips 100 (10% tax), rake 120, expenses 50
select t_rows('totals: rake, over/short, last round',
  $q$select 1 from public.game_totals where id = 'a2000000-0000-0000-0000-000000000000'
     and total_rake = 120 and over_short = -620 and last_round_at is not null and seated_count = 0$q$, 1);
select t_rows('net profit is unchanged by reporting rake',
  $q$select 1 from public.game_totals where id = 'a2000000-0000-0000-0000-000000000000' and net_profit = -540 and house_take = -490$q$, 1);

insert into public.transactions (game_id, player_id, kind, amount) values ('a2000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'buy_in', 500);
select t_rows('a buy-in after cashing out seats the player again',
  $q$select 1 from public.game_totals where id = 'a2000000-0000-0000-0000-000000000000' and seated_count = 1$q$, 1);
insert into public.transactions (game_id, player_id, kind, amount) values ('a2000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'discount', 50);
select t_rows('loss discounts come out of profit, not house take',
  $q$select 1 from public.game_totals where id = 'a2000000-0000-0000-0000-000000000000' and house_take = 10 and net_profit = -90 and over_short = -120$q$, 1);

-- ===================== Per-player loss discount
update public.players set loss_discount_pct = 15 where id = 'a1000000-0000-0000-0000-000000000000';
select t_rows('player discount saved', $q$select 1 from public.player_totals where id = 'a1000000-0000-0000-0000-000000000000' and loss_discount_pct = 15$q$, 1);
select t_fail('player discount over 100%', $q$update public.players set loss_discount_pct = 101 where id = 'a1000000-0000-0000-0000-000000000000'$q$);
select t_fail('player discount below 0%', $q$update public.players set loss_discount_pct = -1 where id = 'a1000000-0000-0000-0000-000000000000'$q$);
insert into public.players (org_id, name) select v, 'Newbie' from t_ids where k = 'orgA';
select t_rows('new players use the game rate', $q$select 1 from public.players where name = 'Newbie' and loss_discount_pct is null$q$, 1);

-- ===================== Ending the game locks rounds and posts the profit
update public.games set status = 'closed' where id = 'a2000000-0000-0000-0000-000000000000';
select t_rows('partner share uses the same net profit', $q$select 1 from public.partner_shares where game_id = 'a2000000-0000-0000-0000-000000000000' and amount = -90$q$, 1);
select t_fail('ended game: no new rounds', $q$insert into public.dealer_tips (game_id, dealer_name, rake) values ('a2000000-0000-0000-0000-000000000000', 'Lucy', 40)$q$);
update public.dealer_tips set rake = 999 where dealer_name = 'Lucy';
select t_rows('ended game: rounds cannot be edited', $q$select 1 from public.dealer_tips where rake = 999$q$, 0);
delete from public.dealer_tips where dealer_name = 'Lucy';
select t_rows('ended game: rounds cannot be deleted', $q$select 1 from public.dealer_tips where dealer_name = 'Lucy'$q$, 1);

-- ===================== Other organizations and visitors see nothing
select t_as('b0000000-0000-0000-0000-000000000000');
select t_rows('other org: no rounds', 'select 1 from public.dealer_tips', 0);
select t_rows('other org: no rake totals', $q$select 1 from public.game_totals where id = 'a2000000-0000-0000-0000-000000000000'$q$, 0);
update public.players set loss_discount_pct = 0 where id = 'a1000000-0000-0000-0000-000000000000';
select t_as('a0000000-0000-0000-0000-000000000000');
select t_rows('other org cannot change a player discount', $q$select 1 from public.players where id = 'a1000000-0000-0000-0000-000000000000' and loss_discount_pct = 15$q$, 1);
reset request.jwt.claims;
set role anon;
select t_fail('anon: rounds', 'select * from public.dealer_tips');
select t_fail('anon: game totals', 'select * from public.game_totals');
select t_fail('anon: player totals', 'select * from public.player_totals');
reset role;

select t_rows('rounds are in the history with their rake',
  $q$select 1 from public.audit_log where table_name = 'dealer_tips' and action = 'INSERT' and (new_data ->> 'rake')::numeric = 120$q$, 1);
select t_rows('player discount changes are in the history',
  $q$select 1 from public.audit_log where table_name = 'players' and action = 'UPDATE' and (new_data ->> 'loss_discount_pct')::numeric = 15$q$, 1);
