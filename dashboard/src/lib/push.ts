import { Capacitor } from "@capacitor/core";
import { PushNotifications, type ActionPerformed } from "@capacitor/push-notifications";
import { Preferences } from "@capacitor/preferences";
import { post, del } from "./api";

const TOKEN_KEY = "hm_push_token";
let wired = false;

export type PushOpen = { kind: "review" | "summary" | "reply" | "call" | "text" | "team" | "customers" | "photos"; phone?: string };

export async function registerPush(onOpen: (o: PushOpen) => void) {
  if (!Capacitor.isNativePlatform()) return;
  if (!wired) {
    wired = true;
    await PushNotifications.addListener("registration", async ({ value }) => {
      await Preferences.set({ key: TOKEN_KEY, value });
      post("/api/v1/push", { token: value, platform: Capacitor.getPlatform() }).catch(() => {});
    });
    await PushNotifications.addListener("registrationError", (e) => console.warn("push registration failed", e));
    await PushNotifications.addListener("pushNotificationActionPerformed", (a: ActionPerformed) => {
      const kind = (a.notification.data?.kind ?? "review") as PushOpen["kind"];
      onOpen({ kind, phone: a.notification.data?.phone ? String(a.notification.data.phone) : undefined });
    });
  }
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return;
  await PushNotifications.register();
}

export async function unregisterPush() {
  if (!Capacitor.isNativePlatform()) return;
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  if (value) {
    await del("/api/v1/push", { token: value }).catch(() => {});
    await Preferences.remove({ key: TOKEN_KEY });
  }
}
