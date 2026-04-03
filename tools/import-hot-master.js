#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// MEDISマスター変換スクリプト
// 使い方: node tools/import-hot-master.js <TXTファイルのパス>
// 例:     node tools/import-hot-master.js ~/Downloads/MEDIS20260228kaitei.TXT
// 出力:   data/hot_master.json
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs");
const path = require("path");

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("使い方: node tools/import-hot-master.js <TXTファイルのパス>");
  console.error("例:     node tools/import-hot-master.js ~/Downloads/MEDIS20260228kaitei.TXT");
  process.exit(1);
}

const resolvedInput = inputFile.replace(/^~/, process.env.HOME);
if (!fs.existsSync(resolvedInput)) {
  console.error(`ファイルが見つかりません: ${resolvedInput}`);
  process.exit(1);
}

const outputDir  = path.join(__dirname, "..", "data");
const outputFile = path.join(outputDir, "hot_master.json");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Shift-JIS → UTF-8 デコード
console.log("📖 ファイルを読み込み中...");
const buf  = fs.readFileSync(resolvedInput);
const text = new TextDecoder("shift_jis").decode(buf);
const lines = text.split(/\r?\n/);

// CSV行パーサー（ダブルクォート対応）
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

// 標準レイアウト 列インデックス
// 0:HOT13  7:YJコード  11:販売名  13:規格単位  19:区分  20:製造会社  21:販売会社  22:レコード区分
const COL = { hot13: 0, yj: 7, name: 11, spec: 13, category: 19, maker: 21, recType: 22 };

console.log("🔄 変換中（約6万件）...");
const master = {}; // { [hot13]: { name, spec, yj, category, maker } }
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const cols = parseCsvLine(line);
  if (cols.length < 23) continue;

  const hot13   = cols[COL.hot13].trim();
  const recType = cols[COL.recType].trim();

  // レコード区分 2=削除 はスキップ
  if (recType === "2") { skipped++; continue; }
  if (!hot13 || hot13.length !== 13) continue;

  master[hot13] = {
    name:     cols[COL.name].trim(),
    spec:     cols[COL.spec].trim(),
    yj:       cols[COL.yj].trim(),
    category: cols[COL.category].trim(), // 内/外/注/歯
    maker:    cols[COL.maker].trim(),
  };
}

const count = Object.keys(master).length;
fs.writeFileSync(outputFile, JSON.stringify(master), "utf-8");

console.log(`✅ 変換完了！`);
console.log(`   登録件数: ${count.toLocaleString()}件`);
console.log(`   削除スキップ: ${skipped.toLocaleString()}件`);
console.log(`   出力先: ${outputFile}`);
console.log(`   ファイルサイズ: ${(fs.statSync(outputFile).size / 1024 / 1024).toFixed(1)}MB`);
