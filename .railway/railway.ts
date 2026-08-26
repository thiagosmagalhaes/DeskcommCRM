import { defineRailway, group, image, project, redis, service, volume } from "railway/iac";

/**
 * Stack Railway equivalente ao docker-compose.prod.yml.
 *
 * As imagens próprias usam `stable` somente para montar e validar o projeto que
 * dará origem ao template. Antes de PUBLICAR o template para clientes, a
 * release deve trocar as quatro referências pelo mesmo X.Y.Z imutável.
 */
export default defineRailway((ctx) => {
  const cache = redis("Redis");
  const sessoesWaha = volume("Sessões do WhatsApp", {
    region: "us-east4-eqdc4a",
    sizeMB: 1024,
  });
  const midiasWaha = volume("Mídias do WhatsApp", {
    region: "us-east4-eqdc4a",
    sizeMB: 1024,
  });

  const srh = service("RedisRest", {
    source: image(
      "hiett/serverless-redis-http@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150",
    ),
    env: {
      SRH_MODE: "env",
      SRH_TOKEN: ctx.shared.SRH_TOKEN,
      SRH_CONNECTION_STRING: cache.env.REDIS_URL,
    },
  });

  const waha = service("WAHA", {
    source: image("devlikeapro/waha:latest-2026.7.2"),
    replicas: 1,
    volumeMounts: {
      "/app/.sessions": sessoesWaha,
      "/app/.media": midiasWaha,
    },
    env: {
      WAHA_API_KEY: "sha512:${{shared.WAHA_API_KEY_SHA512}}",
      WHATSAPP_HOOK_URL: "http://${{App.RAILWAY_PRIVATE_DOMAIN}}:3000/api/v1/webhooks/waha",
      WHATSAPP_HOOK_EVENTS:
        "message.any,message.ack,message.edited,message.revoked,session.status,state.change",
      WHATSAPP_HOOK_HMAC: ctx.shared.WAHA_HMAC_SECRET,
      WHATSAPP_DEFAULT_ENGINE: "NOWEB",
      WHATSAPP_RESTART_ALL_SESSIONS: "True",
      WAHA_DASHBOARD_ENABLED: "false",
    },
  });

  const app = service("App", {
    source: image("ghcr.io/melgarafael/deskcommcrm:stable", {
      autoUpdates: { type: "disabled" },
    }),
    replicas: 1,
    env: {
      NODE_ENV: "production",
      PORT: "3000",
      NEXT_PUBLIC_APP_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      NEXT_PUBLIC_ADMIN_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      NEXT_PUBLIC_SUPABASE_URL: ctx.shared.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ctx.shared.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: ctx.shared.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_DB_URL: ctx.shared.SUPABASE_DB_URL,
      INTERNAL_SECRET: ctx.shared.INTERNAL_SECRET,
      INTERNAL_CRON_SECRET: ctx.shared.INTERNAL_SECRET,
      CPF_ENCRYPTION_KEY: ctx.shared.CPF_ENCRYPTION_KEY,
      WAHA_BYO_ENCRYPTION_KEY: ctx.shared.WAHA_BYO_ENCRYPTION_KEY,
      AI_CRED_AES_KEY: ctx.shared.AI_CRED_AES_KEY,
      WAHA_API_BASE_URL: "http://${{WAHA.RAILWAY_PRIVATE_DOMAIN}}:3000",
      WAHA_API_KEY: ctx.shared.WAHA_API_KEY,
      WAHA_HMAC_SECRET: ctx.shared.WAHA_HMAC_SECRET,
      WAHA_WEBHOOK_BASE_URL: "http://${{App.RAILWAY_PRIVATE_DOMAIN}}:3000",
      UPSTASH_REDIS_REST_URL: "http://${{RedisRest.RAILWAY_PRIVATE_DOMAIN}}:80",
      UPSTASH_REDIS_REST_TOKEN: ctx.shared.SRH_TOKEN,
      AI_GATEWAY_API_KEY: ctx.shared.AI_GATEWAY_API_KEY,
      OPENROUTER_API_KEY: ctx.shared.OPENROUTER_API_KEY,
      ANTHROPIC_API_KEY: ctx.shared.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: ctx.shared.OPENAI_API_KEY,
    },
  });

  const worker = service("Worker", {
    source: image("ghcr.io/melgarafael/deskcomm-worker:stable", {
      autoUpdates: { type: "disabled" },
    }),
    replicas: 1,
    env: {
      SUPABASE_DB_URL: ctx.shared.SUPABASE_DB_URL,
      NEXT_PUBLIC_SUPABASE_URL: ctx.shared.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: ctx.shared.SUPABASE_SERVICE_ROLE_KEY,
      WAHA_API_BASE_URL: "http://${{WAHA.RAILWAY_PRIVATE_DOMAIN}}:3000",
      WAHA_API_KEY: ctx.shared.WAHA_API_KEY,
      AI_GATEWAY_API_KEY: ctx.shared.AI_GATEWAY_API_KEY,
      OPENROUTER_API_KEY: ctx.shared.OPENROUTER_API_KEY,
      ANTHROPIC_API_KEY: ctx.shared.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: ctx.shared.OPENAI_API_KEY,
      HEALTH_PORT: "8787",
    },
  });

  const scheduler = service("Scheduler", {
    source: image("ghcr.io/melgarafael/deskcomm-scheduler:stable", {
      autoUpdates: { type: "disabled" },
    }),
    replicas: 1,
    env: {
      INTERNAL_SECRET: ctx.shared.INTERNAL_SECRET,
      SCHEDULER_APP_ORIGIN: "http://${{App.RAILWAY_PRIVATE_DOMAIN}}:3000",
    },
  });

  const initializer = service("Inicialização", {
    source: image("ghcr.io/melgarafael/deskcomm-initializer:stable", {
      autoUpdates: { type: "disabled" },
    }),
    replicas: 1,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: ctx.shared.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: ctx.shared.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_DB_URL: ctx.shared.SUPABASE_DB_URL,
      OWNER_EMAIL: ctx.shared.OWNER_EMAIL,
      OWNER_PASSWORD: ctx.shared.OWNER_PASSWORD,
      OWNER_ORG_NAME: ctx.shared.OWNER_ORG_NAME,
      AI_PROVIDER: ctx.shared.AI_PROVIDER,
      NEXT_PUBLIC_APP_URL: "https://${{App.RAILWAY_PUBLIC_DOMAIN}}",
    },
  });

  return project("CRM com IA", {
    resources: [
      group("Aplicativo", [app, worker, scheduler, initializer]),
      group("WhatsApp", [waha, sessoesWaha, midiasWaha]),
      group("Cache", [cache, srh]),
    ],
  });
});
