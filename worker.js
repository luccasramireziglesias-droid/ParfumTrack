// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Worker Entry Point
// Maneja rutas API y sirve assets estáticos
// ══════════════════════════════════════════════════════════════

import { onRequestPost as sendNotification } from "./functions/send-notification.js";
import { onRequestPost as validateLicense } from "./functions/validate-license.js";
import { onRequestPost as sendEmail } from "./functions/send-email.js";
import {
  onRequestPost as backupPost,
  onRequestGet as backupGet,
} from "./functions/backup.js";
import { onRequestPost as trial } from "./functions/trial.js";
import {
  onRequestPost as syncPost,
  onRequestGet as syncGet,
} from "./functions/sync.js";

const API_ROUTES = [
  "/send-notification",
  "/validate-license",
  "/send-email",
  "/backup",
  "/trial",
  "/sync",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (API_ROUTES.includes(path)) {
      const context = { request, env, ctx };

      if (request.method === "OPTIONS") {
        const origin = request.headers.get("Origin") || "";
        const allowed =
          /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|parfumtrack\.workers\.dev)(:\d+)?$/.test(
            origin,
          )
            ? origin
            : "null";
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": allowed,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (path === "/send-notification") return sendNotification(context);
      if (path === "/validate-license") return validateLicense(context);
      if (path === "/send-email") return sendEmail(context);
      if (path === "/trial") return trial(context);

      if (path === "/backup") {
        if (request.method === "POST") return backupPost(context);
        if (request.method === "GET") return backupGet(context);
        return new Response("Method Not Allowed", { status: 405 });
      }

      if (path === "/sync") {
        if (request.method === "POST") return syncPost(context);
        if (request.method === "GET") return syncGet(context);
        return new Response("Method Not Allowed", { status: 405 });
      }

      return new Response("Method Not Allowed", { status: 405 });
    }

    // Todo lo demás → servir assets estáticos (index.html, sw.js, etc.)
    return env.ASSETS.fetch(request);
  },
};
