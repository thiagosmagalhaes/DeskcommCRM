#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

ENTRYPOINT=".railway/initializer/entrypoint.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

check() {
  local nome="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ✓ %s\n' "$nome"
  else printf '  ✗ %s\n' "$nome"; fail=1; fi
}

mkdir -p "$TMP/bin"
: > "$TMP/baseline.sql"
: > "$TMP/bootstrap-owner.ts"

cat > "$TMP/bin/psql" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$PSQL_LOG"
case "$*" in
  *"select count(*)"*) printf '%s\n' "${TABELAS_DUBLE:-42}" ;;
esac
SH
cat > "$TMP/bin/pnpm" <<'SH'
#!/bin/sh
printf '%s\n' "$*" > "$PNPM_LOG"
SH
chmod +x "$TMP/bin/psql" "$TMP/bin/pnpm"

rodar() {
  env \
    PATH="$TMP/bin:$PATH" \
    PSQL_LOG="$TMP/psql.log" \
    PNPM_LOG="$TMP/pnpm.log" \
    BASELINE_PATH="$TMP/baseline.sql" \
    BOOTSTRAP_PATH="$TMP/bootstrap-owner.ts" \
    NEXT_PUBLIC_SUPABASE_URL="https://exemplo.supabase.co" \
    SUPABASE_SERVICE_ROLE_KEY="service-role-teste" \
    SUPABASE_DB_URL="postgresql://u:p@db:5432/postgres" \
    OWNER_EMAIL="dono@example.com" \
    OWNER_PASSWORD="senha-segura" \
    "$@" sh "$ENTRYPOINT" > "$TMP/saida" 2>&1
}

echo "initializer: aplica banco e cria o dono"
: > "$TMP/psql.log"
RC=0; rodar || RC=$?
check "termina com sucesso" test "$RC" -eq 0
check "habilita as três extensões" grep -q "create extension if not exists vector" "$TMP/psql.log"
check "aplica o baseline com ON_ERROR_STOP" grep -q -- "-v ON_ERROR_STOP=1 -f $TMP/baseline.sql" "$TMP/psql.log"
check "executa o bootstrap existente" grep -q "exec tsx $TMP/bootstrap-owner.ts" "$TMP/pnpm.log"

echo "initializer: falha fechada antes de tocar o banco"
: > "$TMP/psql.log"
RC=0; rodar env -u OWNER_EMAIL || RC=$?
check "recusa variável obrigatória ausente" test "$RC" -eq 1
check "explica qual variável faltou" grep -q "OWNER_EMAIL" "$TMP/saida"
check "não abriu conexão sem configuração completa" test ! -s "$TMP/psql.log"

echo "initializer: não aprova baseline incompleto"
: > "$TMP/psql.log"
RC=0; rodar env TABELAS_DUBLE=2 || RC=$?
check "recusa menos de 30 tabelas" test "$RC" -eq 1
check "mostra a contagem encontrada" grep -q "apenas 2 tabelas" "$TMP/saida"

if [ "$fail" -eq 0 ]; then
  echo "OK — todas as provas passaram."
else
  echo "FALHOU."
fi
exit "$fail"
