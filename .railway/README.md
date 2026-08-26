# Fonte do template Railway

Este diretório descreve a topologia do projeto em Railway Infrastructure as Code (IaC).
O arquivo [`railway.ts`](railway.ts) cria:

- App, worker e scheduler a partir das imagens publicadas do projeto;
- WAHA com uma réplica e dois volumes persistentes (sessões e mídias);
- Redis gerenciado e a ponte HTTP compatível com Upstash;
- um inicializador que aplica `supabase/baseline.sql` e cria o primeiro dono.

O Supabase continua sendo um serviço externo. O `install.sh` da VPS não deve ser executado
no Railway: ele instala Docker, proxy, cron e agente de atualização no host, responsabilidades
que a plataforma já assume de outra forma.

## Antes de aplicar

1. Crie um projeto Supabase e copie a URL, anon key, service-role key e a connection string
   do Session pooler.
2. Crie um projeto vazio no Railway e vincule o repositório com `railway link`.
3. No ambiente do projeto, cadastre as variáveis compartilhadas abaixo.

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key do Supabase |
| `SUPABASE_DB_URL` | Session pooler do Postgres |
| `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_ORG_NAME` | primeiro dono e organização |
| `INTERNAL_SECRET` | autenticação interna entre scheduler e App |
| `CPF_ENCRYPTION_KEY`, `WAHA_BYO_ENCRYPTION_KEY`, `AI_CRED_AES_KEY` | chaves de criptografia da aplicação |
| `WAHA_API_KEY` | chave em texto usada pela App |
| `WAHA_API_KEY_SHA512` | hash SHA-512 da mesma chave, sem o prefixo `sha512:` |
| `WAHA_HMAC_SECRET` | assinatura dos webhooks WAHA |
| `SRH_TOKEN` | token da API Redis HTTP |
| `AI_PROVIDER` | `openrouter`, `anthropic` ou `openai` |
| `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | preencha a chave usada e deixe as demais vazias |

Use valores aleatórios longos para os segredos. Não os grave neste repositório.

## Aplicar e conferir

Instale as dependências do repositório e use a CLI atual; a CLI 4 não conhece `config`:

```bash
pnpm install --frozen-lockfile
npx -y --package=@railway/cli@latest railway config plan --file .railway/railway.ts
npx -y --package=@railway/cli@latest railway config apply --file .railway/railway.ts
```

Depois do primeiro apply, gere um domínio público **somente para o serviço App** no painel.
WAHA, RedisRest, worker e scheduler devem continuar acessíveis apenas pela rede privada.
Redeploy App e Inicialização para que `RAILWAY_PUBLIC_DOMAIN` seja resolvido.

O serviço **Inicialização** é one-shot: sucesso significa que o baseline foi aplicado e o
dono foi criado; ele deve terminar com código 0. Só então abra o domínio da App e faça login.

## Transformar o projeto validado em template

O arquivo IaC é a fonte versionada, mas o botão público de template é um objeto hospedado no
Railway. Depois de validar login, saúde, QR do WhatsApp e envio/recebimento em um projeto novo:

```bash
npx -y --package=@railway/cli@latest railway templates create --project SEU_PROJECT_ID --environment production
```

Revise as perguntas e dependências no editor de templates do Railway e publique o rascunho.
Antes de publicar para clientes, substitua `:stable` nas quatro imagens próprias pelo mesmo
`X.Y.Z` imutável. Uma instalação paga não pode mudar de versão num redeploy acidental.

## Limites conhecidos

- Railway IaC está marcado como experimental pelo próprio Railway.
- O domínio público não é criado pelo IaC; essa etapa ocorre uma vez no projeto-base.
- O template não instala nem gerencia o Supabase.
- O botão de atualização da instalação em VPS não administra releases no Railway; atualizações
  são feitas alterando os quatro pins de imagem no projeto/template.
