// ═══════════════════════════════════════════════════════════════
// 散薬調剤支援システム — オールインワンサーバー v0.6
// ═══════════════════════════════════════════════════════════════
//
// 【機能】
//  1. NSIPSフォルダ監視 + WebSocket通知
//  2. 調剤アプリ(HTML)をブラウザに配信
//  3. 調剤履歴のJSON永続化
//
// 【起動】 node server.js
// 【アクセス】 http://localhost:3456
//
// 外部パッケージ不要（Node.js標準モジュールのみ）
// ═══════════════════════════════════════════════════════════════

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");

const https = require("https");

// ★★★ 設定 ★★★
const WATCH_DIR = "C:\\SIPS1";          // NSIPS共有フォルダ
const PORT = 3456;                       // サーバーポート
const POLL_INTERVAL = 500;               // フォルダ監視間隔(ms) - 一瞬で消えるファイル対策
const DATA_DIR = path.join(__dirname, "data"); // 履歴等の保存先
const HISTORY_FILE = path.join(DATA_DIR, "dispensing_history.json");
const GTINMAP_FILE = path.join(DATA_DIR, "gtin_map.json");

// ★★★ GitHub自動更新 ★★★
// リポジトリ作成後、ここを書き換えてください
// 例: https://raw.githubusercontent.com/yourname/dispensing-app/main/index.html
const GITHUB_INDEX_URL = "https://raw.githubusercontent.com/YUKITASHIRO0928/sanyakukansa/main/index.html";
const AUTO_UPDATE = true;      // false にすると自動更新を無効化

// dataフォルダ作成
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ═══════════════════════════════════════════
// GitHub自動更新
// ═══════════════════════════════════════════
function fetchFromGitHub(rawUrl) {
  return new Promise((resolve, reject) => {
    https.get(rawUrl, { headers: { "User-Agent": "dispensing-server" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchFromGitHub(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`)); return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function autoUpdateFromGitHub() {
  if (!AUTO_UPDATE || !GITHUB_INDEX_URL) return;
  console.log("🔄 GitHubから最新版を確認中...");
  try {
    const remoteHtml = await fetchFromGitHub(GITHUB_INDEX_URL);
    const localPath = path.join(__dirname, "index.html");
    const localHtml = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf-8") : "";
    if (remoteHtml !== localHtml) {
      // バックアップ
      if (localHtml) {
        const backupPath = path.join(DATA_DIR, `index_backup_${Date.now()}.html`);
        fs.writeFileSync(backupPath, localHtml, "utf-8");
      }
      fs.writeFileSync(localPath, remoteHtml, "utf-8");
      console.log("✅ index.html を最新版に更新しました！");
    } else {
      console.log("✅ index.html は最新です");
    }
  } catch (e) {
    console.log(`⚠ 自動更新スキップ（${e.message}）— ローカルのindex.htmlを使用します`);
  }
}

// ═══════════════════════════════════════════
// 履歴管理
// ═══════════════════════════════════════════
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    }
  } catch (e) { console.error("履歴読込エラー:", e.message); }
  return [];
}

function saveHistory(records) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (e) { console.error("履歴保存エラー:", e.message); }
}

let historyRecords = loadHistory();

// ═══════════════════════════════════════════
// WebSocket（簡易実装・外部パッケージ不要）
// ═══════════════════════════════════════════
const wsClients = new Set();

function upgradeToWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-5AB5DC11045A").digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
    `Connection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  wsClients.add(socket);
  socket.on("close", () => wsClients.delete(socket));
  socket.on("error", () => wsClients.delete(socket));
  const ping = setInterval(() => {
    try { sendWsFrame(socket, '{"type":"ping"}'); } catch (e) { clearInterval(ping); }
  }, 30000);
  socket.on("close", () => clearInterval(ping));
}

function sendWsFrame(socket, message) {
  const payload = Buffer.from(message, "utf-8");
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2); header[0] = 0x81; header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function broadcastWs(message) {
  for (const s of wsClients) { try { sendWsFrame(s, message); } catch (e) { wsClients.delete(s); } }
}

// ═══════════════════════════════════════════
// フォルダ監視（リアルタイム + ポーリング併用）
// ═══════════════════════════════════════════
let knownFiles = {};
const CACHE_DIR = path.join(DATA_DIR, "nsips_cache"); // 一瞬で消えるファイルのコピー保存先
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function scanFiles() {
  try {
    // WATCH_DIR（ネットワーク）とローカルキャッシュの両方をスキャン
    const result = {};
    // ネットワークフォルダ
    if (fs.existsSync(WATCH_DIR)) {
      const files = fs.readdirSync(WATCH_DIR).filter(f => /\.(csv|tsv|txt)$/i.test(f));
      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(WATCH_DIR, f));
          result[f] = { name: f, size: stat.size, mtime: stat.mtimeMs, source: "network" };
        } catch (e) {}
      }
    }
    // ローカルキャッシュ
    if (fs.existsSync(CACHE_DIR)) {
      const cached = fs.readdirSync(CACHE_DIR).filter(f => /\.(csv|tsv|txt)$/i.test(f));
      for (const f of cached) {
        if (!result[f]) {
          try {
            const stat = fs.statSync(path.join(CACHE_DIR, f));
            result[f] = { name: f, size: stat.size, mtime: stat.mtimeMs, source: "cache" };
          } catch (e) {}
        }
      }
    }
    return result;
  } catch (e) { return {}; }
}

// ファイルを即座にキャッシュにコピー
function captureFile(filename) {
  try {
    const src = path.join(WATCH_DIR, filename);
    const dst = path.join(CACHE_DIR, filename);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      console.log(`  💾 キャプチャ: ${filename}`);
    }
  } catch (e) {
    // ファイルが既に消えている場合もある
  }
}

// fs.watch でリアルタイム監視
function startRealtimeWatch() {
  try {
    if (!fs.existsSync(WATCH_DIR)) return;
    fs.watch(WATCH_DIR, (eventType, filename) => {
      if (!filename) return;
      if (!/\.(csv|tsv|txt)$/i.test(filename)) return;
      // ファイルが出現した瞬間にキャプチャ
      if (eventType === "rename" || eventType === "change") {
        setTimeout(() => captureFile(filename), 50);  // 50ms待ってからコピー（書込み完了を待つ）
        setTimeout(() => captureFile(filename), 200); // 200msでもリトライ
        setTimeout(() => {
          captureFile(filename);
          checkForChanges(); // UIに通知
        }, 500);
      }
    });
    console.log("👁 リアルタイム監視: ON（fs.watch）");
  } catch (e) {
    console.log(`⚠ リアルタイム監視失敗: ${e.message}（ポーリングで代替）`);
  }
}

function checkForChanges() {
  const current = scanFiles();
  const newFiles = [], changedFiles = [];
  for (const [name, info] of Object.entries(current)) {
    if (!knownFiles[name]) newFiles.push(name);
    else if (knownFiles[name].mtime !== info.mtime || knownFiles[name].size !== info.size) changedFiles.push(name);
  }
  if (newFiles.length > 0 || changedFiles.length > 0) {
    knownFiles = current;
    const fileList = Object.values(current).map(f => ({ name: f.name, size: f.size, modified: new Date(f.mtime).toISOString() }));
    broadcastWs(JSON.stringify({ type: "files_updated", newFiles, changedFiles, files: fileList }));
    console.log(`[${new Date().toLocaleTimeString()}] 検出: 新規${newFiles.length}件, 変更${changedFiles.length}件`);
  }
  knownFiles = current;
}

// ═══════════════════════════════════════════
// HTTPリクエスト本文読み取り
// ═══════════════════════════════════════════
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ═══════════════════════════════════════════
// HTTPサーバー
// ═══════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  // ── API: サーバー状態 ──
  if (pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      status: "running", watchDir: WATCH_DIR,
      dirExists: fs.existsSync(WATCH_DIR),
      fileCount: Object.keys(knownFiles).length,
      historyCount: historyRecords.length,
      wsClients: wsClients.size,
    }));
    return;
  }

  // ── API: NSIPSファイル一覧 ──
  if (pathname === "/api/files") {
    const files = Object.values(scanFiles()).map(f => ({ name: f.name, size: f.size, modified: new Date(f.mtime).toISOString() }));
    files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ files, watchDir: WATCH_DIR }));
    return;
  }

  // ── API: NSIPSファイル内容 ──
  if (pathname === "/api/file") {
    const fileName = parsed.query.name;
    if (!fileName || /[.]{2}|[/\\]/.test(fileName)) {
      res.writeHead(400); res.end('{"error":"不正なファイル名"}'); return;
    }
    // ネットワークフォルダ → キャッシュの順で探す
    let fp = path.join(WATCH_DIR, fileName);
    if (!fs.existsSync(fp)) fp = path.join(CACHE_DIR, fileName);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('{"error":"ファイル未検出"}'); return; }
    res.writeHead(200, { "Content-Type": "text/csv; charset=shift_jis" });
    res.end(fs.readFileSync(fp));
    return;
  }

  // ── API: 調剤履歴取得 ──
  if (pathname === "/api/history" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ records: historyRecords }));
    return;
  }

  // ── API: 調剤履歴追加 ──
  if (pathname === "/api/history" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      body.id = body.id || `R${Date.now()}`;
      body.savedAt = new Date().toISOString();
      historyRecords.unshift(body);
      saveHistory(historyRecords);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, id: body.id, total: historyRecords.length }));
      console.log(`[${new Date().toLocaleTimeString()}] 履歴保存: ${body.patient?.name} (${body.drugs?.length}剤)`);
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── API: 調剤履歴削除（1件） ──
  if (pathname === "/api/history" && req.method === "DELETE") {
    const id = parsed.query.id;
    if (id) {
      historyRecords = historyRecords.filter(r => r.id !== id);
      saveHistory(historyRecords);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, total: historyRecords.length }));
    return;
  }

  // ── API: GTIN紐付けテーブル取得 ──
  if (pathname === "/api/gtinmap" && req.method === "GET") {
    let map = {};
    try { if (fs.existsSync(GTINMAP_FILE)) map = JSON.parse(fs.readFileSync(GTINMAP_FILE, "utf-8")); } catch (e) {}
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ map, count: Object.keys(map).length }));
    return;
  }

  // ── API: GTIN紐付けテーブル保存 ──
  if (pathname === "/api/gtinmap" && req.method === "POST") {
    try {
      const map = JSON.parse(await readBody(req));
      fs.writeFileSync(GTINMAP_FILE, JSON.stringify(map, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: Object.keys(map).length }));
      console.log(`[${new Date().toLocaleTimeString()}] GTIN紐付け保存: ${Object.keys(map).length}件`);
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── API: 保留セッション取得 ──
  if (pathname === "/api/pending" && req.method === "GET") {
    const PENDING_FILE = path.join(DATA_DIR, "pending_sessions.json");
    let sessions = [];
    try { if (fs.existsSync(PENDING_FILE)) sessions = JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8")); } catch (e) {}
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ sessions }));
    return;
  }

  // ── API: 保留セッション保存 ──
  if (pathname === "/api/pending" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const PENDING_FILE = path.join(DATA_DIR, "pending_sessions.json");
      fs.writeFileSync(PENDING_FILE, JSON.stringify(body.sessions || [], null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: (body.sessions || []).length }));
      console.log(`[${new Date().toLocaleTimeString()}] 保留セッション保存: ${(body.sessions || []).length}件`);
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── アプリ配信: / → index.html ──
  if (pathname === "/" || pathname === "/index.html") {
    const htmlPath = path.join(__dirname, "index.html");
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(htmlPath, "utf-8"));
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>散薬調剤支援</title></head>
<body style="font-family:sans-serif;padding:40px;text-align:center">
<h2>index.html が見つかりません</h2>
<p>server.js と同じフォルダに index.html を配置してください。</p>
<p>サーバーは正常に動作しています。<br>
<a href="/api/status">API Status</a> | <a href="/api/files">NSIPS Files</a> | <a href="/api/history">履歴</a></p>
</body></html>`);
    }
    return;
  }

  // ── 静的ファイル（CSS/JS等） ──
  const staticPath = path.join(__dirname, pathname);
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(pathname).toLowerCase();
    const mimeTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(fs.readFileSync(staticPath));
    return;
  }

  res.writeHead(404); res.end('{"error":"Not Found"}');
});

server.on("upgrade", (req, socket) => upgradeToWebSocket(req, socket));

// ═══════════════════════════════════════════
// 起動
// ═══════════════════════════════════════════
server.listen(PORT, async () => {
  // 起動時にGitHubから最新版を取得
  await autoUpdateFromGitHub();

  const dirOk = fs.existsSync(WATCH_DIR);
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   散薬調剤支援システム — サーバー v0.7              ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  アプリURL:    http://localhost:${PORT}`);
  console.log(`║  監視フォルダ: ${WATCH_DIR} ${dirOk ? "✅" : "❌ 未検出"}`);
  console.log(`║  履歴ファイル: ${HISTORY_FILE}`);
  console.log(`║  保存済履歴:   ${historyRecords.length}件`);
  console.log(`║  自動更新:     ${AUTO_UPDATE && GITHUB_INDEX_URL ? "✅ ON" : "⏸ OFF（GITHUB_INDEX_URL未設定）"}`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  ブラウザで上記URLを開いてください                  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("\nCtrl+C で停止\n");
  if (!dirOk) console.log(`⚠ "${WATCH_DIR}" が見つかりません。WATCH_DIRを確認してください。\n`);
  knownFiles = scanFiles();
  console.log(`初回スキャン: ${Object.keys(knownFiles).length}件のCSVを検出\n`);
  startRealtimeWatch();
  setInterval(checkForChanges, POLL_INTERVAL);
});
