# Poker Ledger

Live accounting for the people who run a poker game. It records buy-ins, cash-outs, each dealer round's rake and tips, and expenses as the night goes. Several tables can run at once, and past games can be entered after the fact. At the end it shows:

- each player's win or loss (green or red)
- the rake, the house take and the over / short against the chips
- the costs, including loss discounts
- each partner's split of the profit
- a full history of every change

Every player, dealer and partner has their own ledger account.

- **Accounts and organizations, run by you.** As the app owner, you create every account (a username and a password of any length) and every organization from the app's **Admin** screen, and decide who runs each one. Each poker operation is an *organization* with its own members, games, players, dealers and partners. One person can belong to several organizations. Nobody else can create accounts.
- **A history only you can see.** Every action by every account is recorded with who did it and when, to the second: money, edits, deletes, members, accounts, password changes and sign-ins. Only the owner can read it, and nobody can change or delete it.
- **No backend server.** It's a static React app that talks straight to Supabase. Row Level Security in the database keeps each organization's data private.
- **Live sync.** Every member's phone updates instantly through Supabase Realtime.
- **Deploys anywhere static.** It's ready for Vercel (`vercel.json`) and Netlify (`netlify.toml`), with security headers included.
- **A sample version** at `/sample` runs on realistic fake data in the browser. Use it to demo the app, no account needed.
- **Installs like an app.** On an iPhone, open the site in Safari → Share → **Add to Home Screen**. It gets the Poker Ledger icon and opens full screen with its own launch screen. Android and desktop Chrome offer **Install app**.

**→ Step-by-step setup and deployment: [SETUP.md](SETUP.md)**

## How the money works

| Number | Formula |
| --- | --- |
| Player net | cash-outs + loss discount − buy-ins (green if up, red if down) |
| Rake | the sum of what each dealer reported, round by round |
| Tip tax | tip tax % × dealer tips (the house keeps this) |
| Over / short | buy-ins − cash-outs − tips − rake (should be $0 once everyone's out) |
| House take | rake + over / short + tip tax |
| Costs | expenses + loss discounts |
| **Net profit** | house take − costs |
| Profit so far (live) | rake + tip tax − costs, while people are still playing |
| Partner split | net profit × each partner's share % |

- **Dealer rounds.** When a dealer gets up, tap **Dealer round** and enter the rake they took and the tips they made. The rake can be different every round. The app suggests the next dealer in the rotation. Their tips (after tip tax) are paid on the spot or marked **owed** on their dealer account.
- **Dealer accounts.** Every dealer has a page under **People → Dealers**: rounds, rake collected, tips, dealer pay, and a ledger of what the house owes them and what's been paid. A new name in a round opens an account automatically.
- **Over / short.** While people are playing, buy-ins − cash-outs − tips − rake is the chips that should be on the table, so you can count and check. Once everyone has cashed out, anything left is shown as over or short. It's counted in the profit, because it's real money in or missing from the bank.
- **Tip tax.** Dealers take home their tips minus the tip tax %, and the house keeps the rest.
- **Loss discount.** When a losing player cashes out, the app offers that % of their loss back. It's recorded as its own "loss discount" entry and booked as an **expense** of the game.
  - The rate comes from the game (copied from the house rules), unless the **player's profile** says otherwise: their own %, or no discount at all.
- **Games can overlap.** Start another table while one is running; each has its own players, rounds and expenses, and the game screen links between running tables. **End game** locks a game and posts the partner shares.
- **Past games.** **New game → A past game** files a game under an earlier date, so you can enter a night that wasn't recorded live and then end it.
- **A $0 cash-out** means the player busted. A player can buy in again after cashing out.
- **Rates.** Organization-wide defaults are set under **Org → Settings** (admins). Every new game copies them, and they can be adjusted per game while it's open.

### Ledgers (one per person)

Every player and every partner has a statement-style ledger with four columns:

| Column | Player | Dealer | Partner |
| --- | --- | --- | --- |
| **Owed to them** | cash-outs, loss discounts | tips after tip tax, dealer pay | profit shares, expenses they paid |
| **They owe** | buy-ins | | their share of a losing night |
| **Our payments** | cash/transfer payouts, payments we made | tips paid on the spot, dealer pay, payments we made | payouts to them |
| **Their payments** | cash/transfer buy-ins, payments they made | payments they made | money they put in |

- **Cash settles on the spot.** A cash buy-in shows both *They owe* and *Their payment*, so it nets to zero.
- **On account stays on the balance.** Anything "On account" carries a balance until a payment settles it.
- **Every entry shows:**
  - the exact time it was recorded, down to the second
  - who recorded it, and who last edited it and when
  - the game, method and note
  - the running balance after it
- **Tap an entry** for its full detail. **Export CSV** downloads the whole statement.
- **Partner profit shares are posted, not recalculated.** They're fixed at the partner's share % the moment a game ends. Reopening the game reverses them; ending it again re-posts them. Changing someone's share later never rewrites the past.

### Accounts

- **Player accounts.** Mark a buy-in or cash-out **On account** to put it on the player's tab instead of paying cash. The balance shows whether they owe the house or the house owes them. **Record a payment** settles it.
- **Partner accounts.** Partners are the people who own the game. Each has a profit share %. Expenses are charged to a partner (or to the **Game bank**), so the business owes it back. The partner's balance is:

  > share of ended-game profit + expenses they paid + money they put in − payouts to them

  Admins record payouts and contributions.

## Security model

Everything is enforced in the database, in [`supabase/migrations/`](supabase/migrations): the schema plus three upgrades (owner accounts; rake and discounts; usernames, dealers and the owner-only history).

- **Organizations are walled off.** Every row carries an `org_id`. RLS only shows or changes rows in organizations you're an active member of.
  - Child rows (buy-ins, tips, expenses, payments) take their organization from their parent, so the browser can't choose it.
  - A buy-in can't reference a player from another organization.
- **Only the owner makes accounts.**
  - The first account in the project is the **owner**.
  - Accounts are created inside the database by `admin_create_account()`, which only the owner can run, so Supabase's public sign-up stays off.
  - Only the owner creates organizations, approves or blocks accounts, changes usernames and sets passwords (`admin_*()` functions). Nobody can make themselves owner or pick their own username.
  - Organization admins add members with `add_member()`, and only owner-approved accounts.
- **Roles.**
  - Organizers run games and record money.
  - Org admins also manage members, partners, payouts and house rules, and can reopen or delete ended games.
  - Every organization keeps at least one admin.
- **Ended games are locked.** Nobody can add, edit or delete buy-ins, cash-outs, dealer rounds or expenses in an ended game. Ending posts the partners' profit shares, and reopening (admins only) reverses them.
- **Tamper-proof, owner-only history.**
  - Triggers write every insert, update and delete, with old and new values, to `audit_log`, plus account changes, password changes (never the password) and every sign-in.
  - Only the owner can read it.
  - Nobody can write, edit or delete it through the API, and a database trigger refuses any edit, delete or wipe of it, even from the SQL editor.
- **Who-did-what can't be faked.** `created_by`, `updated_by` and the timestamps are set by the database, not the browser.
- **Signed-out visitors get nothing.** All table access is revoked from them.
- The anon / publishable key in the browser is safe to expose. It can only do what these rules allow.

The database tests are in `supabase/tests/`: 146 checks covering the owner, approvals, usernames, short passwords, who can create accounts, isolation, roles, locks, the history (owner-only, append-only, sign-ins), dealer rounds and accounts, over / short and per-player discounts. Run them with:

```bash
npm run test:db
```

Use a throwaway local Postgres; see SETUP.md.

## Setup

See **[SETUP.md](SETUP.md)** for:

1. Creating the Supabase project and running the four database files.
2. The sign-in settings to check (sign-ups off).
3. Creating your owner account.
4. Running locally.
5. Deploying to Vercel or Netlify.
7. First steps in the app: accounts, organizations and roles.
8. Putting it on your phone's home screen.

## Daily use

1. **Games → New game** to start the night. Another table can start alongside it.
2. **Seat a player.** Pick a regular or type a new name, tap an amount ($500, $1,000…), and choose Cash, Transfer or On account.
3. **+** on a player's row records a rebuy.
4. **Cash out.**
   - Enter their chips, or use **Count chips** to add up the stack by denomination.
   - If they lost, the loss discount is pre-filled. Untick it to skip.
   - You see their win or loss before confirming.
5. When a dealer gets up, tap **Dealer round** and enter their **rake** and **tips**. Add **Expenses** charged to the partner who paid (or the game bank).
6. The table shows **Profit so far** live. **Summary** has the end-of-night report:
   - who won and who lost
   - where the money went, including over / short
   - the partner split

   **Copy summary** gives you text for the group chat. **End game** locks it and credits the partners.
7. Tap any entry to fix a mistake. The edit is logged with before and after values in the history, which only the owner sees (**History**, a game's **Activity**, and **Admin → History** across every organization).
   - Every history entry shows its exact date and time (to the second), who did it, and the full details of the record.
   - Filter it by account, type, player, dealer or partner.

Each player's page shows their all-time result, results game by game and their account. Each dealer's page shows their rounds, rake, tips and account. Each partner's page shows their statement, payouts and the expenses they paid. The owner also sees every change ever made involving each of them.

## Development

```bash
npm test
```

```bash
npm run build
```

- Unit tests cover the money math:
  - tip tax, loss discounts and partner splits (`src/lib/accounting.test.ts`)
  - ledger running balances and CSV export (`src/lib/ledger.test.ts`)
- `npm run build` type-checks and builds the app.
- Currency: set `VITE_CURRENCY` (for example `CAD`, `GBP`, `PKR`). The default is `USD`.
- App icons and iPhone launch screens are generated from `branding/poker-ledger-logo.png` by `python3 scripts/make-app-icons.py` (needs Pillow). Run it again if the logo changes.
