#!/bin/sh
# Inicializa uma instalação Railway e termina. Pode ser executado novamente:
# baseline e bootstrap seguem os mesmos contratos idempotentes do kit da VPS.
set -eu

DB_URL="${SUPABASE_DB_ADMIN_URL:-${SUPABASE_DB_URL:-}}"
BASELINE_PATH="${BASELINE_PATH:-/app/supabase/baseline.sql}"
BOOTSTRAP_PATH="${BOOTSTRAP_PATH:-/app/scripts/bootstrap-owner.ts}"

obrigatoria() {
  nome="$1"
  eval "valor=\${$nome:-}"
  if [ -z "$valor" ]; then
    echo "initializer: falta a variável $nome." >&2
    exit 1
  fi
}

for nome in \
  NEXT_PUBLIC_SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY \
  SUPABASE_DB_URL \
  OWNER_EMAIL \
  OWNER_PASSWORD
do
  obrigatoria "$nome"
done

echo "initializer: habilitando extensões do banco"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c \
  "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;"

echo "initializer: aplicando o baseline versionado"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$BASELINE_PATH"

TABELAS="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")"
if [ "${TABELAS:-0}" -lt 30 ]; then
  echo "initializer: o baseline terminou com apenas ${TABELAS:-0} tabelas em public." >&2
  exit 1
fi

echo "initializer: criando o primeiro dono"
exec pnpm exec tsx "$BOOTSTRAP_PATH"
