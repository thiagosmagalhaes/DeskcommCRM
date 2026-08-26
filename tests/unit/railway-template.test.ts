import { readFileSync } from "node:fs";

import { createRailwayContext, project } from "railway/iac";
import { describe, expect, it } from "vitest";

import railwayConfig from "../../.railway/railway";

const iac = readFileSync(".railway/railway.ts", "utf8");
const initializer = readFileSync(".railway/initializer/entrypoint.sh", "utf8");

describe("template Railway", () => {
  it("é avaliado pelo SDK oficial sem configuração escondida", async () => {
    const graph = await railwayConfig(createRailwayContext({ environment: "production" }), project);
    expect(graph.name).toBe("CRM com IA");
    expect(graph.resources).toHaveLength(12);
  });

  it("declara toda a operação sem Caddy nem Traefik", () => {
    for (const recurso of [
      'service("App"',
      'service("Worker"',
      'service("Scheduler"',
      'service("Inicialização"',
      'service("WAHA"',
      'service("RedisRest"',
      'redis("Redis"',
    ]) {
      expect(iac, `faltou ${recurso}`).toContain(recurso);
    }
    expect(iac).not.toMatch(/service\("(?:Caddy|Traefik)"/);
  });

  it("mantém WAHA singleton e persiste sessão e mídia", () => {
    expect(iac).toMatch(/const waha = service\("WAHA",[\s\S]*?replicas: 1/);
    expect(iac).toContain('"/app/.sessions": sessoesWaha');
    expect(iac).toContain('"/app/.media": midiasWaha');
    expect(iac).toContain('WHATSAPP_RESTART_ALL_SESSIONS: "True"');
  });

  it("usa somente a rede privada entre os serviços", () => {
    expect(iac).toContain('"http://${{WAHA.RAILWAY_PRIVATE_DOMAIN}}:3000"');
    expect(iac).toContain('"http://${{App.RAILWAY_PRIVATE_DOMAIN}}:3000"');
    expect(iac).toContain('"http://${{RedisRest.RAILWAY_PRIVATE_DOMAIN}}:80"');
    expect(iac).not.toMatch(/https:\/\/\$\{\{(?:WAHA|RedisRest)\.RAILWAY_PUBLIC_DOMAIN/);
  });

  it("não deixa as imagens próprias atualizarem sozinhas", () => {
    for (const imagem of [
      "deskcommcrm:stable",
      "deskcomm-worker:stable",
      "deskcomm-scheduler:stable",
      "deskcomm-initializer:stable",
    ]) {
      expect(iac, `imagem ausente: ${imagem}`).toContain(imagem);
    }
    expect(iac.match(/autoUpdates: \{ type: "disabled" \}/g)).toHaveLength(4);
  });

  it("o initializer aplica o baseline antes do bootstrap do dono", () => {
    const baseline = initializer.indexOf('psql "$DB_URL" -v ON_ERROR_STOP=1 -f');
    const bootstrap = initializer.indexOf('exec pnpm exec tsx "$BOOTSTRAP_PATH"');
    expect(baseline).toBeGreaterThan(-1);
    expect(bootstrap).toBeGreaterThan(baseline);
  });
});
