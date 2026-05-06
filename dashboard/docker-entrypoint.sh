#!/bin/sh
# Entrypoint do dashboard:
# - Substitui BACKEND_HOST e BACKEND_PORT no nginx.conf.template
# - Inicia nginx
#
# No EasyPanel, serviços do mesmo projeto se comunicam pelo nome do serviço.
# Setar BACKEND_HOST=<nome-do-servico-backend> (ex: "lcsdr", "agente").

set -e

export BACKEND_HOST="${BACKEND_HOST:-agente}"
export BACKEND_PORT="${BACKEND_PORT:-3333}"

echo "[entrypoint] backend upstream = ${BACKEND_HOST}:${BACKEND_PORT}"

# envsubst só substitui as vars que listarmos — protege $host, $remote_addr etc.
envsubst '${BACKEND_HOST} ${BACKEND_PORT}' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# Validação de sanidade — falha rápido se o config tá quebrado
nginx -t

exec nginx -g 'daemon off;'
