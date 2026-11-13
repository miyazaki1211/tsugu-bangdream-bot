@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
REM ===========================================
REM saaya backend 启动脚本 (Windows)
REM 自动生成 .env（如不存在），然后启动服务
REM ===========================================

cd /d "%~dp0"

REM --- 首次启动：从模板生成 .env ---
if not exist .env (
    echo [startup] .env 不存在，从 .env.example 生成...
    copy .env.example .env >nul

    REM 用环境变量覆盖（如果存在）
    if defined MONGODB_URI                 call :setenv MONGODB_URI
    if defined MONGODB_DATABASE_NAME       call :setenv MONGODB_DATABASE_NAME
    if defined BACKEND_PORT                call :setenv BACKEND_PORT
    if defined LOCAL_DB                    call :setenv LOCAL_DB
    if defined ARTICLE                     call :setenv ARTICLE
    if defined MEMORY_CACHE                call :setenv MEMORY_CACHE
    if defined USE_BANDORISTATION          call :setenv USE_BANDORISTATION
    if defined PREDICT_SERVER_URL          call :setenv PREDICT_SERVER_URL
    if defined RANKING_API_BASE_URL        call :setenv RANKING_API_BASE_URL
    if defined BANGDREAM_OPTIMIZE_BASE_URL call :setenv BANGDREAM_OPTIMIZE_BASE_URL

    echo [startup] .env 已生成
)

REM --- 启动服务 ---
npx ts-node -r tsconfig-paths/register src/app.ts
goto :eof

:setenv
REM 替换 .env 中指定 key 的值为当前环境变量
    powershell -Command "(Get-Content .env -Encoding UTF8) -replace '^%1=.*', '%1=!%1!' | Set-Content .env -Encoding UTF8"
goto :eof
