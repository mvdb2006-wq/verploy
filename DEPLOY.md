# Verploy — Deployment Guide
## Supabase → Vercel → Live in ~30 minutes

---

## Step 1: Supabase (database)

### 1a. Create project
1. Go to https://supabase.com → "New project"
2. Name: `verploy-production`
3. Database password: generate a strong one, save it somewhere safe
4. Region: **West EU (Ireland)** — closest to your NL/DE users
5. Click "Create new project" — wait ~2 minutes

### 1b. Run the schema
1. In Supabase: SQL Editor → "New query"
2. Paste the entire contents of `supabase/schema.sql`
3. Click "Run" — you should see "Success"

### 1c. Save your keys
Go to Settings → API. You need:
- **Project URL**: `https://xxxx.supabase.co`
- **anon public key**: starts with `eyJ...`
- **service_role key**: starts with `eyJ...` (keep this secret!)

### 1d. Enable Email auth
Go to Authentication → Providers → Email → Enable "Email"
Optionally disable "Confirm email" during development.

---

## Step 2: Stripe (payments)

### 2a. Create account
1. Go to https://stripe.com → create account
2. Complete business verification (you'll need KvK number)

### 2b. Create products
In Stripe Dashboard → Products → "Add product":

**Product: Verploy Starter**
- Monthly price: €29.00 / month (recurring)
- Yearly price: €278.00 / year (recurring)
- Save the price IDs (price_xxx)

**Product: Verploy Agency**  
- Monthly: €79.00 / month
- Yearly: €758.00 / year

**Product: Verploy Pro**
- Monthly: €199.00 / month
- Yearly: €1,910.00 / year

### 2c. Configure portal
Stripe → Settings → Billing → Customer portal → Enable

### 2d. Set up webhook
Stripe → Developers → Webhooks → "Add endpoint"
- URL: `https://app.verploy.com/api/stripe/webhook`
- Events to listen:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Save the "Signing secret" (whsec_xxx)

---

## Step 3: GitHub

### 3a. Create repository
1. Go to https://github.com/new
2. Name: `verploy-dashboard`
3. Private repository
4. Don't add README (we already have files)

### 3b. Push the code
```bash
cd /home/claude/verploy/dashboard
git init
git add .
git commit -m "Initial Verploy dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/verploy-dashboard.git
git push -u origin main
```

---

## Step 4: Vercel (hosting)

### 4a. Import project
1. Go to https://vercel.com → "Add New Project"
2. Import from GitHub → select `verploy-dashboard`
3. Framework: Next.js (auto-detected)
4. Root directory: `dashboard` (important!)

### 4b. Set environment variables
In Vercel → project → Settings → Environment Variables, add ALL of these:

```
NEXT_PUBLIC_SUPABASE_URL          = https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     = eyJ...
SUPABASE_SERVICE_ROLE_KEY         = eyJ...
NEXT_PUBLIC_APP_URL               = https://app.verploy.com
STRIPE_SECRET_KEY                 = sk_live_...
STRIPE_WEBHOOK_SECRET             = whsec_...
STRIPE_PRICE_STARTER_MONTHLY      = price_...
STRIPE_PRICE_STARTER_YEARLY       = price_...
STRIPE_PRICE_AGENCY_MONTHLY       = price_...
STRIPE_PRICE_AGENCY_YEARLY        = price_...
STRIPE_PRICE_PRO_MONTHLY          = price_...
STRIPE_PRICE_PRO_YEARLY           = price_...
RESEND_API_KEY                    = re_...
RESEND_FROM_EMAIL                 = hello@verploy.com
WORKER_SECRET                     = (generate: openssl rand -hex 32)
```

### 4c. Deploy
Click "Deploy" — first deploy takes ~2 minutes.

### 4d. Add custom domain
Vercel → project → Settings → Domains:
- Add: `app.verploy.com`
- Vercel gives you DNS records to add at Vimexx

### 4e. DNS at Vimexx
After domain is registered at Vimexx:
1. Go to Vimexx → Mijn Vimexx → Domeinen → verploy.com → DNS
2. Add a CNAME record:
   - Name: `app`
   - Value: `cname.vercel-dns.com`
3. Add the root A-records Vercel provides (for verploy.com → landing page)

---

## Step 5: Railway (Playwright worker)

### 5a. Create account
Go to https://railway.app → sign in with GitHub

### 5b. Deploy worker
1. New Project → "Deploy from GitHub repo"
2. Select `verploy-worker` repository (we'll create this next)
3. Railway auto-detects Node.js

### 5c. Set environment variables on Railway
```
SUPABASE_URL              = (same as above)
SUPABASE_SERVICE_ROLE_KEY = (same as above)
WORKER_SECRET             = (same as NEXT_PUBLIC_APP_URL secret)
OPENAI_API_KEY            = sk-... (for AI diagnosis)
PORT                      = 3001
```

### 5d. Get the Railway URL
After deploy, Railway gives you a URL like:
`https://verploy-worker-production.up.railway.app`

Add this to Vercel env vars:
```
WORKER_URL = https://verploy-worker-production.up.railway.app
```

---

## Step 6: First agency account

1. Go to `https://app.verploy.com/login`
2. Use Supabase → Authentication → "Invite user" to create your account
3. In Supabase SQL editor, run:

```sql
-- After you've signed up, find your user ID:
SELECT id, email FROM auth.users;

-- Then create your agency and link yourself as owner:
INSERT INTO agencies (name, slug, plan, plan_sites_limit)
VALUES ('EM Hosting en Design', 'em-hosting', 'agency', 50)
RETURNING id;

-- Replace <agency_id> and <user_id> with the actual UUIDs:
INSERT INTO agency_members (agency_id, user_id, role)
VALUES ('<agency_id>', '<user_id>', 'owner');
```

4. Refresh the dashboard — you're in.

---

## Step 7: Install the WordPress connector plugin

1. In the dashboard → Settings → copy the API key for a site
2. In WordPress admin → Plugins → Upload the `verploy-connector` plugin
3. Activate → Settings → paste API key
4. The first heartbeat arrives within 1 minute

---

## Done! 🎉

Your setup:
- `verploy.com` → landing page (deploy separately or use a simple HTML page)
- `app.verploy.com` → dashboard (Vercel)
- Supabase → database + auth + storage
- Railway → Playwright test workers
- Stripe → billing (with iDEAL, SEPA, card)
- Resend → transactional emails

**Total monthly cost at launch (before revenue):**
- Supabase Free: €0
- Vercel Hobby: €0
- Railway Starter: ~€5
- Resend Free: €0
- **Total: ~€5/month**
