@echo off
chcp 65001 > nul
echo =============================================
echo   散薬監査システム 自動起動セットアップ
echo =============================================
echo.

:: config.json チェック（なければ先に店舗設定へ）
if not exist "%~dp0config.json" (
  echo [注意] config.json が見つかりません。
  echo 先に店舗情報を設定します。
  echo.
  call "%~dp0setup-store.bat"
  exit /b
)

:: Node.js チェック
node -v > nul 2>&1
if %errorlevel% neq 0 (
  echo [エラー] Node.js がインストールされていません。
  echo https://nodejs.org/ からLTS版をインストールしてください。
  pause
  exit /b 1
)
echo [OK] Node.js: インストール済み

:: pm2 インストール
echo.
echo [1/3] pm2 をインストール中...
call npm install -g pm2
if %errorlevel% neq 0 (
  echo [エラー] pm2 のインストールに失敗しました。
  pause
  exit /b 1
)
echo [OK] pm2: インストール完了

:: pm2 でサーバー起動
echo.
echo [2/3] サーバーを起動中...
call pm2 start ecosystem.config.js
call pm2 save
echo [OK] サーバー起動完了

:: Windows スタートアップ登録
echo.
echo [3/3] PC起動時の自動スタートを設定中...

:: スタートアップフォルダにVBSを作成（バックグラウンド起動）
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_PATH=%STARTUP_DIR%\sanyakukansa-autostart.vbs
set BAT_PATH=%~dp0start-silent.bat

echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_PATH%"
echo WshShell.Run "cmd /c ""%BAT_PATH%""", 0, False >> "%VBS_PATH%"

:: サイレント起動用バッチ作成
echo @echo off > "%~dp0start-silent.bat"
echo cd /d "%~dp0" >> "%~dp0start-silent.bat"
echo pm2 start ecosystem.config.js --no-daemon 2^>nul >> "%~dp0start-silent.bat"
echo pm2 resurrect >> "%~dp0start-silent.bat"

echo [OK] スタートアップ登録完了

:: 自動更新設定
echo.
echo [4/4] 自動更新（タスクスケジューラ）を設定中...
call "%~dp0setup-auto-update.bat"

echo.
echo =============================================
echo   セットアップ完了！
echo =============================================
echo.
echo  アクセスURL: http://localhost:3456
echo  ログ確認:   pm2 logs sanyakukansa
echo  状態確認:   pm2 status
echo  手動停止:   pm2 stop sanyakukansa
echo  手動起動:   pm2 start ecosystem.config.js
echo.
echo ブラウザで http://localhost:3456 を開いてください。
echo.
pause
