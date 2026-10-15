-- =====================================================================
-- Poker Ledger — create a DEMO organization (optional)
--
-- Paste into Supabase → SQL Editor and click Run. Run it after the three
-- files in supabase/migrations, and after your owner account exists.
--
-- It adds ONE new organization, "Demo · Riverside Card Club", with you (the
-- app owner) as its admin, filled with made-up data:
--   * 14 players (one with his own 15% loss discount, one with none)
--   * 3 partners splitting the profit 40 / 35 / 25
--   * 8 weekly games that have ended, with buy-ins, rebuys, cash-outs,
--     loss discounts, dealer rounds (rake + tips), expenses, profit shares,
--     partner payouts and player payments
--   * 2 tables running right now
--
-- Nothing outside that organization is touched: your real organizations,
-- players, games and accounts stay exactly as they are, and no logins are
-- created. To delete it all again, run demo_remove.sql.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.app_admins') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'dealer_tips' and column_name = 'rake') then
    raise exception 'Run all three files in supabase/migrations first, then this one.';
  end if;
  if not exists (select 1 from public.app_admins) then
    raise exception 'There is no app owner yet. Create your owner account first (SETUP.md, step 4).';
  end if;
  if exists (select 1 from public.organizations where id = '00000000-0000-4000-8000-00000000de30') then
    raise exception 'The demo organization already exists. Run demo_remove.sql first if you want to rebuild it.';
  end if;
end $$;

-- Keep the made-up dates: these triggers would otherwise stamp every row "now"
-- and force new games open. Only for this transaction; switched back on below.
alter table public.games           disable trigger b_stamp;
alter table public.games           disable trigger c_game_defaults;
alter table public.players         disable trigger b_stamp;
alter table public.partners        disable trigger b_stamp;
alter table public.transactions    disable trigger b_stamp;
alter table public.dealer_tips     disable trigger b_stamp;
alter table public.expenses        disable trigger b_stamp;
alter table public.player_payments disable trigger b_stamp;
alter table public.partner_entries disable trigger b_stamp;

-- Everything that happens, collected first and then replayed in time order,
-- so the history reads like a real season.
create temp table demo_events (
  seq serial,
  at  timestamptz not null,
  tbl text not null,
  row jsonb not null
) on commit drop;

do $$
declare
  v_org     constant uuid := '00000000-0000-4000-8000-00000000de30';
  v_owner   uuid;
  v_founded timestamptz := date_trunc('day', now()) - interval '75 days' + interval '17 hours';
  v_names   text[] := array['Danny K.', 'Omar', 'Jess', 'Kev', 'Tariq', 'Mike R.', 'Lena', 'Big Rob',
                            'Chris', 'Sana', 'Vik', 'Theo', 'Nadia', 'Hector'];
  v_credit  text[] := array['Big Rob', 'Tariq'];
  v_dealers text[] := array['Marco', 'Lucy', 'Andre'];
  v_foods   text[] := array['Pizza', 'Wings & fries', 'Shawarma platters', 'Tacos'];
  v_partner uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_pnames  text[] := array['Sam', 'Jordan', 'Priya'];
  v_player  uuid[] := '{}';
  v_rate    numeric[] := '{}';
  v_game    uuid;
  v_day     date;
  v_t0      timestamptz;
  v_seats   int[];
  v_in      numeric[];
  v_w       float8[];
  v_out     numeric[];
  v_n       int;
  v_total   numeric;
  v_tips    numeric;
  v_rake    numeric;
  v_pool    numeric;
  v_wsum    float8;
  v_big     int;
  v_amt     numeric;
  v_loss    numeric;
  v_disc    numeric;
  v_stake   int;
  v_method  text;
  v_rounds  int;
  v_rparts  numeric[];
  v_tparts  numeric[];
  v_first   int;
  v_owed    numeric;
  i int; k int; gi int;
  e record;

  -- helpers
  r5 constant numeric := 5;
begin
  select a.user_id into v_owner from public.app_admins a order by a.created_at limit 1;
  -- Record everything as done by the owner (shows in the history).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform setseed(0.2026);

  insert into public.organizations (id, name, tip_tax_pct, loss_discount_pct)
  values (v_org, 'Demo · Riverside Card Club', 10, 10);
  insert into public.memberships (org_id, user_id, role) values (v_org, v_owner, 'admin');

  -- ------------------------------------------------ partners and players
  for i in 1..3 loop
    insert into demo_events (at, tbl, row) values (v_founded, 'partners', jsonb_build_object(
      'id', v_partner[i], 'org_id', v_org, 'name', v_pnames[i], 'share_pct', (array[40, 35, 25])[i],
      'active', true, 'created_at', v_founded, 'created_by', v_owner));
  end loop;
  insert into demo_events (at, tbl, row) values (v_founded + interval '20 minutes', 'partner_entries', jsonb_build_object(
    'id', gen_random_uuid(), 'partner_id', v_partner[1], 'kind', 'contribution', 'amount', 2000, 'method', 'transfer',
    'note', 'Starting float for the cage', 'created_at', v_founded + interval '20 minutes', 'created_by', v_owner));

  for i in 1..array_length(v_names, 1) loop
    v_player := v_player || gen_random_uuid();
    v_rate := v_rate || (case v_names[i] when 'Big Rob' then 15 when 'Hector' then 0 else null end)::numeric;
    insert into demo_events (at, tbl, row) values (v_founded + i * interval '3 minutes', 'players', jsonb_build_object(
      'id', v_player[i], 'org_id', v_org, 'name', v_names[i],
      'phone', case v_names[i] when 'Lena' then '(555) 014-2290' end,
      'notes', case v_names[i]
                 when 'Big Rob' then 'Plays on account, settles by transfer on Mondays. Gets 15% back on losses.'
                 when 'Hector' then 'Asked not to get the loss discount.' end,
      'loss_discount_pct', v_rate[i],
      'created_at', v_founded + i * interval '3 minutes', 'created_by', v_owner));
  end loop;

  -- ------------------------------------------------ eight weekly games that ended
  for gi in reverse 8..1 loop
    v_day := current_date - gi * 7;
    v_t0 := (v_day + time '23:00') at time zone 'UTC';
    v_stake := case when gi = 5 then 2 else 1 end;
    v_game := gen_random_uuid();
    insert into demo_events (at, tbl, row) values (v_t0 - interval '20 minutes', 'games', jsonb_build_object(
      'id', v_game, 'org_id', v_org, 'game_date', v_day, 'status', 'open', 'tip_tax_pct', 10, 'loss_discount_pct', 10,
      'name', case when gi = 5 then 'High-roller night' else trim(to_char(v_day, 'Day')) || ' game' end,
      'created_at', v_t0 - interval '20 minutes', 'created_by', v_owner));

    -- who sits down tonight
    v_n := 8 + floor(random() * 4)::int;
    select array_agg(x) into v_seats from (select x from generate_series(1, array_length(v_names, 1)) x order by random() limit v_n) s;
    v_in := array_fill(0::numeric, array[v_n]);
    for i in 1..v_n loop
      v_amt := (case when random() < 0.55 then 1000 else 500 end) * v_stake;
      v_method := case when v_names[v_seats[i]] = any (v_credit) then 'account' when random() < 0.75 then 'cash' else 'transfer' end;
      insert into demo_events (at, tbl, row) values (v_t0 + make_interval(mins => i * 4 + floor(random() * 10)::int), 'transactions', jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[v_seats[i]], 'kind', 'buy_in', 'amount', v_amt, 'method', v_method,
        'created_at', v_t0 + make_interval(mins => i * 4), 'created_by', v_owner));
      v_in[i] := v_amt;
      for k in 1..(case when random() < 0.5 then 0 when random() < 0.6 then 1 when random() < 0.75 then 2 else 3 end) loop
        v_amt := (case when random() < 0.5 then 500 else 1000 end) * v_stake;
        insert into demo_events (at, tbl, row) values (v_t0 + make_interval(mins => 60 + k * 50 + floor(random() * 40)::int), 'transactions', jsonb_build_object(
          'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[v_seats[i]], 'kind', 'buy_in', 'amount', v_amt,
          'method', case when v_names[v_seats[i]] = any (v_credit) then 'account' when random() < 0.7 then 'cash' else 'transfer' end,
          'created_at', v_t0, 'created_by', v_owner));
        v_in[i] := v_in[i] + v_amt;
      end loop;
    end loop;

    -- rake and tips for the night (one slow night barely covered the room)
    v_total := (select sum(x) from unnest(v_in) x);
    v_tips := round(v_total * (0.01 + random() * 0.006) / r5) * r5;
    v_rake := round(v_total * (case when gi = 3 then 0.02 else 0.075 + random() * 0.025 end) / r5) * r5;
    v_pool := v_total - v_rake - v_tips;

    -- cash-outs: the pool shared out by luck, a few busts
    v_w := '{}';
    for i in 1..v_n loop
      v_w := v_w || (case when i > 2 and random() < 0.22 then 0
                          else v_in[i]::float8 * exp(sqrt(-2 * ln(greatest(random(), 1e-9))) * cos(2 * pi() * random()) * 0.75) end);
    end loop;
    v_wsum := (select sum(x) from unnest(v_w) x);
    v_out := '{}';
    for i in 1..v_n loop
      v_out := v_out || (round((v_pool * v_w[i] / v_wsum)::numeric / r5) * r5);
    end loop;
    v_big := 1;
    for i in 2..v_n loop
      if v_out[i] > v_out[v_big] then v_big := i; end if;
    end loop;
    v_out[v_big] := v_out[v_big] + v_pool - (select sum(x) from unnest(v_out) x);

    for i in 1..v_n loop
      v_method := case when v_names[v_seats[i]] = any (v_credit) then 'account' when random() < 0.7 then 'cash' else 'transfer' end;
      insert into demo_events (at, tbl, row) values (v_t0 + make_interval(mins => 240 + i * 6 + floor(random() * 30)::int), 'transactions', jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[v_seats[i]], 'kind', 'cash_out', 'amount', v_out[i], 'method', v_method,
        'created_at', v_t0, 'created_by', v_owner));
      v_loss := v_in[i] - v_out[i];
      v_disc := round(v_loss * coalesce(v_rate[v_seats[i]], 10) / 100);
      if v_loss > 0 and v_disc > 0 then
        insert into demo_events (at, tbl, row) values (v_t0 + make_interval(mins => 240 + i * 6 + 31), 'transactions', jsonb_build_object(
          'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[v_seats[i]], 'kind', 'discount', 'amount', v_disc,
          'method', case when v_method = 'account' then 'account' else 'cash' end,
          'note', coalesce(v_rate[v_seats[i]], 10) || '% loss discount', 'created_at', v_t0, 'created_by', v_owner));
      end if;
    end loop;

    -- dealer rounds: rake and tips reported as each dealer gets up
    -- (two weeks ago the reported rake came out $20 more than the chips)
    v_rounds := 6 + floor(random() * 3)::int;
    v_rparts := '{}';
    v_tparts := '{}';
    v_w := '{}';
    for k in 1..v_rounds loop v_w := v_w || (0.6 + random()); end loop;
    v_wsum := (select sum(x) from unnest(v_w) x);
    for k in 1..v_rounds loop
      v_rparts := v_rparts || (round(((v_rake + case when gi = 2 then 20 else 0 end) * v_w[k] / v_wsum)::numeric / r5) * r5);
      v_tparts := v_tparts || (round((v_tips * v_w[v_rounds + 1 - k] / v_wsum)::numeric / r5) * r5);
    end loop;
    v_rparts[v_rounds] := v_rparts[v_rounds] + v_rake + (case when gi = 2 then 20 else 0 end) - (select sum(x) from unnest(v_rparts) x);
    v_tparts[v_rounds] := greatest(0, v_tparts[v_rounds] + v_tips - (select sum(x) from unnest(v_tparts) x));
    v_first := 1 + floor(random() * 3)::int;
    for k in 1..v_rounds loop
      insert into demo_events (at, tbl, row) values (v_t0 + make_interval(mins => 40 + (k - 1) * 40 + floor(random() * 8)::int), 'dealer_tips', jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_game, 'dealer_name', v_dealers[1 + (v_first + k - 2) % 3],
        'rake', v_rparts[k], 'amount', v_tparts[k], 'created_at', v_t0, 'created_by', v_owner));
    end loop;

    -- expenses
    insert into demo_events (at, tbl, row) values (v_t0 + interval '30 minutes', 'expenses', jsonb_build_object(
      'id', gen_random_uuid(), 'game_id', v_game, 'category', 'food', 'description', v_foods[1 + floor(random() * 4)::int],
      'amount', round((70 + random() * 120) / r5) * r5, 'partner_id', v_partner[1 + floor(random() * 3)::int],
      'created_at', v_t0, 'created_by', v_owner));
    if random() < 0.5 then
      insert into demo_events (at, tbl, row) values (v_t0 + interval '45 minutes', 'expenses', jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_game, 'category', 'drinks', 'description', 'Drinks & ice',
        'amount', round((35 + random() * 55) / r5) * r5, 'created_at', v_t0, 'created_by', v_owner));
    end if;
    if random() < 0.6 then
      insert into demo_events (at, tbl, row) values (v_t0 + interval '300 minutes', 'expenses', jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_game, 'category', 'dealer_pay', 'description', 'Dealer shift',
        'amount', round((150 + random() * 110) / r5) * r5, 'created_at', v_t0, 'created_by', v_owner));
    end if;
    if gi = 5 then
      insert into demo_events (at, tbl, row) values (v_t0, 'expenses', jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_game, 'category', 'venue', 'description', 'Back room rental',
        'amount', 300, 'partner_id', v_partner[2], 'created_at', v_t0, 'created_by', v_owner));
    end if;

    -- end of the night: lock it (posts the partner shares)
    insert into demo_events (at, tbl, row) values (v_t0 + interval '330 minutes', 'end_game', jsonb_build_object('id', v_game));

    -- partners take a payout every four weeks
    if gi in (5, 1) then
      for i in 1..3 loop
        insert into demo_events (at, tbl, row) values (v_t0 + interval '2 days' - interval '8 hours', 'partner_entries', jsonb_build_object(
          'id', gen_random_uuid(), 'partner_id', v_partner[i], 'kind', 'payout', 'amount', (array[800, 700, 500])[i],
          'method', 'transfer', 'note', 'Monthly split', 'created_at', v_t0, 'created_by', v_owner));
      end loop;
    end if;
  end loop;

  -- Credit players pay down part of their tab a few days after the last game.
  for i in 1..array_length(v_names, 1) loop
    continue when not (v_names[i] = any (v_credit));
    select -coalesce(sum(case when row ->> 'kind' = 'buy_in' then -(row ->> 'amount')::numeric else (row ->> 'amount')::numeric end), 0)
      into v_owed from demo_events
      where tbl = 'transactions' and row ->> 'player_id' = v_player[i]::text and row ->> 'method' = 'account';
    if v_owed >= 200 then
      insert into demo_events (at, tbl, row) values ((current_date - 5 + time '18:12') at time zone 'UTC', 'player_payments', jsonb_build_object(
        'id', gen_random_uuid(), 'player_id', v_player[i], 'direction', 'from_player', 'amount', floor(v_owed * 0.6 / 100) * 100,
        'method', 'transfer', 'note', case when v_names[i] = 'Big Rob' then 'E-transfer' else 'Partial payment' end,
        'created_at', now(), 'created_by', v_owner));
    end if;
  end loop;

  -- ------------------------------------------------ two tables running right now
  v_game := gen_random_uuid();
  insert into demo_events (at, tbl, row) values (now() - interval '200 minutes', 'games', jsonb_build_object(
    'id', v_game, 'org_id', v_org, 'game_date', current_date, 'status', 'open', 'tip_tax_pct', 10, 'loss_discount_pct', 10,
    'name', 'Main table', 'created_at', now() - interval '200 minutes', 'created_by', v_owner));
  for i in 1..10 loop
    insert into demo_events (at, tbl, row) values (now() - make_interval(mins => 190 - i * 4), 'transactions', jsonb_build_object(
      'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[i], 'kind', 'buy_in',
      'amount', case when i % 3 = 0 then 500 else 1000 end,
      'method', case when v_names[i] = any (v_credit) then 'account' else 'cash' end, 'created_at', now(), 'created_by', v_owner));
  end loop;
  insert into demo_events (at, tbl, row) values (now() - interval '120 minutes', 'transactions', jsonb_build_object(
    'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[2], 'kind', 'buy_in', 'amount', 500, 'method', 'cash', 'created_at', now(), 'created_by', v_owner));
  insert into demo_events (at, tbl, row) values (now() - interval '50 minutes', 'transactions', jsonb_build_object(
    'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[3], 'kind', 'cash_out', 'amount', 0, 'method', 'cash', 'created_at', now(), 'created_by', v_owner));
  insert into demo_events (at, tbl, row) values (now() - interval '50 minutes', 'transactions', jsonb_build_object(
    'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[3], 'kind', 'discount', 'amount', 50, 'method', 'cash',
    'note', '10% loss discount', 'created_at', now(), 'created_by', v_owner));
  insert into demo_events (at, tbl, row) values (now() - interval '40 minutes', 'transactions', jsonb_build_object(
    'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[9], 'kind', 'cash_out', 'amount', 1870, 'method', 'transfer', 'created_at', now(), 'created_by', v_owner));
  for k in 1..4 loop
    insert into demo_events (at, tbl, row) values (now() - make_interval(mins => 200 - k * 40), 'dealer_tips', jsonb_build_object(
      'id', gen_random_uuid(), 'game_id', v_game, 'dealer_name', v_dealers[1 + (k - 1) % 3],
      'rake', (array[95, 120, 85, 140])[k], 'amount', (array[25, 30, 15, 35])[k], 'created_at', now(), 'created_by', v_owner));
  end loop;
  insert into demo_events (at, tbl, row) values (now() - interval '150 minutes', 'expenses', jsonb_build_object(
    'id', gen_random_uuid(), 'game_id', v_game, 'category', 'food', 'description', 'Wings & fries', 'amount', 145,
    'partner_id', v_partner[2], 'created_at', now(), 'created_by', v_owner));

  v_game := gen_random_uuid();
  insert into demo_events (at, tbl, row) values (now() - interval '95 minutes', 'games', jsonb_build_object(
    'id', v_game, 'org_id', v_org, 'game_date', current_date, 'status', 'open', 'tip_tax_pct', 10, 'loss_discount_pct', 10,
    'name', 'Side table · $2/$5', 'notes', 'Higher stakes, overflow from the main game.',
    'created_at', now() - interval '95 minutes', 'created_by', v_owner));
  for i in 11..14 loop
    insert into demo_events (at, tbl, row) values (now() - make_interval(mins => 90 - (i - 10) * 3), 'transactions', jsonb_build_object(
      'id', gen_random_uuid(), 'game_id', v_game, 'player_id', v_player[i], 'kind', 'buy_in', 'amount', 2000, 'method', 'cash',
      'created_at', now(), 'created_by', v_owner));
  end loop;
  insert into demo_events (at, tbl, row) values (now() - interval '52 minutes', 'dealer_tips', jsonb_build_object(
    'id', gen_random_uuid(), 'game_id', v_game, 'dealer_name', 'Andre', 'rake', 160, 'amount', 40, 'created_at', now(), 'created_by', v_owner));

  -- ------------------------------------------------ replay everything in time order
  for e in select * from demo_events order by at, seq loop
    case e.tbl
      when 'partners' then
        insert into public.partners select * from jsonb_populate_record(null::public.partners, e.row || jsonb_build_object('created_at', e.at));
      when 'players' then
        insert into public.players select * from jsonb_populate_record(null::public.players, e.row || jsonb_build_object('created_at', e.at));
      when 'games' then
        insert into public.games select * from jsonb_populate_record(null::public.games, e.row || jsonb_build_object('created_at', e.at));
      when 'transactions' then
        insert into public.transactions select * from jsonb_populate_record(null::public.transactions, e.row || jsonb_build_object('created_at', e.at));
      when 'dealer_tips' then
        insert into public.dealer_tips select * from jsonb_populate_record(null::public.dealer_tips, e.row || jsonb_build_object('created_at', e.at));
      when 'expenses' then
        insert into public.expenses select * from jsonb_populate_record(null::public.expenses, e.row || jsonb_build_object('created_at', e.at));
      when 'partner_entries' then
        insert into public.partner_entries select * from jsonb_populate_record(null::public.partner_entries, e.row || jsonb_build_object('created_at', e.at));
      when 'player_payments' then
        insert into public.player_payments select * from jsonb_populate_record(null::public.player_payments, e.row || jsonb_build_object('created_at', e.at));
      when 'end_game' then
        update public.games set status = 'closed', closed_at = e.at, closed_by = v_owner where id = (e.row ->> 'id')::uuid;
    end case;
  end loop;

end $$;

-- Partner shares were posted "now"; date them to when each game ended.
alter table public.partner_shares disable trigger z_audit;
update public.partner_shares s set created_at = g.closed_at
  from public.games g
  where g.id = s.game_id and s.org_id = '00000000-0000-4000-8000-00000000de30';
alter table public.partner_shares enable trigger z_audit;

-- Date the history to match.
update public.audit_log a set occurred_at = (a.new_data ->> 'created_at')::timestamptz
  where a.org_id = '00000000-0000-4000-8000-00000000de30' and a.action = 'INSERT'
    and a.table_name not in ('organizations', 'memberships', 'partner_shares');
update public.audit_log a set occurred_at = (a.new_data ->> 'closed_at')::timestamptz
  where a.org_id = '00000000-0000-4000-8000-00000000de30' and a.table_name = 'games' and a.action = 'UPDATE';
update public.audit_log a
  set occurred_at = g.closed_at,
      new_data = jsonb_set(a.new_data, '{created_at}', to_jsonb(g.closed_at))
  from public.games g
  where a.org_id = '00000000-0000-4000-8000-00000000de30' and a.table_name = 'partner_shares' and g.id = a.game_id;
update public.audit_log a set occurred_at = date_trunc('day', now()) - interval '75 days' + interval '17 hours' - interval '5 minutes'
  where a.org_id = '00000000-0000-4000-8000-00000000de30' and a.table_name in ('organizations', 'memberships');

-- Switch the triggers back on.
alter table public.games           enable trigger b_stamp;
alter table public.games           enable trigger c_game_defaults;
alter table public.players         enable trigger b_stamp;
alter table public.partners        enable trigger b_stamp;
alter table public.transactions    enable trigger b_stamp;
alter table public.dealer_tips     enable trigger b_stamp;
alter table public.expenses        enable trigger b_stamp;
alter table public.player_payments enable trigger b_stamp;
alter table public.partner_entries enable trigger b_stamp;

commit;

-- What was created (shown as the result of this query):
select
  (select count(*) from public.players where org_id = '00000000-0000-4000-8000-00000000de30') as players,
  (select count(*) from public.games where org_id = '00000000-0000-4000-8000-00000000de30' and status = 'closed') as games_ended,
  (select count(*) from public.games where org_id = '00000000-0000-4000-8000-00000000de30' and status = 'open') as games_running,
  (select count(*) from public.dealer_tips where org_id = '00000000-0000-4000-8000-00000000de30') as dealer_rounds,
  (select sum(net_profit) from public.game_totals where org_id = '00000000-0000-4000-8000-00000000de30' and status = 'closed') as total_profit;
