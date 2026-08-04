import { supabase } from '../supabaseClient';

// Public key is safe to expose in client code — paste the one from vapid-keys.txt
const VAPID_PUBLIC_KEY = 'BEsoA_6IOPkah7uKtj6kHerCGTArPYgKRw01w24eZfYKA6aO8SETy67PXyYqKOzxZpO8ySDs5nfv8lGWCD6IKwY';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Call this from a button tap (Manager/Admin) to enable push on this device. */
export async function subscribeToPush(staffId: string, staffName: string, role: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push not supported on this browser/device.');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }

  const json = subscription.toJSON() as any;
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      staff_id: staffId,
      staff_name: staffName,
      role,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth
    },
    { onConflict: 'endpoint' }
  );

  if (error) console.error('Failed to save push subscription:', error);
  return !error;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    await subscription.unsubscribe();
  }
}

export async function isPushEnabledOnThisDevice(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

/** Fire-and-forget: sends a push to everyone subscribed with the given role ('Manager' by default). */
export async function notifyManagers(title: string, body: string, url = '/', targetRole = 'Manager') {
  try {
    await supabase.functions.invoke('send-push', {
      body: { title, body, url, targetRole }
    });
  } catch (e) {
    console.warn('notifyManagers failed:', e);
  }
}
