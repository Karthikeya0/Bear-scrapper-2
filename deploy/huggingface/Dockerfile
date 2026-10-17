# Bear Radar's n8n on a free Hugging Face Space (Docker SDK).
# Workflows, credentials and history are stored in your Supabase Postgres (schema "n8n"),
# so nothing is lost when the Space restarts. All settings come from the Space's
# "Variables and secrets" — see deploy/GO-LIVE.md. Nothing secret belongs in this file.
FROM n8nio/n8n:2.43.6

# Hugging Face sends traffic to port 7860.
# Only failed runs are kept in n8n's history: Supabase's free database is 500 MB and every sent email carries
# the one-pager PDF. The dashboard's run log and audit log still record every success.
ENV N8N_PORT=7860 \
    N8N_LISTEN_ADDRESS=0.0.0.0 \
    N8N_PROTOCOL=https \
    N8N_PROXY_HOPS=1 \
    N8N_SECURE_COOKIE=true \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_PERSONALIZATION_ENABLED=false \
    N8N_RUNNERS_ENABLED=true \
    DB_TYPE=postgresdb \
    DB_POSTGRESDB_SCHEMA=n8n \
    DB_POSTGRESDB_PORT=5432 \
    DB_POSTGRESDB_SSL_ENABLED=true \
    DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false \
    EXECUTIONS_DATA_PRUNE=true \
    EXECUTIONS_DATA_MAX_AGE=168 \
    EXECUTIONS_DATA_SAVE_ON_SUCCESS=none \
    EXECUTIONS_DATA_SAVE_ON_ERROR=all \
    EXECUTIONS_DATA_PRUNE_MAX_COUNT=5000 \
    GENERIC_TIMEZONE=Asia/Kolkata \
    TZ=Asia/Kolkata

EXPOSE 7860
