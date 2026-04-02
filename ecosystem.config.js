// pm2 設定ファイル
// 使い方: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "sanyakukansa",
      script: "server.js",
      watch: false,
      autorestart: true,       // クラッシュ時に自動再起動
      max_restarts: 10,        // 最大再起動回数（無限ループ防止）
      restart_delay: 3000,     // 再起動まで3秒待つ
      error_file: "data/logs/error.log",
      out_file: "data/logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
