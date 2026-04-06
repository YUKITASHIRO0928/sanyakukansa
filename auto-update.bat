@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo =============================================
echo   散薬監査システム アップデート処理
echo   開始日時: %date% %time%
echo =============================================

echo [1/3] 最新プログラムの取得中 (git pull)...
call git pull origin main

echo.
echo [2/3] 依存関係の更新 (npm install)...
:: package.json が存在する場合のみ実行
if exist package.json (
  call npm install
) else (
  echo [SKIP] package.json が見つかりません。
)

echo.
echo [3/3] サーバーの再起動中 (pm2)...
call pm2 restart sanyakukansa

echo.
echo =============================================
echo   アップデートが完了しました。
echo =============================================
