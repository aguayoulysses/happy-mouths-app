# Getting the iOS app on the App Store

The client app (`dashboard/`) is a Capacitor app. The UI ships inside the app bundle and talks to your API over HTTPS. The original version went through six App Review rounds before approval; every rejection and its fix is listed at the bottom so you do not repeat them.

## Before you start

Run `npm run brand` with your `brand.json` filled in (see `docs/HANDOFF.md`, "Make it yours"). That sets the app name, bundle id, URL scheme, signing team and icons. Then follow the steps below for a new listing under your own name.

## One-time setup

1. Apple Developer Program membership, as an organization (needs a D-U-N-S number). Organization accounts show the company as the seller, which App Review expects for a B2B app.
2. In developer.apple.com: register the bundle id with Push Notifications enabled.
3. Create an APNs key (Keys, +, Apple Push Notifications service). Download the .p8 once. Put it in Vercel env: `APNS_KEY` (file contents), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`. Apple allows two APNs keys per team, and one key covers every app on the team.
4. Live pages on your domain: `/privacy`, `/support` (with a support email that works). Both are in `app/privacy` and `app/support`.
5. A demo account for the reviewer (below).

## The demo account (most important part)

The reviewer cannot sign up (accounts are created by you), so they only see what the demo account shows. Rules that got the app approved:

- A pretend business with sample data on **every** screen: customers, sent requests, reviews with replies, texts, invoices, photos. `npm run seed` and `lib/seed-review-demo.ts` build one.
- Set `DEMO_EMAIL` and `DEMO_PASSWORD` in env (the demo login is off without them) and mark the business `demo` on its row so nothing it sends is delivered and booked calls do not hit a real calendar.
- Every feature switch the app has is on for the demo, except anything that needs real paid setup (the phone line). Explain that one in the notes.
- "Delete my account" must actually delete the business and its data. A soft delete was flagged.

## Build and upload

```
cd dashboard
npm install
npm run ios:release        # builds against production (.env.release VITE_API_URL), syncs, opens Xcode
```

In Xcode: target App, Signing and Capabilities, pick your team, automatic signing. Confirm Push Notifications and Background Modes (Audio, Voice over IP, Remote notifications) are present. Bump the build number (`CURRENT_PROJECT_VERSION`) on every upload. Product, Destination Any iOS Device, Archive, Distribute App, App Store Connect, Upload.

From the command line instead:
```
cd dashboard/ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release -archivePath build/App.xcarchive CODE_SIGNING_ALLOWED=NO archive
xcodebuild -exportArchive -archivePath build/App.xcarchive -exportOptionsPlist build/exportOptions.plist -allowProvisioningUpdates
```
(`exportOptions.plist`: method app-store, destination upload, signingStyle automatic, your teamID; `ops-app/ExportOptions.plist` is an example. There is no `.xcworkspace`; use `-project`.)

## App Store Connect listing

Templates to start from (replace the brackets):

- **Subtitle**: `Reviews for local businesses`
- **Description**: "[Name] is the companion app for local businesses that use the [Name] review service. [Name] texts each customer after their visit with a link to the business's review page, follows up if they haven't left one yet, and replies to every review on the business's behalf. This app is how the business owner adds customers and sees the results. You need an active [Name] account to sign in. Accounts are created by [Name] when a business signs up for the service. There is no sign-up in the app." Then one short paragraph per screen.
- **Reviewer notes**: who the app is for and why there is no sign-up; the demo login; one numbered line per screen saying what to tap; a paragraph on per-account tools; the business model paragraph; the push notification list; "Built with Capacitor; the UI ships in the bundle; network calls go to https://[your domain]."

Rules for every field:

- **Name and subtitle**: never a third-party brand ("Google") in either. Description may mention Google Business Profile descriptively.
- **Category**: Business. Price free. No in-app purchase.
- **Description and reviewer notes**: name every screen and every feature in the binary, including per-business switches. Say plainly that a feature that is off is not shown, and why. Anything in the app that the notes do not mention looks like a hidden feature (guideline 5.6).
- **Business model paragraph** in the notes: you sell the service directly to businesses, bill outside the app, the app is free and is the owner's window into a service they already pay for, nothing is sold or unlocked in the app. No prices, "plans", "upgrade" or discount copy inside the app.
- **AI disclosure**: invoices are drafted by Claude (Anthropic). The app shows a one-time permission sheet before anything is sent; mention it in the notes.
- **Calling**: say the app calls customers over VoIP (Twilio Voice + CallKit), which is why it asks for the microphone and declares voip and audio background modes. Attach or link a short screen recording of a call continuing with the app in the background.
- **Availability**: remove China mainland (CallKit is not allowed there).
- **Age rating**: answer Yes to "Messaging and Chat" (the app has a texts inbox and team chat). Rating stays 4+.
- **App Privacy**: Contact info (email, phone, the customers' names and numbers the business adds), User content, Identifiers (user id, device id for push). All linked to the user, none used for tracking or ads, none sold.
- **Screenshots**: 6.9" iPhone (1320 x 2868) and 13" iPad (2048 x 2732), one per screen. `appstore/frame-screenshots.py` frames raw captures.
- The app must run as a native iPad app (it does; do not switch it back to iPhone-only).

## After you submit

- Typical review is 1 to 3 days. Answer every rejection in the Resolution Center point by point.
- After editing metadata on a rejected version, click **Update Review** on the version page first; "Resubmit to App Review" stays disabled until you do.
- A rejected app record cannot be deleted. Fix and resubmit instead.
- TestFlight builds for your own team need no review; use them to test push and calling on a real phone before submitting.

## Rejection history (what triggered each one and the fix)

| Guideline | Trigger | Fix |
|---|---|---|
| 5.6 hidden features (automated flag) | Features in the binary not named in the listing, demo account with empty screens, URLs that 404, account deletion that only flagged the account | Named every screen and switch, real data on every screen, all URLs live, deletion deletes |
| 4.1(c) copycats | "Google" in the subtitle | Brand removed from name, subtitle and keywords |
| 2.3.6 accurate metadata | Age rating said no messaging while the app has a texts inbox | Messaging and Chat set to Yes |
| 5 / CallKit | App available in China | Removed China mainland from availability |
| 2.1(b) business model | "Your plan", "Add to your plan", referral discount copy in Settings | Took pricing and upsell language out of the app, added the business model paragraph |
| 2.5.4 background audio | Reviewer could not see why audio/voip modes were needed | Recording of a live call in the background, explained in notes |
| 2.1(a) iPad | App ran in iPhone compatibility mode, sign-in slow on iPad | Shipped as a native iPad app |
