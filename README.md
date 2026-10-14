# Poker Ledger

Live accounting for the people who run a poker game. It records buy-ins, cash-outs, dealer tips and expenses as the night goes. At the end it shows:

- each player's win or loss (green or red)
- the house take, after tip tax and loss discounts
- each partner's split of the profit
- a full history of every change

Every player and partner has their own ledger.

- **Accounts and organizations, run by you.** As the app owner, you create every account and organization from the app's **Admin** screen and decide who runs each one. Each poker operation is an *organization* with its own members, games, players, partners and history. One person can belong to several organizations. Nobody can sign themselves up.
- **No backend server.** It's a static React app that talks straight to Supabase. Row Level Security in the database keeps each organization's data private.
- **Live sync.** Every member's phone updates instantly through Supabase Realtime.
- **Deploys anywhere static.** It's ready for Vercel (`vercel.json`) and Netlify (`netlify.toml`), with security headers included.
- **A sample version** at `/sample` runs on realistic fake data in the browser. Use it to demo the app, no account needed.

**→ Step-by-step setup and deployment: [SETUP.md](SETUP.md)**

## How the money works

| Number | Formula |
| --- | --- |
| Player net | cash-outs + loss discount − buy-ins (green if up, red if down) |
| Rake | buy-ins − cash-outs − loss discounts − dealer tips |
| Tip tax | tip tax % × dealer tips (the house keeps this) |
| House take | rake + tip tax |
| **Net profit** | house take − expenses |
| Partner split | net profit × each partner's share % |

- **Tip tax.** Dealers take home their tips minus the tip tax %, and the house keeps the rest.
- **Loss discount.** When a losing player cashes out, the app offers that % of their loss back. It's recorded as its own "loss discount" entry, so it's visible and audited.
- **Profit shows as "Pending"** until every player has cashed out, because seated players' chips are still in the bank.
- **A $0 cash-out** means the player busted. A player can buy in again after cashing out.
- **Rates.** Organization-wide defaults are set under **Org → Settings** (admins). Every new game copies them, and they can be adjusted per game while it's open.

### Ledgers (one per person)

Every player and every partner has a statement-style ledger with four columns:

| Column | Player | Partner |
| --- | --- | --- |
| **Owed to them** | cash-outs, loss discounts | profit shares, expenses they paid |
| **They owe** | buy-ins | their share of a losing night |
| **Our payments** | cash/transfer payouts, payments we made | payouts to them |
| **Their payments** | cash/transfer buy-ins, payments they made | money they put in |

- **Cash settles on the spot.** A cash buy-in shows both *They owe* and *Their payment*, so it nets to zero.
- **On account stays on the balance.** Anything "On account" carries a balance until a payment settles it.
- **Every entry shows:**
  - the exact time it was recorded, down to the second
  - who recorded it, and who last edited it and when
  - the game, method and note
  - the running balance after it
- **Tap an entry** for its full detail. **Export CSV** downloads the whole statement.
- **Partner profit shares are posted, not recalculated.** They're fixed at the partner's share % the moment a game is closed. Reopening the game reverses them; closing it again re-posts them. Changing someone's share later never rewrites the past.

### Accounts

- **Player accounts.** Mark a buy-in or cash-out **On account** to put it on the player's tab instead of paying cash. The balance shows whether they owe the house or the house owes them. **Record a payment** settles it.
- **Partner accounts.** Partners are the people who own the game. Each has a profit share %. Expenses are charged to a partner (or to the **Game bank**), so the business owes it back. The partner's balance is:

  > share of closed-game profit + expenses they paid + money they put in − payouts to them

  Admins record payouts and contributions.

## Security model

Everything is enforced in the database, in [`supabase/migrations/`](supabase/migrations): the schema plus the owner-accounts upgrade.

- **Organizations are walled off.** Every row carries an `org_id`. RLS only shows or changes rows in organizations you're an active member of.
  - Child rows (buy-ins, tips, expenses, payments) take their organization from their parent, so the browser can't choose it.
  - A buy-in can't reference a player from another organization.
- **Only owner-made accounts count.**
  - The first account in the project is the **owner**.
  - Only accounts the owner creates or approves can be added to an organization. Any other account sees nothing.
  - Only the owner creates organizations (`create_organization()`), approves accounts and sets passwords (`admin_*()` functions).
  - Organization admins add members with `add_member()`, and only approved accounts.
- **Roles.**
  - Organizers run games and record money.
  - Org admins also manage members, partners, payouts and house rules, and can reopen or delete closed games.
  - Every organization keeps at least one admin.
- **Closed games are locked.** Nobody can add, edit or delete buy-ins, cash-outs, tips or expenses in a closed game. Closing posts the partners' profit shares, and reopening reverses them.
- **Tamper-proof history.**
  - Triggers write every insert, update and delete, with old and new values, to `audit_log`.
  - Nobody can write, edit or delete it through the API, not even admins.
- **Who-did-what can't be faked.** `created_by`, `updated_by` and the timestamps are set by the database, not the browser.
- **Signed-out visitors get nothing.** All table access is revoked from them.
- The anon / publishable key in the browser is safe to expose. It can only do what these rules allow.

The security tests are in `supabase/tests/10_security.sql`: 72 checks covering the owner, approvals, isolation, roles, locks and the audit log. Run them with:

```bash
npm run test:db
```

Use a throwaway local Postgres; see SETUP.md.

## Setup

See **[SETUP.md](SETUP.md)** for:

1. Creating the Supabase project and running the two database files.
2. The three sign-in settings to check.
3. Creating your owner account.
4. Running locally.
5. Deploying to Vercel or Netlify.
6. Optional Google sign-in.
7. First steps in the app: accounts, organizations and roles.

## Daily use

1. **Games → New game** to start the night.
2. **Seat a player.** Pick a regular or type a new name, tap an amount ($500, $1,000…), and choose Cash, Transfer or On account.
3. **+** on a player's row records a rebuy.
4. **Cash out.**
   - Enter their chips, or use **Count chips** to add up the stack by denomination.
   - If they lost, the loss discount is pre-filled. Untick it to skip.
   - You see their win or loss before confirming.
5. Record **Tips** as they happen, and **Expenses** charged to the partner who paid.
6. **Summary** has the end-of-night report:
   - who won and who lost
   - where the money went
   - the partner split

   **Copy summary** gives you text for the group chat. **Close game** locks it and credits the partners.
7. Tap any entry to fix a mistake. The edit is logged with before and after values under **Activity** and **History**.
   - Every history entry shows its exact date and time (to the second), who did it, and the full details of the record.
   - Filter History by member, type, player or partner.

Each player's page shows their all-time result, results game by game, their account, and every change ever made involving them. Each partner's page shows their statement, payouts, the expenses they paid, and their history.

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
