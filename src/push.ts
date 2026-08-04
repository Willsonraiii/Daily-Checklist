import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:you@example.com";

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

Deno.serve(async (req: Request) => {
  try {
    const { title, body, url, targetRole } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let query = supabase.from("push_subscriptions").select("*");
    if (targetRole) query = query.eq("role", targetRole);
    const { data: subs, error } = await query;
    if (error) throw error;

    const payload = JSON.stringify({ title, body, url });

    const results = await Promise.allSettled(
      (subs || []).map((sub: any) =>
        webpush
          .sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          )
          .catch(async (err: any) => {
            // Clean up dead subscriptions (uninstalled app, expired token, etc.)
            if (err.statusCode === 404 || err.statusCode === 410) {
              await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
            }
            throw err;
          })
      )
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    return new Response(JSON.stringify({ sent, failed, total: results.length }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
