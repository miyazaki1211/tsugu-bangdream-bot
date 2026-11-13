#!/bin/bash
# ===========================================
# saaya backend 启动脚本
# 自动生成 .env（如不存在），然后启动服务
# ===========================================

set -e

cd "$(dirname "$0")"

# --- 首次启动：从模板生成 .env ---
if [ ! -f .env ]; then
  echo "[startup] .env 不存在，从 .env.example 生成..."
  cp .env.example .env

  # 用环境变量覆盖（如果存在），否则保留模板默认值
  [ -n "$MONGODB_URI" ]                   && sed -i "s|^MONGODB_URI=.*|MONGODB_URI=$MONGODB_URI|" .env
  [ -n "$MONGODB_DATABASE_NAME" ]         && sed -i "s|^MONGODB_DATABASE_NAME=.*|MONGODB_DATABASE_NAME=$MONGODB_DATABASE_NAME|" .env
  [ -n "$BACKEND_PORT" ]                  && sed -i "s|^BACKEND_PORT=.*|BACKEND_PORT=$BACKEND_PORT|" .env
  [ -n "$LOCAL_DB" ]                      && sed -i "s|^LOCAL_DB=.*|LOCAL_DB=$LOCAL_DB|" .env
  [ -n "$ARTICLE" ]                       && sed -i "s|^ARTICLE=.*|ARTICLE=$ARTICLE|" .env
  [ -n "$MEMORY_CACHE" ]                  && sed -i "s|^MEMORY_CACHE=.*|MEMORY_CACHE=$MEMORY_CACHE|" .env
  [ -n "$USE_BANDORISTATION" ]            && sed -i "s|^USE_BANDORISTATION=.*|USE_BANDORISTATION=$USE_BANDORISTATION|" .env
  [ -n "$PREDICT_SERVER_URL" ]            && sed -i "s|^PREDICT_SERVER_URL=.*|PREDICT_SERVER_URL=$PREDICT_SERVER_URL|" .env
  [ -n "$RANKING_API_BASE_URL" ]          && sed -i "s|^RANKING_API_BASE_URL=.*|RANKING_API_BASE_URL=$RANKING_API_BASE_URL|" .env
  [ -n "$BANGDREAM_OPTIMIZE_BASE_URL" ]   && sed -i "s|^BANGDREAM_OPTIMIZE_BASE_URL=.*|BANGDREAM_OPTIMIZE_BASE_URL=$BANGDREAM_OPTIMIZE_BASE_URL|" .env

  echo "[startup] .env 已生成"
fi

# --- 启动服务 ---
exec npx ts-node -r tsconfig-paths/register src/app.ts
