# How the whole system works

This is the full handoff for the codebase. Read this first, then `docs/REVIEW-SYSTEM.md` (the review texts and pictures, step by step) and `docs/APP-STORE.md` (getting the iOS app approved under your own Apple account).

The code is white-label. Your company name, domain, colors, logo and team live in **`brand.json`** and **`brand-assets/`**, and one command (`npm run brand`) puts them everywhere. See "Make it yours" below.

## What the product is

A done-for-you review and customer-texting service for local service businesses, sold B2B. The business owner never sets anything up. You (the operator) create their account, connect their Google Business Profile and texting line, and the system then:

1. Texts each customer the owner adds a review request with a tracked link (`/r/<code>` records the tap, then sends them straight to Google's review box).
2. Follows up on a schedule if they have not reviewed yet.
3. Pulls Google reviews every hour, matches each one to the customer who left it, marks them "reviewed" and stops their follow-ups.
4. Writes and posts a reply to every review with Claude (per business, switchable).
5. Pushes the owner a notification for new reviews, customer texts and missed calls.

Optional per-business features, each a switch on the business in the ops board (off by default): business phone line with in-app calling, two-way texting inbox, AI invoices and quotes, photo drip to the Google profile, missed-call text back.

## The surfaces

| Surface | Who uses it | Where in the code | URL |
|---|---|---|---|
| Home page | anyone | `app/page.tsx` (a simple placeholder: name, sign-in, privacy, support) | yourdomain.com |
| Sales demo | prospects, on a screen share | `app/reviewpitch` (walks through the texts a customer gets) | yourdomain.com/reviewpitch |
| Client app (web + iOS) | business owners | `dashboard/` (Vite + React). The web build is served at `/app`; the same code is the iOS app via Capacitor in `dashboard/ios` | yourdomain.com/app and the App Store |
| Ops board | your team | `app/admin`: Dashboard, All clients, Messages, Reviews, System | ops.yourdomain.com (`proxy.ts` sends the ops host to `/admin`) |
| Welcome page | new clients | `app/welcome` (their login, what their customers get, how to reach you) | yourdomain.com/welcome/<token> |
| Privacy, Support | everyone, App Review | `app/privacy`, `app/support` | needed for the App Store listing |

Plus `ops-app/`: a thin iPhone wrapper around the ops board, for TestFlight internal testing only (see its README).

All of it is one Next.js app, one Vercel project and one database.

## Code map

- `app/api/v1/*`: the API the client app calls (login, customers, requests, reviews, conversations, calls, voice, photos, documents, push, settings, team chat, account deletion).
- `app/api/cron/*`: scheduled jobs. Schedule is in `vercel.json`. Each logs to `cron_runs`; the ops System page shows when each last ran.
- `app/api/sms`, `app/api/voice`, `app/api/hooks/[provider]`, `app/api/lead`: inbound webhooks (Twilio texts and calls, booking/payment tools, website lead forms).
- `app/r/[code]`: the tracked review link.
- `app/d/[token]`, `app/api/doc-pdf`: invoices and quotes the owner texts to customers.
- `lib/db.ts`: the whole database schema. Tables are created with `CREATE TABLE IF NOT EXISTS` and changed only by appending to the `ALTER TABLE` list, applied automatically on first use. No migration tool to run.
- `lib/sequence.ts`, `lib/requests.ts`, `lib/sms.ts`, `lib/twilio.ts`: the review request sequence and texting.
- `lib/reviews.ts`, `lib/gbp.ts`, `lib/ai.ts`: Google review sync, matching and AI replies.
- `lib/poster.ts`, `lib/poster-render.ts`, `lib/poster-assets/`: the pictures in the review texts.
- `lib/voice.ts`, `dashboard/plugins/hm-voice`: phone line (Twilio Voice iOS SDK + CallKit).
- `lib/push.ts`: Apple push notifications.
- `lib/health.ts`: per-client health flags (At risk / Watch / Healthy) and the System page.
- `lib/whitelabel.ts` (server) and `dashboard/src/brand.ts` (app): read `brand.json`.
- `lib/i18n.ts`: Spanish for the ops board (EN / ES switch at the foot of the sidebar).
- `lib/imessage.ts`, `lib/sales.ts`, `lib/meta-leads.ts`: optional extras with no screens in this copy (an iMessage line through BlueBubbles, lead tracking, your own Meta lead ads texting your phone). Leave them off unless you want them.
- `scripts/`: one-off tools. `brand.mjs` (rebrand), `seed-demo.ts` (demo data), `gbp-oauth.ts` and `calendar-oauth.ts` (mint Google refresh tokens), `new-poster-template.py`, `preview-poster.ts`, `send-test-poster.ts`, `test-push.ts`.

## Make it yours

1. Edit **`brand.json`**: `name`, `legalName`, `domain`, `supportEmail`, `supportPhone`, `colors` (the highlight color used across the site, ops board and app), `ios.appId` / `ios.opsAppId` / `ios.urlScheme` / `ios.teamId` (your Apple team id), `welcomeVideo` (URL of your onboarding video, or blank to hide that card) and `team` (the people clients chat with in the app).
2. Put your images in **`brand-assets/`**:
   - `mark.png`: square logo, 1024 x 1024 or bigger. Without it, a circle with your initials is used.
   - `team/<key>.png`: a photo for each person in `team` (key from brand.json). Without one, their initials are used.
3. Run **`npm run brand`**. It writes the favicon, header logos, app icons and iOS splash screens, and sets the iOS app name, bundle id, URL scheme and signing team in both Xcode projects.
4. Replace the sample photos in `lib/poster-assets/` (`demo.jpg` sign photo and `demo-sad.jpg` meme, used by the demo account and the Pictures preview) and in `public/reviewpitch/` (the sales demo) with your own. The sales demo text lives in `app/reviewpitch/page.tsx`.
5. Read `app/privacy/page.tsx` and `app/support/page.tsx` once. They use your name and email, but the wording is yours to own.

## Outside services you need your own accounts for

| Service | What it does here | Env vars |
|---|---|---|
| Vercel | hosting, crons, Blob storage for uploads | (project settings) |
| Turso | the database (libSQL). A local file works for development | `DATABASE_URL`, `DATABASE_AUTH_TOKEN` |
| Twilio | every text and call. A parent account plus one subaccount per client with their own line; a house Messaging Service for clients without one | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_HM_MESSAGING_SERVICE_SID` |
| Google Cloud | Business Profile APIs (reviews, replies, photos, metrics) and Calendar. Needs Google's Business Profile API access approval on your Cloud project | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GBP_REFRESH_TOKEN`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` |
| Anthropic | review replies, review matching, invoice drafting | `ANTHROPIC_API_KEY` |
| Apple Developer ($99/yr) | iOS app, push notifications | `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID`, `APNS_SANDBOX` |

Other env vars: `BASE_URL` / `NEXT_PUBLIC_BASE_URL` (your domain), `ADMIN_PASSWORD` (ops board), `CRON_SECRET`, `SMS_DRY_RUN` (true = log texts instead of sending), `HM_LEAD_ALERT_PHONES` (your team's cells for internal alerts) + `HM_LEAD_ALERT_FROM` (slug of the business whose line sends them), `SUPPORT_BOOKING_URL`, `GBP_DRIP_EVERY_DAYS`, `DEMO_SEED` / `DEMO_EMAIL` / `DEMO_PASSWORD` (the App Review demo login; it is off until `DEMO_PASSWORD` is set), `HM_DEMO`, `POSTER_API_URL` / `POSTER_API_KEY` (optional external image API). `.env.example` has the core set with comments.

## Run it locally

```
npm install
cp .env.example .env.local      # fill what you have; SMS_DRY_RUN=true keeps texts from sending
npm run brand                   # your name, logo and colors
npm run seed                    # demo business with sample data
npm run dev                     # http://localhost:3016  (ops board at /admin, client app at /app)
```

The client app on its own with hot reload: `cd dashboard && npm install && npm run dev`.

## Deploy

1. Create a Vercel project from this repo, add the env vars above (production), attach your domain plus an `ops.` subdomain.
2. Create a Turso database and put its URL and token in env. Tables create themselves on first request.
3. Deploy (`vercel --prod`, or connect the repo so pushes to `main` deploy). The build compiles the client app into `public/app` first, then Next.js.
4. Crons start on their own from `vercel.json` (Vercel Pro is needed for crons more frequent than daily).

## Onboarding a client, in order

1. Ops board, + New client. This creates the business and the owner's app login.
2. The owner adds your Google account as a manager on their Business Profile. Put the account and location ids on the business, then Sync Google reviews.
3. Texting: house line by default. For their own number, buy a Twilio number in a subaccount, create a Messaging Service, and register an A2P 10DLC campaign (brand legal name, website and opt-in page must match). "Set up phone line" on the client's page wires calls.
4. Pictures: sign photo and crying meme, then a test (see `docs/REVIEW-SYSTEM.md`).
5. Website (optional): a client site can rewrite `/review/:code`, `/q/:token` and `/api/doc-pdf/:token` to this app so links show their own domain, and can pull reviews from `/api/public/reviews/<slug>` at build time.
6. Turn on the features they pay for (phone, texts, invoices, photos), then Send welcome.
7. The owner installs the app and adds customers. Review requests start going out.

## Things that will bite you

- **One Google account runs everything.** The refresh token in `GBP_REFRESH_TOKEN` reads and replies to every client's reviews. Publish your Google OAuth consent screen to Production, or the token dies after 7 days.
- **Never delete the `voip` and `audio` background modes** from `dashboard/ios/App/App/Info.plist`. Without `voip`, in-app calls fail on real phones with CallKit error 1.
- **Schema changes are append-only.** Add new `ALTER TABLE` lines at the end of the list in `lib/db.ts`; never edit old ones.
- **Demo businesses never send.** A business marked `demo` logs texts and calls without delivering them. That keeps the App Review demo account safe.
- **Review texts are hidden from owners.** Automated messages are flagged `automated=1` and only show in the ops board, on purpose.
- **A2P registration is slow.** Budget 1 to 3 weeks per client number. The house line covers clients while they wait.
