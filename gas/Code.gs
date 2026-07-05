// ================================================================
// 舞昆アパート経営 - 経営ダッシュボード GAS
// Google Apps Script  Code.gs
//
// 使い方:
//   1. Google スプレッドシートを開き、拡張機能 > Apps Script
//   2. このコードを貼り付けて保存
//   3. 関数「setupAll」を実行 → シート+ヘッダーのみ作成（約10秒）
//   4. 必要に応じてメニューから各更新ボタンを押す
//   5. 「setTimeTrigger」を実行して30分ごとの自動更新を有効化
//   6. ウェブアプリとしてデプロイ（アクセス：全員）してURLをゲームに設定
// ================================================================

// ─── シート名 ────────────────────────────────────────────────────
const S_DASH    = 'Dashboard';
const S_CRM     = 'CRM';
const S_ANALYT  = 'Analytics';
const S_LEADS   = 'Leads';
const S_CHOICE  = 'choice';
const S_MONTHLY = 'monthly';
const S_ACTIONS = 'actions';
const S_DEBUG   = 'debug';

// ─── 舞昆カラーパレット ──────────────────────────────────────────
const C_GREEN1   = '#2E7D32';
const C_GREEN2   = '#388E3C';
const C_GREEN3   = '#E8F5E9';
const C_GREEN4   = '#A5D6A7';
const C_GOLD     = '#F9A825';
const C_GOLD_L   = '#FFF8E1';
const C_RED      = '#C62828';
const C_RED_L    = '#FFEBEE';
const C_ORANGE   = '#E65100';
const C_ORANGE_L = '#FFF3E0';
const C_BLUE     = '#1565C0';
const C_BLUE_L   = '#E3F2FD';
const C_WHITE    = '#FFFFFF';
const C_LIGHT    = '#FAFAFA';
const C_TEXT     = '#212121';
const C_MUTED    = '#757575';

// ─── カラム定義 ──────────────────────────────────────────────────
const CHOICE_COLS = [
  ['playerId','プレイヤーID'],['date','日付'],['year','ゲーム内年'],
  ['month','ゲーム内月'],['day','ゲーム内日'],['totalDays','総経過日数'],
  ['cash','所持金'],['creditScore','銀行信用度'],['rep','地域からの信頼'],
  ['ap','注意力（AP）'],['fatigue','疲労度'],['storeBrand','舞昆ブランド力'],
  ['communityBond','地域とのつながり'],['customerLoyalty','常連人数'],
  ['naritaTrust','成田さん信頼度'],['midoriTrust','みどり信頼度'],
  ['ownerStyle','オーナータイプ'],['ownerRisk','リスク対応力'],
  ['ownerPeople','人材育成力'],['ownerCommunity','地域共生力'],
  ['ownerFinance','財務力'],['storeCount','営業中店舗数'],
  ['store1profit','1号店日次利益'],['store2profit','2号店日次利益'],
  ['bldCount','所有物件数'],['bld1occ','1号物件入居率'],
  ['bld2occ','2号物件入居率'],['staffCount','スタッフ数'],
  ['pendingCases','未対応案件数'],['type','データ種別'],
  ['gameVersion','ゲームバージョン'],['playerName','プレイヤー名'],
  ['eventId','イベントID'],['choice','選択結果'],
];

const MONTHLY_COLS = [
  ['playerId','プレイヤーID'],['date','記録日'],['year','ゲーム内年'],
  ['month','ゲーム内月'],['totalDays','総経過日数'],['cash','所持金'],
  ['creditScore','銀行信用度'],['rep','地域からの信頼'],
  ['storeBrand','舞昆ブランド力'],['communityBond','地域とのつながり'],
  ['customerLoyalty','常連人数'],['ownerStyle','オーナータイプ'],
  ['storeCount','店舗数'],['bldCount','物件数'],
  ['bld1occ','1号物件入居率'],['bld2occ','2号物件入居率'],
  ['staffCount','スタッフ数'],['monthProfit','月次利益'],
  ['freeMode','フリーモード'],['mainStoryCompleted','1年目クリア'],
  ['gameVersion','バージョン'],['playerName','プレイヤー名'],
];

const LEADS_COLS = [
  ['registeredAt','登録日時'],       // A(1)
  ['playerId','プレイヤーID'],        // B(2)
  ['playerName','プレイヤー名'],      // C(3)
  ['age','年代'],                     // D(4)
  ['occupation','職業'],              // E(5)
  ['experience','経験'],              // F(6)
  ['region','地域'],                  // G(7)
  ['email','メールアドレス'],          // H(8)
  ['line','LINE登録'],                // I(9)
  ['interestApartment','大家に興味あり'], // J(10) ← 条件付き書式キー
  ['interestMaikon','舞昆に興味あり'],   // K(11) ← 条件付き書式キー
  ['ownerType','オーナータイプ'],
  ['ownerStyleKey','スタイルキー'],
  ['ownerScore','総合スコア'],
  ['profileRisk','リスク志向'],
  ['profilePeople','人材志向'],
  ['profileCommunity','地域志向'],
  ['profileFinance','財務志向'],
  ['storeBrand','ブランド力'],
  ['customerLoyalty','常連数'],
  ['communityBond','地域の絆'],
  ['finalCash','最終所持金'],
  ['finalRep','最終地域評価'],
  ['loanCount','融資回数'],
  ['staffCount','スタッフ数'],
  ['occPct','入居率'],
  ['ending','エンディング'],
  ['gameVersion','バージョン'],
  ['source','ソース'],
  ['recommendedProduct','おすすめ商品'],
  ['recommendedReason','おすすめ理由'],
  ['gameCleared','ゲームクリア'],
  ['purchaseScore','購入意欲スコア'],
  ['salesPriority','営業優先度'],
  ['actionStatus','対応状況'],
];

const ACTIONS_COLS = [
  ['receivedAt','受信日時'],['action','アクション'],['playerId','プレイヤーID'],
  ['day','経過日数'],['cash','所持金'],['ap','AP'],['fatigue','疲労度'],
  ['ownerStyle','オーナータイプ'],['creditScore','銀行信用度'],['rep','地域評価'],
  ['loanCount','融資回数'],['graduations','卒業数'],['midoriHired','みどり採用'],
  ['tanakaComplete','田中完結'],['caseId','ケースID'],['choiceLabel','選択肢'],
];

// ================================================================
// onOpen: カスタムメニュー
// ================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍙 舞昆ダッシュボード')
    .addItem('★ 切り分け用（setupAllMinimal）',        'setupAllMinimal')
    .addItem('① シート作成・ヘッダー設定（setupAll）', 'setupAll')
    .addItem('② 装飾・条件付き書式（setupFormats）',  'setupFormats')
    .addSeparator()
    .addItem('③ Dashboard更新', 'refreshDashboard')
    .addItem('④ CRM更新',       'refreshCRM')
    .addItem('⑤ Analytics更新', 'refreshAnalytics')
    .addItem('⑥ グラフ再生成',   'createCharts')
    .addSeparator()
    .addItem('⏰ 自動更新トリガー設定（30分）', 'setTimeTrigger')
    .addToUi();
}

// ================================================================
// doPost: エントリーポイント（ゲームからのデータ受信）
// ================================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData ? e.postData.contents : '{}');
    routeData(data);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ================================================================
// ルーティング
// ※ refreshDashboard はここでは呼ばない。定期トリガーに任せる。
// ================================================================
function routeData(data) {
  if (data.testMode) { saveDebug(data); return; }

  const type   = (data.type   || '').toLowerCase();
  const action = (data.action || '');

  if      (type === 'lead')    saveLead(data);
  else if (type === 'monthly') saveMonthly(data);
  else if (type === 'choice')  saveChoice(data);
  else if (action)             saveAction(data);
  else                         saveDebug(data);
}

// ================================================================
// シート書き込み（appendRow のみ ─ 高速）
// ================================================================
function saveChoice(data) {
  _append(S_CHOICE, CHOICE_COLS, data);
}

function saveMonthly(data) {
  _append(S_MONTHLY, MONTHLY_COLS, data);
}

function saveLead(data) {
  data.registeredAt       = _nowISO();
  data.recommendedProduct = _calcProduct(data);
  data.recommendedReason  = _calcReason(data);
  data.gameCleared        = _calcCleared(data);
  data.purchaseScore      = _calcPurchaseScore(data);
  data.salesPriority      = _calcSalesPriority(data);
  data.actionStatus       = data.actionStatus || '未対応';
  _append(S_LEADS, LEADS_COLS, data);
}

function saveAction(data) {
  data.receivedAt = _nowISO();
  _append(S_ACTIONS, ACTIONS_COLS, data);
}

function saveDebug(data) {
  const sh = _getOrCreateSheet(S_DEBUG, ['受信日時','type','playerId','JSON全文']);
  sh.appendRow([_nowISO(), data.type || data.action || '', data.playerId || '', JSON.stringify(data)]);
}

function _append(sheetName, cols, data) {
  const sh = _getOrCreateSheet(sheetName, cols.map(c => c[1]));
  sh.appendRow(cols.map(c => _val(data[c[0]])));
}

// ================================================================
// 計算ヘルパー
// ================================================================
function _calcProduct(d) {
  if (!d.interestMaikon) return d.interestApartment ? '大家向け相談資料' : '—';
  const k = d.ownerStyleKey || '';
  if (k === 'community') return 'たもぎ茸舞昆 地域ギフトセット';
  if (k === 'people')    return '舞昆 定番セット（おにぎり向け）';
  if (k === 'finance')   return '舞昆 業務用・ファミリーパック';
  return '舞昆 お試しセット';
}

function _calcReason(d) {
  const t = [];
  if (d.interestMaikon)      t.push('舞昆に興味あり');
  if (d.interestApartment)   t.push('大家に興味あり');
  if (d.occPct >= 80)        t.push('高入居率達成');
  if (d.communityBond >= 50) t.push('地域つながり強い');
  if (d.storeBrand >= 60)    t.push('ブランド力高い');
  return t.join(' / ') || '—';
}

function _calcCleared(d) {
  return (d.ending && d.ending !== 'none' && d.ending !== '') ? '○' : '—';
}

function _calcPurchaseScore(d) {
  let s = 0;
  if (d.interestMaikon)    s += 40;
  if (d.interestApartment) s += 30;
  if (d.email)             s += 15;
  if (d.line)              s += 10;
  if (d.occPct >= 70)      s += 5;
  return Math.min(s, 100);
}

function _calcSalesPriority(d) {
  const hasMaikon  = !!d.interestMaikon;
  const hasApt     = !!d.interestApartment;
  const hasContact = !!(d.email || d.line);
  if (hasMaikon && hasApt && hasContact) return '🔥 Hot';
  if ((hasMaikon || hasApt) && hasContact) return '⭐ Warm';
  if (hasMaikon || hasApt) return '△ Cold';
  return '— 様子見';
}

// ================================================================
// setupAll ─ シート作成 + ヘッダー設定のみ（10秒以内で完了）
// ※ 装飾・条件付き書式・Dashboard描画・大量読み込みは一切しない
// ================================================================
// ================================================================
// setupAllMinimal ─ 切り分け用（シート作成のみ）
// ================================================================
function setupAllMinimal() {
  Logger.log('setupAllMinimal start');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [S_DASH, S_CRM, S_ANALYT, S_LEADS, S_CHOICE, S_MONTHLY, S_ACTIONS, S_DEBUG].forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });
  Logger.log('setupAllMinimal end');
  return true;
}

// ================================================================
// setupAll ─ シート作成 + ヘッダー設定のみ（alert なし、return true で終了）
// ================================================================
function setupAll() {
  Logger.log('setupAll start');

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log('ensure sheets start');
  const order = [S_DASH, S_CRM, S_ANALYT, S_LEADS, S_CHOICE, S_MONTHLY, S_ACTIONS, S_DEBUG];
  order.forEach((name, i) => {
    if (!ss.getSheetByName(name)) {
      ss.insertSheet(name, i);
      Logger.log('created: ' + name);
    } else {
      Logger.log('exists: ' + name);
    }
  });
  Logger.log('ensure sheets end');

  Logger.log('headers start');
  _setHeaderOnly(ss, S_CHOICE,  CHOICE_COLS.map(c => c[1]));
  Logger.log('header done: ' + S_CHOICE);
  _setHeaderOnly(ss, S_MONTHLY, MONTHLY_COLS.map(c => c[1]));
  Logger.log('header done: ' + S_MONTHLY);
  _setHeaderOnly(ss, S_LEADS,   LEADS_COLS.map(c => c[1]));
  Logger.log('header done: ' + S_LEADS);
  _setHeaderOnly(ss, S_ACTIONS, ACTIONS_COLS.map(c => c[1]));
  Logger.log('header done: ' + S_ACTIONS);
  _setHeaderOnly(ss, S_DEBUG,   ['受信日時', 'type', 'playerId', 'JSON全文']);
  Logger.log('header done: ' + S_DEBUG);
  Logger.log('headers end');

  Logger.log('setupAll end');
  return true;
}

// ヘッダー行1のみ書き込む（装飾なし・frozenRowsのみ）
function _setHeaderOnly(ss, sheetName, headers) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
}

// ================================================================
// setupFormats ─ 装飾・条件付き書式（setupAll とは別に実行）
// ================================================================
function setupFormats() {
  Logger.log('setupFormats start');
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ヘッダー行の色付け
  _setHeaders(S_CHOICE,  CHOICE_COLS.map(c => c[1]),   C_GREEN1);
  Logger.log('format done: ' + S_CHOICE);
  _setHeaders(S_MONTHLY, MONTHLY_COLS.map(c => c[1]),  C_GREEN2);
  Logger.log('format done: ' + S_MONTHLY);
  _setHeaders(S_LEADS,   LEADS_COLS.map(c => c[1]),    C_GOLD);
  Logger.log('format done: ' + S_LEADS);
  _setHeaders(S_ACTIONS, ACTIONS_COLS.map(c => c[1]),  C_MUTED);
  Logger.log('format done: ' + S_ACTIONS);
  _setHeaders(S_DEBUG,   ['受信日時','type','playerId','JSON全文'], C_MUTED);
  Logger.log('format done: ' + S_DEBUG);

  Logger.log('conditional format start');
  _applyLeadsConditionalFormat();
  Logger.log('conditional format end');

  Logger.log('setupFormats end');
  return true;
}

// ================================================================
// Dashboard 更新（バッチ書き込みで高速化）
// ================================================================
function refreshDashboard() {
  const dash = _getOrCreateSheet(S_DASH);

  const choiceRows  = _getAllData(S_CHOICE);
  const monthlyRows = _getAllData(S_MONTHLY);
  const leadsRows   = _getAllData(S_LEADS);

  const today = _todayStr();

  // ── ゲーム統計 ────────────────────────────────────────────────
  const allPids   = _unique(choiceRows.map(r => r['プレイヤーID']));
  const todayPids = _unique(
    choiceRows.filter(r => String(r['日付']).startsWith(today)).map(r => r['プレイヤーID'])
  );
  const clearPids = _unique(
    monthlyRows.filter(r => _truthy(r['1年目クリア'])).map(r => r['プレイヤーID'])
  );
  const clearRate = allPids.length > 0
    ? Math.round(clearPids.length / allPids.length * 100) + '%' : '—';

  const maxDaysMap = {};
  choiceRows.forEach(r => {
    const p = r['プレイヤーID']; const d = _num(r['総経過日数']);
    maxDaysMap[p] = Math.max(maxDaysMap[p] || 0, d);
  });

  const latestMap = {};
  choiceRows.forEach(r => { latestMap[r['プレイヤーID']] = r; });
  const latestList = Object.values(latestMap);

  const avgDays   = _avg(Object.values(maxDaysMap));
  const avgStores = _avg(latestList.map(r => _num(r['営業中店舗数'])));
  const avgBlds   = _avg(latestList.map(r => _num(r['所有物件数'])));
  const avgBrand  = _avg(latestList.map(r => _num(r['舞昆ブランド力'])));
  const avgRep    = _avg(latestList.map(r => _num(r['地域からの信頼'])));
  const avgCredit = _avg(latestList.map(r => _num(r['銀行信用度'])));
  const avgCash   = _avg(latestList.map(r => _num(r['所持金'])));
  const avgOcc    = _avg(latestList.map(r => {
    const o1 = _num(r['1号物件入居率']);
    const o2 = _num(r['2号物件入居率']);
    return o2 > 0 ? (o1 + o2) / 2 : o1;
  }));

  // ── Leads 統計 ────────────────────────────────────────────────
  const maikons  = leadsRows.filter(r => _truthy(r['舞昆に興味あり']));
  const apts     = leadsRows.filter(r => _truthy(r['大家に興味あり']));
  const lineRegs = leadsRows.filter(r => _truthy(r['LINE登録']));
  const mailRegs = leadsRows.filter(r => String(r['メールアドレス'] || '').includes('@'));
  const hotLeads = leadsRows.filter(r => String(r['営業優先度'] || '').startsWith('🔥'));
  const pending  = leadsRows.filter(r => r['対応状況'] === '未対応');
  const todayLds = leadsRows.filter(r => String(r['登録日時'] || '').startsWith(today));

  const ownerMap = {};
  leadsRows.forEach(r => {
    const t = r['オーナータイプ'] || '不明'; ownerMap[t] = (ownerMap[t] || 0) + 1;
  });
  const topOwners = Object.entries(ownerMap).sort((a, b) => b[1] - a[1]);

  const prodMap = {};
  leadsRows.forEach(r => {
    const p = r['おすすめ商品'] || '—';
    if (p !== '—') prodMap[p] = (prodMap[p] || 0) + 1;
  });
  const topProds = Object.entries(prodMap).sort((a, b) => b[1] - a[1]);

  const evMap = {};
  choiceRows.filter(r => String(r['日付'] || '').startsWith(today)).forEach(r => {
    const ev = r['イベントID'] || '—'; evMap[ev] = (evMap[ev] || 0) + 1;
  });
  const topEvents = Object.entries(evMap).sort((a, b) => b[1] - a[1]);

  const m = {
    totalPlayers : allPids.length,
    todayPlayers : todayPids.length,
    clearers     : clearPids.length,
    clearRate,
    avgDays      : Math.round(avgDays) + '日',
    avgStores    : avgStores.toFixed(1) + '店',
    avgBlds      : avgBlds.toFixed(1) + '棟',
    avgBrand     : Math.round(avgBrand),
    avgRep       : Math.round(avgRep),
    avgCredit    : Math.round(avgCredit),
    avgCash      : Math.round(avgCash).toLocaleString() + '円',
    avgOcc       : Math.round(avgOcc) + '%',
    maikons      : maikons.length,
    apts         : apts.length,
    lines        : lineRegs.length,
    emails       : mailRegs.length,
    hotLeads     : hotLeads.length,
    pending      : pending.length,
    todayLeads   : todayLds.length,
    prod1  : topProds[0]  ? topProds[0][0]  + '（' + topProds[0][1]  + '人）' : '—',
    prod2  : topProds[1]  ? topProds[1][0]  + '（' + topProds[1][1]  + '人）' : '—',
    prod3  : topProds[2]  ? topProds[2][0]  + '（' + topProds[2][1]  + '人）' : '—',
    owner1 : topOwners[0] ? topOwners[0][0] + '（' + topOwners[0][1] + '人）' : '—',
    owner2 : topOwners[1] ? topOwners[1][0] + '（' + topOwners[1][1] + '人）' : '—',
    event1 : topEvents[0] ? topEvents[0][0] + '（' + topEvents[0][1] + '回）' : '—',
  };

  _paintDashboard(dash, m);
}

// ─── Dashboard バッチ描画（2D配列で一括書き込み）────────────────
function _paintDashboard(sh, m) {
  sh.clear();

  // グリッドサイズ: 16行 × 10列
  const R = 16, C_COUNT = 10;
  const vals = _grid(R, C_COUNT, '');
  const bgs  = _grid(R, C_COUNT, C_LIGHT);
  const fgs  = _grid(R, C_COUNT, C_TEXT);
  const fss  = _grid(R, C_COUNT, 10);
  const fws  = _grid(R, C_COUNT, 'normal');
  const has  = _grid(R, C_COUNT, 'center');
  const vas  = _grid(R, C_COUNT, 'middle');

  // 0-indexed helper
  function set(r, c, val, bg, fg, fs, bold) {
    if (r < 0 || r >= R || c < 0 || c >= C_COUNT) return;
    vals[r][c] = val !== undefined ? val : '';
    if (bg)   bgs[r][c]  = bg;
    if (fg)   fgs[r][c]  = fg;
    if (fs)   fss[r][c]  = fs;
    if (bold !== undefined) fws[r][c] = bold ? 'bold' : 'normal';
  }
  // 行全体に背景色
  function row(r, bg) {
    for (let c = 0; c < C_COUNT; c++) bgs[r][c] = bg;
  }
  // セクションヘッダー（4セル分）
  function secHead(r, cStart, title, bg) {
    for (let c = cStart; c < cStart + 4; c++) bgs[r][c] = bg;
    set(r, cStart, title, bg, C_WHITE, 12, true);
  }
  // KVペア（label=左, value=右）
  function kv(r, cL, label, val, bgL, bgR, fgR, fsR, boldR) {
    set(r, cL,   label, bgL || C_GREEN3, C_TEXT, 10, false);
    set(r, cL+1, val,   bgR || C_WHITE,  fgR || C_GREEN1, fsR || 14, boldR !== false);
  }

  // ── タイトル行（row 0）────────────────────────────────────────
  row(0, C_GREEN1);
  set(0, 0, '🍙  舞昆アパート経営   経営ダッシュボード', C_GREEN1, C_WHITE, 18, true);
  set(0, 8, '最終更新: ' + _nowJST(), C_GREEN1, C_GREEN4, 9, false);

  // ── spacer（row 1）───────────────────────────────────────────
  row(1, C_GREEN1);

  // ── ゲーム状況（row 2 セクション, rows 3-5 データ）────────────
  secHead(2, 0, '🎮 ゲーム状況', C_GREEN2);
  kv(3, 0, '総プレイ人数',   m.totalPlayers, C_GREEN3, C_WHITE, C_GREEN1, 16, true);
  kv(3, 2, '今日のプレイ',   m.todayPlayers, C_GREEN3, C_WHITE, C_GREEN2, 16, true);
  kv(4, 0, '1年目クリア',    m.clearers,     C_GREEN3, C_WHITE, C_GREEN1, 16, true);
  kv(4, 2, 'クリア率',       m.clearRate,    C_GREEN3, C_WHITE, C_GOLD,   16, true);
  kv(5, 0, '平均プレイ日数', m.avgDays,      C_GREEN3, C_WHITE, C_GREEN1, 14, true);
  kv(5, 2, '平均店舗数',     m.avgStores,    C_GREEN3, C_WHITE, C_GREEN2, 14, true);

  // ── 平均値（右ブロック: cols 5-8）────────────────────────────
  secHead(2, 5, '📊 ゲーム平均値', C_GREEN2);
  kv(3, 5, '平均ブランド力', m.avgBrand,  C_GREEN3, C_WHITE, C_GREEN1, 16, true);
  kv(3, 7, '平均地域評価',   m.avgRep,    C_GREEN3, C_WHITE, C_GREEN2, 16, true);
  kv(4, 5, '平均銀行信用度', m.avgCredit, C_GREEN3, C_WHITE, C_GREEN1, 16, true);
  kv(4, 7, '平均所持金',     m.avgCash,   C_GREEN3, C_WHITE, C_GREEN2, 14, true);
  kv(5, 5, '平均入居率',     m.avgOcc,    C_GREEN3, C_WHITE, C_GREEN1, 14, true);
  kv(5, 7, '平均物件数',     m.avgBlds,   C_GREEN3, C_WHITE, C_GREEN2, 14, true);

  // ── spacer（row 6）───────────────────────────────────────────

  // ── 舞昆（row 7, rows 8-10）──────────────────────────────────
  secHead(7, 0, '🍙 舞昆（マーケティング）', C_GOLD);
  kv(8,  0, '舞昆興味あり',     m.maikons, C_GOLD_L, C_WHITE, C_GOLD, 16, true);
  kv(8,  2, 'おすすめ商品 1位', m.prod1,   C_GOLD_L, C_WHITE, C_TEXT, 10, false);
  kv(9,  0, '',                 '',        C_GOLD_L, null,    null);
  kv(9,  2, 'おすすめ商品 2位', m.prod2,   C_GOLD_L, C_WHITE, C_TEXT, 10, false);
  kv(10, 0, '',                 '',        C_GOLD_L, null,    null);
  kv(10, 2, 'おすすめ商品 3位', m.prod3,   C_GOLD_L, C_WHITE, C_TEXT, 10, false);

  // ── 大家（右ブロック）────────────────────────────────────────
  secHead(7, 5, '🏠 大家（営業）', C_ORANGE);
  kv(8,  5, '大家興味あり',     m.apts,   C_ORANGE_L, C_WHITE, C_ORANGE, 16, true);
  kv(8,  7, '人気タイプ 1位',   m.owner1, C_ORANGE_L, C_WHITE, C_TEXT,   10, false);
  kv(9,  5, '',                 '',       C_ORANGE_L, null, null);
  kv(9,  7, '人気タイプ 2位',   m.owner2, C_ORANGE_L, C_WHITE, C_TEXT,   10, false);

  // ── spacer（row 11）──────────────────────────────────────────

  // ── CRM（row 12, rows 13-15）─────────────────────────────────
  secHead(12, 0, '📱 CRM（見込み客）', C_BLUE);
  kv(13, 0, 'LINE登録数',   m.lines,     C_BLUE_L, C_WHITE, C_BLUE, 16, true);
  kv(13, 2, 'メール登録数', m.emails,    C_BLUE_L, C_WHITE, C_BLUE, 16, true);
  kv(14, 0, 'Hot Lead件数', m.hotLeads,  C_RED_L,  C_WHITE, C_RED,  16, true);
  kv(14, 2, '未対応件数',   m.pending,   C_RED_L,  C_WHITE,
    m.pending > 0 ? C_RED : C_GREEN1, 16, true);
  kv(15, 0, '今日の新規Lead', m.todayLeads, C_BLUE_L, C_WHITE, C_BLUE, 14, true);

  // ── 今日のトレンド（右ブロック）──────────────────────────────
  secHead(12, 5, '🔥 今日のトレンド', C_RED);
  kv(13, 5, '人気イベント',   m.event1, C_RED_L, C_WHITE, C_TEXT, 10, false);
  kv(14, 5, '人気タイプ',     m.owner1, C_RED_L, C_WHITE, C_TEXT, 10, false);
  kv(15, 5, '人気商品',       m.prod1,  C_RED_L, C_WHITE, C_TEXT, 10, false);

  // ── バッチ書き込み（API呼び出し：7回）────────────────────────
  const rng = sh.getRange(1, 1, R, C_COUNT);
  rng.setValues(vals);
  rng.setBackgrounds(bgs);
  rng.setFontColors(fgs);
  rng.setFontSizes(fss);
  rng.setFontWeights(fws);
  rng.setHorizontalAlignments(has);
  rng.setVerticalAlignments(vas);

  // 列幅・行高さ
  [150, 110, 160, 200, 16, 150, 110, 160, 200, 16]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setRowHeight(1, 52); sh.setRowHeight(2, 10);
  [3, 8, 13].forEach(r => sh.setRowHeight(r, 38));
  [4, 5, 6, 9, 10, 11, 14, 15, 16].forEach(r => sh.setRowHeight(r, 46));
  [7, 8, 12].forEach(r => sh.setRowHeight(r, 38));
  [7, 12].forEach(r => sh.setRowHeight(r + 1, 46)); // 補正なし

  SpreadsheetApp.flush();
}

// ================================================================
// CRM シート（バッチ書き込みで高速化）
// ================================================================
function refreshCRM() {
  const sh        = _getOrCreateSheet(S_CRM);
  const leadsRows = _getAllData(S_LEADS);

  sh.clearContents();
  sh.clearFormats();

  const headers = [
    '営業優先度','プレイヤー名','登録日時','メール','LINE',
    'おすすめ商品','おすすめ理由','大家興味','舞昆興味',
    '購入意欲スコア','オーナータイプ','最終所持金',
    'ゲームクリア','対応状況','バージョン',
  ];
  const hRange = sh.getRange(1, 1, 1, headers.length);
  hRange.setValues([headers])
        .setBackground(C_GREEN1)
        .setFontColor(C_WHITE)
        .setFontWeight('bold')
        .setFontSize(10);
  sh.setFrozenRows(1);

  if (leadsRows.length === 0) return;

  const sorted = leadsRows.slice().sort((a, b) => {
    const pa = _priority(a['営業優先度']);
    const pb = _priority(b['営業優先度']);
    if (pa !== pb) return pb - pa;
    return String(b['登録日時'] || '').localeCompare(String(a['登録日時'] || ''));
  });

  const rows = sorted.map(r => [
    r['営業優先度']     || '—',
    r['プレイヤー名']   || '匿名',
    r['登録日時']       || '',
    r['メールアドレス'] || '',
    _truthy(r['LINE登録']) ? '✓' : '',
    r['おすすめ商品']   || '—',
    r['おすすめ理由']   || '—',
    _truthy(r['大家に興味あり']) ? '★' : '',
    _truthy(r['舞昆に興味あり']) ? '★' : '',
    r['購入意欲スコア'] || 0,
    r['オーナータイプ'] || '',
    r['最終所持金']     || 0,
    r['ゲームクリア']   || '—',
    r['対応状況']       || '未対応',
    r['バージョン']     || '',
  ]);

  // 値を一括書き込み
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);

  // 背景色を2D配列で一括書き込み（行ごとにループせず）
  const rowBgs = rows.map(row => {
    const p  = String(row[0]);
    const bg = p.startsWith('🔥') ? C_RED_L
             : p.startsWith('⭐') ? C_ORANGE_L
             : p.startsWith('△') ? C_BLUE_L
             : C_LIGHT;
    return Array(headers.length).fill(bg);
  });
  sh.getRange(2, 1, rows.length, headers.length).setBackgrounds(rowBgs);

  [120,120,150,190,55,210,200,70,70,80,130,110,70,80,80]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));
  if (!sh.getFilter()) sh.getRange(1, 1, 1, headers.length).createFilter();
  SpreadsheetApp.flush();
}

// ================================================================
// Analytics シート
// ================================================================
function refreshAnalytics() {
  const sh         = _getOrCreateSheet(S_ANALYT);
  const choiceRows = _getAllData(S_CHOICE);
  const leadsRows  = _getAllData(S_LEADS);

  sh.clear();

  // 日別プレイ人数（A列）
  const dayPlayers = {};
  choiceRows.forEach(r => {
    const d = String(r['日付'] || '').slice(0, 10);
    if (!d) return;
    if (!dayPlayers[d]) dayPlayers[d] = new Set();
    dayPlayers[d].add(r['プレイヤーID']);
  });
  _writeBlock(sh, 1, 1, '📈 日別プレイ人数', ['日付','人数'], C_GREEN1,
    Object.keys(dayPlayers).sort().map(d => [d, dayPlayers[d].size]));

  // 日別LINE登録数（D列）
  const dayLines = {};
  leadsRows.forEach(r => {
    if (!_truthy(r['LINE登録'])) return;
    const d = String(r['登録日時'] || '').slice(0, 10);
    dayLines[d] = (dayLines[d] || 0) + 1;
  });
  _writeBlock(sh, 1, 4, '📱 日別LINE登録数', ['日付','登録数'], C_GREEN2,
    Object.entries(dayLines).sort().map(([d, n]) => [d, n]));

  // オーナータイプ分布（G列）
  const ownerMap = {};
  leadsRows.forEach(r => { const t = r['オーナータイプ'] || '不明'; ownerMap[t] = (ownerMap[t] || 0) + 1; });
  _writeBlock(sh, 1, 7, '🏠 オーナータイプ', ['タイプ','人数'], C_ORANGE,
    Object.entries(ownerMap).sort((a, b) => b[1] - a[1]));

  // 商品人気（J列）
  const prodMap = {};
  leadsRows.forEach(r => {
    const p = r['おすすめ商品'] || '—';
    if (p !== '—') prodMap[p] = (prodMap[p] || 0) + 1;
  });
  _writeBlock(sh, 1, 10, '🍙 商品人気', ['商品名','人数'], C_GOLD,
    Object.entries(prodMap).sort((a, b) => b[1] - a[1]));

  // エンディング分布（M列）
  const endMap = {};
  leadsRows.forEach(r => { const e = r['エンディング'] || '不明'; endMap[e] = (endMap[e] || 0) + 1; });
  _writeBlock(sh, 1, 13, '🏆 エンディング', ['エンディング','人数'], C_GOLD,
    Object.entries(endMap).sort((a, b) => b[1] - a[1]));

  [100,60,16,100,60,16,130,60,16,200,60,16,120,60]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));
  SpreadsheetApp.flush();
}

function _writeBlock(sh, startRow, startCol, title, headers, color, rows) {
  sh.getRange(startRow, startCol)
    .setValue(title)
    .setBackground(color).setFontColor(C_WHITE).setFontWeight('bold');
  sh.getRange(startRow + 1, startCol, 1, 2)
    .setValues([headers])
    .setBackground(color === C_GOLD ? C_GOLD_L : C_GREEN3);
  if (rows.length > 0) {
    sh.getRange(startRow + 2, startCol, rows.length, 2).setValues(rows);
  }
}

// ================================================================
// グラフ生成
// ================================================================
function createCharts() {
  refreshAnalytics();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(S_ANALYT);
  if (!sh) return;
  sh.getCharts().forEach(c => sh.removeChart(c));

  const playRows  = _dataRows(sh, 3, 1);
  const ownerRows = _dataRows(sh, 3, 7);
  const prodRows  = _dataRows(sh, 3, 10);

  if (playRows > 0) {
    sh.insertChart(sh.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sh.getRange(3, 1, playRows, 2))
      .setPosition(20, 1, 0, 0)
      .setOption('title', '📈 日別プレイ人数')
      .setOption('colors', [C_GREEN2])
      .setOption('legend', { position: 'none' })
      .setOption('width', 480).setOption('height', 260)
      .build());
  }
  if (ownerRows > 0) {
    sh.insertChart(sh.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sh.getRange(3, 7, ownerRows, 2))
      .setPosition(20, 5, 0, 0)
      .setOption('title', '🏠 オーナータイプ割合')
      .setOption('pieHole', 0.4)
      .setOption('width', 380).setOption('height', 260)
      .build());
  }
  if (prodRows > 0) {
    sh.insertChart(sh.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(sh.getRange(3, 10, prodRows, 2))
      .setPosition(20, 9, 0, 0)
      .setOption('title', '🍙 商品人気ランキング')
      .setOption('colors', [C_GOLD])
      .setOption('legend', { position: 'none' })
      .setOption('width', 400).setOption('height', 260)
      .build());
  }
  SpreadsheetApp.flush();
}

// ================================================================
// 条件付き書式（Leads シート）
// ================================================================
function _applyLeadsConditionalFormat() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(S_LEADS);
  if (!sh) return;
  sh.clearConditionalFormatRules();
  const maxRow  = sh.getMaxRows();
  const maxCol  = LEADS_COLS.length;
  const fullRng = sh.getRange(2, 1, maxRow - 1, maxCol);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($J2=TRUE,$K2=TRUE)')
      .setBackground(C_RED_L).setRanges([fullRng]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$J2=TRUE')
      .setBackground(C_ORANGE_L).setRanges([fullRng]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K2=TRUE')
      .setBackground(C_GREEN3).setRanges([fullRng]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$I2=TRUE')
      .setBackground(C_BLUE_L)
      .setRanges([sh.getRange(2, 9, maxRow - 1, 1)]).build(),
  ];
  sh.setConditionalFormatRules(rules);
}

// ================================================================
// 時間駆動トリガー
// ================================================================
function setTimeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoRefresh')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoRefresh').timeBased().everyMinutes(30).create();
  Logger.log('setTimeTrigger: done');
  return true;
}

function autoRefresh() {
  try {
    refreshDashboard();
    refreshCRM();
    refreshAnalytics();
    Logger.log('autoRefresh: ' + new Date());
  } catch (e) {
    Logger.log('autoRefresh error: ' + e);
  }
}

// ================================================================
// ユーティリティ
// ================================================================

function _getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) {
      sh.getRange(1, 1, 1, headers.length)
        .setValues([headers])
        .setBackground(C_GREEN1)
        .setFontColor(C_WHITE)
        .setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function _setHeaders(sheetName, headers, bgColor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  sh.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setBackground(bgColor || C_GREEN1)
    .setFontColor(C_WHITE)
    .setFontWeight('bold')
    .setFontSize(10);
  sh.setFrozenRows(1);
  if (!sh.getFilter()) sh.getRange(1, 1, 1, headers.length).createFilter();
}

function _getAllData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
  if (vals.length < 2) return [];
  const headers = vals[0];
  return vals.slice(1)
    .filter(row => row.some(v => v !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
      return obj;
    });
}

// 2D配列を初期値で埋めて生成
function _grid(rows, cols, fill) {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

function _val(v) {
  if (v === undefined || v === null) return '';
  return v;
}

function _num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function _truthy(v) {
  return v === true || v === 'TRUE' || v === 1 || v === '1' || v === 'true';
}

function _unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function _avg(arr) {
  const nums = arr.map(v => parseFloat(v)).filter(n => !isNaN(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function _priority(p) {
  const s = String(p || '');
  if (s.startsWith('🔥')) return 3;
  if (s.startsWith('⭐')) return 2;
  if (s.startsWith('△')) return 1;
  return 0;
}

function _dataRows(sh, startRow, col) {
  let r = startRow;
  while (r <= sh.getLastRow() && sh.getRange(r, col).getValue() !== '') r++;
  return r - startRow;
}

function _nowISO() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function _nowJST() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm');
}

function _todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
