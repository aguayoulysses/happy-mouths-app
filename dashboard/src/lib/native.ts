// Native niceties that no-op on the web: haptics on key taps, status bar
// style, and the splash screen hand-off.

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

export const isNative = Capacitor.isNativePlatform();

export function tap() {
  if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}
export function success() {
  if (isNative) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}
export function warn() {
  if (isNative) Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
}

export async function bootNative() {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* status bar plugin missing on this platform */
  }
  requestAnimationFrame(() => SplashScreen.hide().catch(() => {}));
}
