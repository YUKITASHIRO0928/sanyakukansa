@echo off
chcp 65001 > nul
echo =============================================
echo   散薬監査システム ファイアウォール設定
echo   ※ 管理者として実行してください
echo =============================================
echo.

:: 管理者権限チェック
net session > nul 2>&1
if %errorlevel% neq 0 (
  echo [エラー] このスクリプトは管理者として実行してください。
  echo 右クリック → 「管理者として実行」を選択してください。
  pause
  exit /b 1
)

:: ファイアウォールルール追加（既存ルールがあれば削除してから追加）
netsh advfirewall firewall delete rule name="散薬監査システム" > nul 2>&1
netsh advfirewall firewall add rule ^
  name="散薬監査システム" ^
  dir=in ^
  action=allow ^
  protocol=TCP ^
  localport=3456 ^
  description="散薬調剤支援システム LAN共有用"

if %errorlevel% equ 0 (
  echo [OK] ファイアウォール設定完了
  echo.
  echo タブレット・他PCから以下のURLでアクセスできます:
  echo   http://（このPCのIPアドレス）:3456
  echo.
  echo IPアドレスの確認方法:
  echo   コマンドプロンプトで ipconfig と入力
  echo   「IPv4 アドレス」の値を使ってください
) else (
  echo [エラー] ファイアウォール設定に失敗しました。
)

echo.
pause
