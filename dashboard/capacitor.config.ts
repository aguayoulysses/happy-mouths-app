import type { CapacitorConfig } from "@capacitor/cli";
import brand from "../brand.json";

const config: CapacitorConfig = {
  appId: brand.ios.appId,
  appName: brand.name,
  webDir: "dist",
  ios: {
    // The page paints under the status bar and handles insets itself with
    // env(safe-area-inset-*). "always" would shove the whole document down
    // and make fixed bars jump on scroll.
    contentInset: "never",
    scrollEnabled: true,
    backgroundColor: "#ffffff",
  },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: "#ffffff", launchAutoHide: true, showSpinner: false },
    StatusBar: { style: "LIGHT", overlaysWebView: true },
    // Without this iOS swallows a push that lands while the app is open.
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
