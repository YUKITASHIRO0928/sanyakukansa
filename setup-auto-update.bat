@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo =============================================
echo   自動更新（PC起動・ログイン時）のタスク登録
echo =============================================

set TASK_NAME=SanyakukansaAutoUpdate
set SCRIPT_PATH=%~dp0auto-update.bat

:: 古い同一名のタスクがあれば削除
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

:: PC（Windows）起動・ログイン時にバッチを実行するタスクを作成
schtasks /Create /TN "%TASK_NAME%" /TR "cmd.exe /c \"%SCRIPT_PATH%\"" /SC ONLOGON /F
if %errorlevel% equ 0 (
  echo [OK] PCログイン時の自動更新タスクを登録しました。
) else (
  echo [エラー] タスクの登録に失敗しました。（※通常は問題ありませんが、権限などの理由で失敗した場合は手動アップデートをご利用ください）
)
