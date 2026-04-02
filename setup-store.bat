@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo =============================================
echo   散薬監査システム 店舗セットアップ
echo =============================================
echo.
echo 設定ファイル (config.json) を作成します。
echo 既存の config.json がある場合は上書きします。
echo.

:: ── 店舗名 ──
set /p STORE_NAME="店舗名を入力してください（例: 〇〇薬局 本店）: "
if "%STORE_NAME%"=="" (
  echo [エラー] 店舗名は必須です。
  pause
  exit /b 1
)

:: ── ELIXIRサーバー名 ──
echo.
echo ELIXIRサーバー名を入力してください。
echo 通常は ELIXIR1 です。わからない場合はそのままEnterを押してください。
set /p ELIXIR_HOST="ELIXIRサーバー名 [ELIXIR1]: "
if "%ELIXIR_HOST%"=="" set ELIXIR_HOST=ELIXIR1

:: ── ポート番号 ──
echo.
echo ポート番号を入力してください。
echo 1台のPCで1店舗の場合は 3456 のままでOKです。
set /p PORT="ポート番号 [3456]: "
if "%PORT%"=="" set PORT=3456

:: ── 確認 ──
echo.
echo =============================================
echo   以下の内容で設定します
echo =============================================
echo   店舗名:         %STORE_NAME%
echo   ELIXIRサーバー: \\%ELIXIR_HOST%\Senddata\...
echo   ポート:         %PORT%
echo   アクセスURL:    http://localhost:%PORT%
echo =============================================
echo.
set /p CONFIRM="この内容で作成しますか？ [Y/n]: "
if /i "%CONFIRM%"=="n" (
  echo キャンセルしました。
  pause
  exit /b 0
)

:: ── config.json 生成 ──
set CONFIG_PATH=%~dp0config.json
(
  echo {
  echo   "storeName": "%STORE_NAME%",
  echo   "watchDir": "\\\\%ELIXIR_HOST%\\Senddata\\SIPS3\\DATA",
  echo   "watchDir2": "\\\\%ELIXIR_HOST%\\Senddata\\SIPS1\\JAHISCZK",
  echo   "port": %PORT%,
  echo   "pollInterval": 300
  echo }
) > "%CONFIG_PATH%"

if exist "%CONFIG_PATH%" (
  echo.
  echo [OK] config.json を作成しました。
  echo      場所: %CONFIG_PATH%
) else (
  echo [エラー] config.json の作成に失敗しました。
  pause
  exit /b 1
)

:: ── 自動起動セットアップを続けて実行するか確認 ──
echo.
set /p RUN_SETUP="続けて自動起動のセットアップも行いますか？ [Y/n]: "
if /i not "%RUN_SETUP%"=="n" (
  call "%~dp0setup-autostart.bat"
) else (
  echo.
  echo セットアップ完了！
  echo サーバーを起動するには: node server.js
  echo または: pm2 start ecosystem.config.js
  echo.
  pause
)

endlocal
