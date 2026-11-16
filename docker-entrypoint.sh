#!/bin/sh
# データ保存先 (Railway / Fly.io のボリュームは root 所有で取り付けられる) の所有者を直してから、
# 権限の低い ippo ユーザーに切り替えてアプリを起動する
set -e
DATA_DIR="$(dirname "${DB_PATH:-/data/ippo.db}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R ippo:ippo "$DATA_DIR"
  exec setpriv --reuid=ippo --regid=ippo --init-groups "$@"
fi
exec "$@"
