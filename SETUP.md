# Setup: Supabase, sign-in and deployment (Vercel or Netlify)

This takes about 15 minutes. You (the app owner) create everyone's account and every organization from inside the app. Everyone signs in with a **username** and a password of any length. No email setup is needed.

You'll need:

- a free [Supabase](https://supabase.com) account
- a free [Vercel](https://vercel.com) **or** [Netlify](https://netlify.com) account
- a GitHub account (for automatic deploys)
- Node.js 20.19 or newer (only for running it on your own computer)

---

## 1. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Pick a name, set a strong database password (save it in your password manager), and choose the region closest to you.
3. Click **Create new project** and wait about a minute for it to start.

## 2. Create the database

1. In the project, open **SQL Editor** in the left sidebar and click **New query**.
2. Paste all of [`supabase/migrations/20261013000000_schema.sql`](supabase/migrations/20261013000000_schema.sql) and click **Run**. You should see **Success. No rows returned**.
3. Click **New query** again. Paste all of [`supabase/migrations/20261014000000_owner_accounts.sql`](supabase/migrations/20261014000000_owner_accounts.sql) and click **Run**.
4. Click **New query** once more. Paste all of [`supabase/migrations/20261015000000_rake_and_discounts.sql`](supabase/migrations/20261015000000_rake_and_discounts.sql) and click **Run**.
5. And one last time: [`supabase/migrations/20261016000000_usernames_dealers_history.sql`](supabase/migrations/20261016000000_usernames_dealers_history.sql), then **Run**.

These four files create every table, the security rules, the owner tools, dealer-round rake, per-player loss discounts, usernames, dealer accounts and the owner-only history. Run them in this order, each one once.

> **Upgrading from email sign-in?** The fourth file switches everyone to usernames. **The owner's username is `avayani`** and the password stays the same. Everyone else gets a username made from their old email (for `jordan@gmail.com` it's `jordan`). You can see and change them all in **Admin → Accounts**.

> Already ran some of them? Just run the ones you haven't, in order. Each one upgrades what's there, and nothing is lost. If you run one twice it stops with "already installed" and changes nothing.

## 3. Configure sign-in

Go to **Authentication → Sign In / Providers**:

1. **Email provider:** leave it **enabled**. (Usernames sign in through it behind the scenes.)
2. **Allow new users to sign up:** turn it **off**. Accounts are created only by you, from **Admin**, inside the database, so nobody else can make one.
3. **Confirm email:** doesn't matter. Accounts you create are ready to use immediately, and no emails are ever sent.

Supabase's own minimum password length doesn't apply: passwords are set by the app, and any length works.

## 4. Create your owner account

**The first account in the project becomes the app owner.** Make sure it's yours.

1. Go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a password, and tick **Auto Confirm User**.
3. Click **Create user**.

Sign in to the app with that email and password the first time (the Username box takes an email too). Your username is the part of the email before the @; change it in **Admin → Accounts → you**.

> Already have accounts in the project? Your **earliest** account is the owner, and after the fourth file its username is **`avayani`**. Sign in with `avayani` and your existing password, and you'll see **Admin**.

## 5. Copy your API keys

1. Open **Project Settings → API Keys** (or click **Connect** at the top of the dashboard).
2. Copy the **Project URL**, for example `https://abcd1234.supabase.co`.
3. Copy the **anon / publishable key**. Either the `anon` key or the newer `sb_publishable_…` key works.

These two values are meant to be public: they're baked into the website, and the database's security rules protect the data.

> Never use the `service_role` / secret key in this app.

## 6. Run it on your computer (optional)

Copy the example settings file:

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Then install:

```bash
npm install
```

And start the app:

```bash
npm run dev
```

Open http://localhost:5180 and sign in with your owner account. Then go to **First steps in the app** below.

## 7. Deploy

First, put the code on GitHub. Create an empty repository on github.com, then run these commands one at a time:

```bash
git init
```

```bash
git add -A
```

```bash
git commit -m "Poker Ledger"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/YOUR-USERNAME/poker-ledger.git
```

```bash
git push -u origin main
```

`.env.local` is ignored by git, so your keys don't get pushed.

### Option A: Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repository. Vercel detects **Vite** automatically from `vercel.json`.
2. Open **Environment Variables** and add:
   - `VITE_SUPABASE_URL`: your Project URL
   - `VITE_SUPABASE_ANON_KEY`: your anon / publishable key
   - `VITE_AUTH_GOOGLE`: leave it out (Google sign-in isn't used with usernames)
3. Click **Deploy**.
4. Copy the production address (for example `https://poker-ledger.vercel.app`).
5. Open the address and sign in with your owner account.

### Option B: Netlify

1. Go to [app.netlify.com](https://app.netlify.com) and click **Add new project** (older accounts: **Add new site**) **→ Import an existing project → GitHub**, then pick the repository. The build settings are read from `netlify.toml`.
2. Before deploying, open **Add environment variables** and add the same variables as for Vercel.
3. Click **Deploy**.
4. Open the site address (for example `https://poker-ledger.netlify.app`) and sign in.

### On either host

- Every push to `main` redeploys automatically.
- The `VITE_…` variables are built into the site. **After changing one, trigger a new deploy.**
- `vercel.json` and `netlify.toml` already handle the rest:
  - page routes like `/games/123` and `/sample` (all served by `index.html`)
  - the app manifest, icons and iPhone launch screens in `public/`
  - long-term caching of assets
  - security headers: a Content-Security-Policy, no framing, HTTPS-only
- The CSP allows connections only to `*.supabase.co`. If you later put Supabase behind a custom domain, add it to `connect-src` in both files.

## 8. Google sign-in (not used)

Everyone signs in with a username, and sign-ups are off, so Google sign-in isn't needed. Leave `VITE_AUTH_GOOGLE` unset.

## 9. Put it on your phone's home screen

Once it's deployed, each person does this once on their own phone.

**iPhone (Safari):**

1. Open your live site (for example `https://poker-ledger.vercel.app`) in **Safari**. Other iPhone browsers work too on iOS 16.4+, but Safari is the most reliable.
2. Tap the **Share** button (the square with the arrow), scroll down and tap **Add to Home Screen**.
3. Leave the name as **Poker Ledger** and tap **Add**.
4. Open it from the home screen. It runs full screen with the Poker Ledger icon and launch screen, like an installed app.
5. **Sign in once inside the home-screen app.** iPhones keep home-screen apps separate from Safari, so being signed in in Safari doesn't carry over.

**Android (Chrome):** open the site, tap **⋮ → Add to Home screen** (or **Install app**).

**Mac / PC (Chrome or Edge):** click the install icon at the right of the address bar.

Updates arrive by themselves: every time you deploy, the app picks up the new version the next time it's opened. If you change the logo, replace `branding/poker-ledger-logo.png`, run `python3 scripts/make-app-icons.py`, and deploy. Phones that already added the app may need to remove and re-add it to see a new icon.

---

## First steps in the app

Signed in as the owner, tap your chip avatar (top right) and choose **Admin**. You'll also land there automatically if you're not in any organization yet.

1. **Create accounts.** Go to **Admin → Accounts → Create an account**:
   - Enter their name, a **username** (their login) and a password of any length. **Generate** makes one for you.
   - Optionally put them straight into an organization.
   - You'll get a ready-to-send message with their username and password. **Copy** or **Share** it to them.
   - Only you can do this. Org admins and organizers can't create accounts, set passwords or see other people's logins.
2. **Create organizations.** Go to **Admin → Organizations → New organization**:
   - Give it a name, and pick **who runs it** (yourself, or an account you made). That person becomes its admin.
3. **Put people in organizations.** Go to **Admin → Organizations → tap one**. From there you can:
   - add any account as Organizer or Admin
   - tap a role to switch it
   - pause or remove someone
4. **Forgotten password?** Go to **Admin → Accounts → tap the person → Set a new password**, then send them the new one. You can change their **username** there too.
5. **Blocking someone:** **Admin → Accounts → tap them → Block this account** cuts their access everywhere at once. Their history stays.
6. **See everything that happened:** **Admin → History** (or **History** in the bottom bar for the organization you're in). Every action by every account, to the second: buy-ins, rounds, edits, deletes, members, accounts created or changed, password changes (never the passwords) and every sign-in. **Only you can see it, and nobody can edit or delete it**, not even you.

People change their own password (any length, after typing their current one) and display name from the account menu (tap their avatar → **Change password** / **Your name**).

### Try it with a demo organization (optional)

Want to see the app full of realistic data before your first real night? In Supabase → **SQL Editor → New query**, paste all of [`supabase/demo/demo_create.sql`](supabase/demo/demo_create.sql) and click **Run**.

- It adds one organization, **Demo · Riverside Card Club**, with you as its admin: 14 made-up players, 3 dealers, 3 partners, 8 ended games (with dealer rounds, discounts, expenses and payouts) and 2 tables running right now.
- Your real organizations, players, games and accounts aren't touched, and no logins are created.
- Switch to it from your avatar menu (**Switch to Demo · Riverside Card Club**).
- When you're done, run [`supabase/demo/demo_remove.sql`](supabase/demo/demo_remove.sql) the same way. It deletes the demo organization and everything in it, and nothing else. Its history stays (history is never deleted).

---

## How accounts and organizations work

- **Owner (you):** creates accounts and organizations and decides who's in each one, all from **Admin** in the app.
- **Account:** one person's login: a username and a password. Only you create them. They can never create accounts themselves.
- **Organization:** one poker operation. It has its own:
  - games, players, dealers and partners, each with a ledger account
  - house rules (tip tax %, loss discount %)

  Organizations are completely separate: the database refuses to show or change another organization's data.
- **One person, several organizations:** someone can be in more than one organization and switch from the account menu.
- **Members, players, dealers and partners:**
  - *Members* log in and run the app.
  - *Players*, *dealers* and *partners* don't log in. Each has an account with a ledger (People and Partners tabs).
  - Someone can be both a member and a partner.
- **The history** is the owner's record of everything. Members never see it.

### Roles

| | Owner | Org admin | Organizer |
|---|---|---|---|
| Create accounts, change usernames, set passwords, approve or block | ✓ | | |
| See the history (every action, who did it, when) | ✓ | | |
| Create organizations; manage anyone's membership | ✓ | | |
| Add members (existing accounts) to *their* organization; change roles; pause or remove | ✓ | ✓ | |
| Partners, profit shares, payouts, house rules | (if admin there) | ✓ | |
| Reopen or delete ended games; delete players | (if admin there) | ✓ | |
| Run games, players, dealers, payments; see ledgers | (if member) | ✓ | ✓ |

The owner doesn't automatically see an organization's games: add yourself to it if you want to. Every organization always keeps at least one admin.

## Troubleshooting

| Problem | Fix |
|---|---|
| "… upgrade (file name) is already installed" | That file already ran. Nothing changed; the message names the next file to run, if any. |
| The Add to Home Screen icon is a screenshot, or the app opens with Safari's address bar | Open the live **https** address (not a preview link), wait for it to load fully, then add it again. Delete the old home-screen icon first. |
| `relation "profiles" already exists` when running the first file | Open **Table Editor**. If you see `organizations`, `games` and `memberships`, the schema already ran and you're done (it was run twice). If you only see a `profiles` table, the project came with one from a starter template. Use a fresh project, or (only if you don't need that table) run `drop trigger if exists on_auth_user_created on auth.users; drop table if exists public.profiles cascade;` and then run the schema again. |
| "Wrong username or password" right after the fourth file | The owner's username is now `avayani` (same password). Others: look up their username in **Admin → Accounts**, or set a new password there. |
| "permission denied for table users" when creating an account | Run the fourth file again in the SQL Editor (it creates the account tools with the right permissions), or check that you ran it as the default `postgres` user. |
| I don't see **Admin** | Only the owner (the first account in the project) has it. Check that you're signed in with that account. |
| Someone sees "Waiting for approval" | Approve them in **Admin → Accounts**, then add them to an organization. |
| Someone sees "Almost there" | Their account is fine. Add them to an organization (Admin, or their org admin via **Org → Add**). |
| "Supabase isn't configured" on the live site | The `VITE_SUPABASE_*` variables are missing on the host. Add them and **redeploy**. |
| "Not allowed…" when saving | Your role can’t do that (see the table above), or the game has ended. |

## For developers

- Run the database tests against a **throwaway local Postgres**, never your real project:

  ```bash
  PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres npm run test:db
  ```

- Run the app tests:

  ```bash
  npm test
  ```

- Changing the database later: add a new file in `supabase/migrations/` and run it in the SQL Editor. Don't edit the original once it's live.
