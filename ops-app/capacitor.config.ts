import type { CapacitorConfig } from "@capacitor/cli";
import brand from "../brand.json";

// The team's ops board (ops.<your domain>) as an iPhone app. The board is server-rendered
// Next.js with server actions, so the app loads it live instead of bundling it; www/ only
// holds the page shown when the phone is offline. Sign-in is the board's own: the hm_ops
// cookie lives 400 days in the app's web view, so each person signs in once.
const config: CapacitorConfig = {
  appId: brand.ios.opsAppId,
  appName: `${brand.name} Ops`,
  webDir: "www",
  server: {
    url: `https://ops.${brand.domain}`,
    errorPath: "offline.html",
    // Everything else (Google, client sites) opens in Safari.
    allowNavigation: [`ops.${brand.domain}`],
  },
  ios: {
    contentInset: "never",
    scrollEnabled: true,
    backgroundColor: "#121316",
    appendUserAgent: "HMOpsApp",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 500, backgroundColor: "#121316", launchAutoHide: true, showSpinner: false },
    StatusBar: { style: "LIGHT", overlaysWebView: true },
  },
};

export default config;
