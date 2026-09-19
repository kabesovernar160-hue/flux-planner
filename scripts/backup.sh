#!/bin/sh
# Резервная копия базы Flux Planner.
#
# Копия снимается командой sqlite3 «.backup» внутри контейнера: файл базы
# с включённым WAL нельзя просто скопировать — в снимок попадёт
# несогласованное состояние, и такая «копия» не восстановится. Проверить
# восстановление стоит хотя бы раз: непроверенная копия не копия.
#
#   ./scripts/backup.sh [каталог]
#
# В cron на сервере (каталог проекта подставить свой):
#   30 4 * * * cd /opt/flux-planner && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Восстановление:
#   docker compose stop app
#   docker compose cp backups/flux-2026-09-20-0430.db app:/data/flux-planner.db
#   docker compose start app

set -eu

DIR=${1:-./backups}
NAME="flux-$(date +%F-%H%M).db"

mkdir -p "$DIR"

docker compose exec -T app sqlite3 /data/flux-planner.db ".backup '/data/$NAME'"
docker compose cp "app:/data/$NAME" "$DIR/$NAME"
docker compose exec -T app rm -f "/data/$NAME"

# Копии старше двух недель удаляются: место на диске кончится раньше,
# чем такая копия понадобится.
find "$DIR" -name 'flux-*.db' -mtime +14 -delete

echo "[backup] $DIR/$NAME"
