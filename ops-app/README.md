# Ops iPhone app

Capacitor shell around `https://ops.<domain from brand.json>` (bundle id `ios.opsAppId` in brand.json).
The board is server-rendered Next.js, so the app loads it live; `www/offline.html` is the only bundled page.
Phone layout (bottom tabs + "More" sheet) lives in the board itself: `app/admin/MobileTabs.tsx`.
Any change to the board ships with a normal deploy; a new app build is only needed for icon, name or native config.

## Build & upload (needs Xcode)
```
npm run brand            # from the repo root: icons, name, bundle id, team
cd ops-app && npm install && npx cap sync ios && npx cap open ios
```
Xcode: target App → Signing (your team) → Product › Archive → Distribute App → TestFlight & App Store.

## Distribution
Internal team tool with real client data, so it goes out through **TestFlight internal testing**
(App Store Connect → the app → TestFlight → Internal Testing → add the team's Apple IDs). No App Review,
no public listing. Builds expire after 90 days: re-archive with a higher build number.
A public App Store listing would likely be rejected under 4.2 (web wrapper) / 3.2 (internal business app).
