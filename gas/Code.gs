// ================================================================
// 舞昆アパート経営 - 経営ダッシュボード GAS
// Google Apps Script  Code.gs
//
// 使い方:
//   1. Google スプレッドシートを開き、拡張機能 > Apps Script
//   2. このコードを貼り付けて保存
//   3. 関数「setupAll」を一度実行してシートとヘッダーを初期化
//   4. 「setTimeTrigger」を実行して30分ごとの自動更新を有効化
//   5. ウェブアプリとしてデプロイ（アクセス：全員）してURLをゲームに設定
// ================================================================

// ─── シート名 ────────────────────────────────────────────────────
const S_DASH    = 'Dashboard';
const S_CRM     = 'CRM';
const S_ANALYT  = 'Analytics';
const S_LEADS   = 'Leads';
const S_CHOICE  = 'choice';
const S_MONTHLY = 'monthly';
const S_DEBUG   = 'debug';

// ─── 舞昆カラーパレット ──────────────────────────────────────────
const C_GREEN1    = '#2E7D32';  // ヘッダー深緑
const C_GREEN2    = '#388E3C';  // サブヘッダー緑
const C_GREEN3    = '#E8F5E9';  // カード薄緑
const C_GREEN4    = '#A5D6A7';  // 中間緑
const C_GOLD      = '#F9A825';  // ゴールド
const C_GOLD_L    = '#FFF8E1';  // 薄ゴールド
const C_RED       = '#C62828';  // Hot Lead赤
const C_RED_L     = '#FFEBEE';  // 薄赤
const C_ORANGE    = '#E65100';  // 大家相談オレンジ
const C_ORANGE_L  = '#FFF3E0';  // 薄オレンジ
const C_BLUE      = '#1565C0';  // CRM青
const C_BLUE_L    = '#E3F2FD';  // 薄青
const C_WHITE     = '#FFFFFF';
const C_LIGHT     = '#FAFAFA';
const C_TEXT      = '#212121';
const C_MUTED     = '#757575';
const C_BORDER    = '#C8E6C9';

// ─── choice シートのカラム定義（英キー → 日本語ヘッダー）──────────
const CHOICE_COLS = [
  ['playerId',        'プレイヤーID'],
  ['date',            '日付'],
  ['year',            'ゲーム内年'],
  ['month',           'ゲーム内月'],
  ['day',             'ゲーム内日'],
  ['totalDays',       '総経過日数'],
  ['cash',            '所持金'],
  ['creditScore',     '銀行信用度'],
  ['rep',             '地域からの信頼'],
  ['ap',              '注意力（AP）'],
  ['fatigue',         '疲労度'],
  ['storeBrand',      '舞昆ブランド力'],
  ['communityBond',   '地域とのつながり'],
  ['customerLoyalty', '常連人数'],
  ['naritaTrust',     '成田さん信頼度'],
  ['midoriTrust',     'みどり信頼度'],
  ['ownerStyle',      'オーナータイプ'],
  ['ownerRisk',       'リスク対応力'],
  ['ownerPeople',     '人材育成力'],
  ['ownerCommunity',  '地域共生力'],
  ['ownerFinance',    '財務力'],
  ['storeCount',      '営業中店舗数'],
  ['store1profit',    '1号店日次利益'],
  ['store2profit',    '2号店日次利益'],
  ['bldCount',        '所有物件数'],
  ['bld1occ',         '1号物件入居率'],
  ['bld2occ',         '2号物件入居率'],
  ['staffCount',      'スタッフ数'],
  ['pendingCases',    '未対応案件数'],
  ['type',            'データ種別'],
  ['gameVersion',     'ゲームバージョン'],
  ['playerName',      'プレイヤー名'],
  ['eventId',         'イベントID'],
  ['choice',          '選択結果'],
];

// ─── monthly シートのカラム定義 ──────────────────────────────────
const MONTHLY_COLS = [
  ['playerId',           'プレイヤーID'],
  ['date',               '記録日'],
  ['year',               'ゲーム内年'],
  ['month',              'ゲーム内月'],
  ['totalDays',          '総経過日数'],
  ['cash',               '所持金'],
  ['creditScore',        '銀行信用度'],
  ['rep',                '地域からの信頼'],
  ['storeBrand',         '舞昆ブランド力'],
  ['communityBond',      '地域とのつながり'],
  ['customerLoyalty',    '常連人数'],
  ['ownerStyle',         'オーナータイプ'],
  ['storeCount',         '店舗数'],
  ['bldCount',           '物件数'],
  ['bld1occ',            '1号物件入居率'],
  ['bld2occ',            '2号物件入居率'],
  ['staffCount',         'スタッフ数'],
  ['monthProfit',        '月次利益'],
  ['freeMode',           'フリーモード'],
  ['mainStoryCompleted', '1年目クリア'],
  ['gameVersion',        'バージョン'],
  ['playerName',         'プレイヤー名'],
];

// ─── Leads シートのカラム定義（追加列含む）──────────────────────
const LEADS_COLS = [
  ['registeredAt',      '登録日時'],        // A(1)
  ['playerId',          'プレイヤーID'],    // B(2)
  ['playerName',        'プレイヤー名'],    // C(3)
  ['age',               '年代'],            // D(4)
  ['occupation',        '職業'],            // E(5)
  ['experience',        '経験'],            // F(6)
  ['region',            '地域'],            // G(7)
  ['email',             'メールアドレス'],  // H(8)
  ['line',              'LINE登録'],        // I(9)
  ['interestApartment', '大家に興味あり'],  // J(10) ← 条件付き書式キー
  ['interestMaikon',    '舞昆に興味あり'],  // K(11) ← 条件付き書式キー
  ['ownerType',         'オーナータイプ'],
  ['ownerStyleKey',     'スタイルキー'],
  ['ownerScore',        '総合スコア'],
  ['profileRisk',       'リスク志向'],
  ['profilePeople',     '人材志向'],
  ['profileCommunity',  '地域志向'],
  ['profileFinance',    '財務志向'],
  ['storeBrand',        'ブランド力'],
  ['customerLoyalty',   '常連数'],
  ['communityBond',     '地域の絆'],
  ['finalCash',         '最終所持金'],
  ['finalRep',          '最終地域評価'],
  ['loanCount',         '融資回数'],
  ['staffCount',        'スタッフ数'],
  ['occPct',            '入居率'],
  ['ending',            'エンディング'],
  ['gameVersion',       'バージョン'],
  ['source',            'ソース'],
  // ── 計算追加列 ──────────────────────────────────────────
  ['recommendedProduct','おすすめ商品'],
  ['recommendedReason', 'おすすめ理由'],
  ['gameCleared',       'ゲームクリア'],
  ['purchaseScore',     '購入意欲スコア'],
  ['salesPriority',     '営業優先度'],
  ['actionStatus',      '対応状況'],
];

// ================================================================
// onOpen: カスタムメニュー
// ================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍙 舞昆ダッシュボード')
    .addItem('▶ 初回セットアップ', 'setupAll')
    .addSeparator()
    .addItem('🔄 Dashboard更新', 'refreshDashboard')
    .addItem('🔄 CRM更新', 'refreshCRM')
    .addItem('🔄 Analytics更新', 'refreshAnalytics')
    .addItem('📊 グラフ再生成', 'createCharts')
    .addSeparator()
    .addItem('⏰ 自動更新トリガー設定（30分）', 'setTimeTrigger')
    .addToUi();
}

// ================================================================
// doPost: エントリーポイント（ゲームからのデータ受信）
// ================================================================
function doPost(e) {
  try {
    const raw  = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(raw);
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
// ================================================================
function routeData(data) {
  const type = (data.type || 'choice').toLowerCase();

  if (data.testMode) {
    saveDebug(data);
    return;
  }

  if (type === 'lead') {
    saveLead(data);
  } else if (type === 'monthly') {
    saveMonthly(data);
    // monthlyはchoiceの上位互換なので両方書く
    saveChoice(data);
  } else {
    saveChoice(data);
  }

  // Dashboard非同期更新（重い処理なので別トリガーに任せてもよい）
  try { refreshDashboard(); } catch (ex) { Logger.log('dashboard err: ' + ex); }
}

// ================================================================
// シート書き込み
// ================================================================

function saveChoice(data) {
  const sh   = _getOrCreateSheet(S_CHOICE, CHOICE_COLS.map(c => c[1]));
  const keys = CHOICE_COLS.map(c => c[0]);
  sh.appendRow(keys.map(k => _val(data[k])));
}

function saveMonthly(data) {
  const sh   = _getOrCreateSheet(S_MONTHLY, MONTHLY_COLS.map(c => c[1]));
  const keys = MONTHLY_COLS.map(c => c[0]);
  sh.appendRow(keys.map(k => _val(data[k])));
}

function saveLead(data) {
  const sh = _getOrCreateSheet(S_LEADS, LEADS_COLS.map(c => c[1]));
  data.registeredAt      = _nowISO();
  data.recommendedProduct = _calcProduct(data);
  data.recommendedReason  = _calcReason(data);
  data.gameCleared        = _calcCleared(data);
  data.purchaseScore      = _calcPurchaseScore(data);
  data.salesPriority      = _calcSalesPriority(data);
  data.actionStatus       = '未対応';
  const keys = LEADS_COLS.map(c => c[0]);
  sh.appendRow(keys.map(k => _val(data[k])));
}

function saveDebug(data) {
  const sh = _getOrCreateSheet(S_DEBUG, ['受信日時', 'type', 'playerId', 'JSON全文']);
  sh.appendRow([_nowISO(), data.type || '', data.playerId || '', JSON.stringify(data)]);
}

// ================================================================
// 計算ヘルパー
// ================================================================

function _calcProduct(d) {
  if (!d.interestMaikon) {
    return d.interestApartment ? '大家向け相談資料' : '—';
  }
  const k = d.ownerStyleKey || '';
  if (k === 'community') return 'たもぎ茸舞昆 地域ギフトセット';
  if (k === 'people')    return '舞昆 定番セット（おにぎり向け）';
  if (k === 'finance')   return '舞昆 業務用・ファミリーパック';
  return '舞昆 お試しセット';
}

function _calcReason(d) {
  const tags = [];
  if (d.interestMaikon)      tags.push('舞昆に興味あり');
  if (d.interestApartment)   tags.push('大家に興味あり');
  if (d.occPct >= 80)        tags.push('高入居率達成');
  if (d.communityBond >= 50) tags.push('地域とのつながり強い');
  if (d.storeBrand >= 60)    tags.push('ブランド力高い');
  return tags.join(' / ') || '—';
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
  const hasMaikon = !!d.interestMaikon;
  const hasApt    = !!d.interestApartment;
  const hasContact = !!(d.email || d.line);
  if (hasMaikon && hasApt && hasContact) return '🔥 Hot';
  if ((hasMaikon || hasApt) && hasContact) return '⭐ Warm';
  if (hasMaikon || hasApt)               return '△ Cold';
  return '— 様子見';
}

// ================================================================
// Dashboard 更新
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
    ? Math.round(clearPids.length / allPids.length * 100) + '%'
    : '—';

  // プレイヤーごとの最大経過日数
  const maxDaysMap = {};
  choiceRows.forEach(r => {
    const p = r['プレイヤーID']; const d = _num(r['総経過日数']);
    maxDaysMap[p] = Math.max(maxDaysMap[p] || 0, d);
  });
  const avgDays = _avg(Object.values(maxDaysMap));

  // 最新レコードから平均値
  const latestMap = {};
  choiceRows.forEach(r => { latestMap[r['プレイヤーID']] = r; });
  const latestList = Object.values(latestMap);
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
  const maikons   = leadsRows.filter(r => _truthy(r['舞昆に興味あり']));
  const apts      = leadsRows.filter(r => _truthy(r['大家に興味あり']));
  const lineRegs  = leadsRows.filter(r => _truthy(r['LINE登録']));
  const mailRegs  = leadsRows.filter(r => r['メールアドレス'] && String(r['メールアドレス']).includes('@'));
  const hotLeads  = leadsRows.filter(r => String(r['営業優先度']).startsWith('🔥'));
  const pending   = leadsRows.filter(r => r['対応状況'] === '未対応');
  const todayLds  = leadsRows.filter(r => String(r['登録日時']).startsWith(today));

  // オーナータイプ集計
  const ownerMap = {};
  leadsRows.forEach(r => {
    const t = r['オーナータイプ'] || '不明'; ownerMap[t] = (ownerMap[t] || 0) + 1;
  });
  const topOwners = Object.entries(ownerMap).sort((a, b) => b[1] - a[1]);

  // おすすめ商品集計
  const prodMap = {};
  leadsRows.forEach(r => {
    const p = r['おすすめ商品'] || '—';
    if (p !== '—') prodMap[p] = (prodMap[p] || 0) + 1;
  });
  const topProds = Object.entries(prodMap).sort((a, b) => b[1] - a[1]);

  // 今日のイベント集計（choice）
  const evMap = {};
  choiceRows.filter(r => String(r['日付']).startsWith(today)).forEach(r => {
    const ev = r['イベントID'] || '—'; evMap[ev] = (evMap[ev] || 0) + 1;
  });
  const topEvents = Object.entries(evMap).sort((a, b) => b[1] - a[1]);

  // ── Dashboard に書き込む ──────────────────────────────────────
  _paintDashboard(dash, {
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
    prod1 : topProds[0] ? topProds[0][0] + '（' + topProds[0][1] + '人）' : '—',
    prod2 : topProds[1] ? topProds[1][0] + '（' + topProds[1][1] + '人）' : '—',
    prod3 : topProds[2] ? topProds[2][0] + '（' + topProds[2][1] + '人）' : '—',
    owner1 : topOwners[0] ? topOwners[0][0] + '（' + topOwners[0][1] + '人）' : '—',
    owner2 : topOwners[1] ? topOwners[1][0] + '（' + topOwners[1][1] + '人）' : '—',
    event1 : topEvents[0] ? topEvents[0][0] + '（' + topEvents[0][1] + '回）' : '—',
  });
}

// ─── Dashboard 描画 ──────────────────────────────────────────────
function _paintDashboard(sh, m) {
  sh.clear();

  // レイアウト定義: [row, col, value, bg, fg, fontSize, bold]
  const layout = [
    // ── タイトル行 ─────────────────────────────────────────────
    [1, 1, '🍙  舞昆アパート経営   経営ダッシュボード', C_GREEN1, C_WHITE, 18, true],
    [1, 8, '最終更新: ' + _nowJST(), C_GREEN1, C_GREEN4, 10, false],

    // ── 左ブロック: ゲーム状況 ────────────────────────────────
    [3, 1, '🎮 ゲーム状況（社長用）', C_GREEN2, C_WHITE, 12, true],
    [4, 1, '総プレイ人数',     C_GREEN3, C_TEXT,   11, false],
    [4, 2, m.totalPlayers,    C_WHITE,  C_GREEN1, 16, true],
    [4, 3, '今日のプレイ',     C_GREEN3, C_TEXT,   11, false],
    [4, 4, m.todayPlayers,    C_WHITE,  C_GREEN2, 16, true],
    [5, 1, '1年目クリア',      C_GREEN3, C_TEXT,   11, false],
    [5, 2, m.clearers,        C_WHITE,  C_GREEN1, 16, true],
    [5, 3, 'クリア率',         C_GREEN3, C_TEXT,   11, false],
    [5, 4, m.clearRate,       C_WHITE,  C_GOLD,   16, true],
    [6, 1, '平均プレイ日数',   C_GREEN3, C_TEXT,   11, false],
    [6, 2, m.avgDays,         C_WHITE,  C_GREEN1, 16, true],
    [6, 3, '平均店舗数',       C_GREEN3, C_TEXT,   11, false],
    [6, 4, m.avgStores,       C_WHITE,  C_GREEN2, 16, true],

    // ── 右ブロック: ゲーム平均値 ──────────────────────────────
    [3, 6, '📊 ゲーム平均値', C_GREEN2, C_WHITE, 12, true],
    [4, 6, '平均ブランド力',   C_GREEN3, C_TEXT,   11, false],
    [4, 7, m.avgBrand,        C_WHITE,  C_GREEN1, 16, true],
    [4, 8, '平均地域評価',     C_GREEN3, C_TEXT,   11, false],
    [4, 9, m.avgRep,          C_WHITE,  C_GREEN2, 16, true],
    [5, 6, '平均銀行信用度',   C_GREEN3, C_TEXT,   11, false],
    [5, 7, m.avgCredit,       C_WHITE,  C_GREEN1, 16, true],
    [5, 8, '平均所持金',       C_GREEN3, C_TEXT,   11, false],
    [5, 9, m.avgCash,         C_WHITE,  C_GREEN2, 16, true],
    [6, 6, '平均入居率',       C_GREEN3, C_TEXT,   11, false],
    [6, 7, m.avgOcc,          C_WHITE,  C_GREEN1, 16, true],
    [6, 8, '平均物件数',       C_GREEN3, C_TEXT,   11, false],
    [6, 9, m.avgBlds,         C_WHITE,  C_GREEN2, 16, true],

    // ── 舞昆ブロック ──────────────────────────────────────────
    [8,  1, '🍙 舞昆（マーケティング）', C_GOLD, C_WHITE, 12, true],
    [9,  1, '舞昆興味あり',     C_GOLD_L, C_TEXT,  11, false],
    [9,  2, m.maikons,         C_WHITE,  C_GOLD,  16, true],
    [9,  3, 'おすすめ商品 1位', C_GOLD_L, C_TEXT,  11, false],
    [9,  4, m.prod1,           C_WHITE,  C_TEXT,  11, false],
    [10, 1, '',                C_GOLD_L, C_TEXT,  11, false],
    [10, 2, '',                C_WHITE,  C_TEXT,  11, false],
    [10, 3, 'おすすめ商品 2位', C_GOLD_L, C_TEXT,  11, false],
    [10, 4, m.prod2,           C_WHITE,  C_TEXT,  11, false],
    [11, 1, '',                C_GOLD_L, C_TEXT,  11, false],
    [11, 2, '',                C_WHITE,  C_TEXT,  11, false],
    [11, 3, 'おすすめ商品 3位', C_GOLD_L, C_TEXT,  11, false],
    [11, 4, m.prod3,           C_WHITE,  C_TEXT,  11, false],

    // ── 大家ブロック ──────────────────────────────────────────
    [8,  6, '🏠 大家（営業）', C_ORANGE, C_WHITE, 12, true],
    [9,  6, '大家興味あり',     C_ORANGE_L, C_TEXT,   11, false],
    [9,  7, m.apts,            C_WHITE,    C_ORANGE, 16, true],
    [9,  8, '人気タイプ 1位',   C_ORANGE_L, C_TEXT,   11, false],
    [9,  9, m.owner1,          C_WHITE,    C_TEXT,   11, false],
    [10, 6, '',                C_ORANGE_L, C_TEXT,   11, false],
    [10, 7, '',                C_WHITE,    C_TEXT,   11, false],
    [10, 8, '人気タイプ 2位',   C_ORANGE_L, C_TEXT,   11, false],
    [10, 9, m.owner2,          C_WHITE,    C_TEXT,   11, false],

    // ── CRMブロック ──────────────────────────────────────────
    [13, 1, '📱 CRM（見込み客）', C_BLUE, C_WHITE, 12, true],
    [14, 1, 'LINE登録数',       C_BLUE_L, C_TEXT,  11, false],
    [14, 2, m.lines,           C_WHITE,  C_BLUE,  16, true],
    [14, 3, 'メール登録数',     C_BLUE_L, C_TEXT,  11, false],
    [14, 4, m.emails,          C_WHITE,  C_BLUE,  16, true],
    [15, 1, 'Hot Lead件数',    C_RED_L,  C_TEXT,  11, false],
    [15, 2, m.hotLeads,        C_WHITE,  C_RED,   16, true],
    [15, 3, '未対応件数',       C_RED_L,  C_TEXT,  11, false],
    [15, 4, m.pending,         C_WHITE,  m.pending > 0 ? C_RED : C_GREEN1, 16, true],
    [16, 1, '今日の新規Lead',   C_BLUE_L, C_TEXT,  11, false],
    [16, 2, m.todayLeads,      C_WHITE,  C_BLUE,  16, true],

    // ── 今日のトレンド ────────────────────────────────────────
    [13, 6, '🔥 今日のトレンド', C_RED, C_WHITE, 12, true],
    [14, 6, '人気イベント',      C_RED_L, C_TEXT, 11, false],
    [14, 7, m.event1,           C_WHITE,  C_TEXT, 11, false],
    [15, 6, '人気タイプ',        C_RED_L, C_TEXT, 11, false],
    [15, 7, m.owner1,           C_WHITE,  C_TEXT, 11, false],
    [16, 6, '人気商品',          C_RED_L, C_TEXT, 11, false],
    [16, 7, m.prod1,            C_WHITE,  C_TEXT, 11, false],
  ];

  layout.forEach(([row, col, val, bg, fg, fs, bold]) => {
    const cell = sh.getRange(row, col);
    cell.setValue(val)
        .setBackground(bg)
        .setFontColor(fg)
        .setFontSize(fs)
        .setFontWeight(bold ? 'bold' : 'normal')
        .setVerticalAlignment('middle')
        .setHorizontalAlignment('center')
        .setWrap(false);
  });

  // 列幅
  [150, 120, 160, 210, 20, 160, 120, 160, 210].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // 行高さ
  sh.setRowHeight(1, 52);
  sh.setRowHeight(2, 10);
  [3, 8, 13].forEach(r => sh.setRowHeight(r, 38));
  [4, 5, 6, 9, 10, 11, 14, 15, 16].forEach(r => sh.setRowHeight(r, 46));
  [7, 12].forEach(r => sh.setRowHeight(r, 14));

  SpreadsheetApp.flush();
}

// ================================================================
// CRM シート（営業担当用リスト）
// ================================================================
function refreshCRM() {
  const sh        = _getOrCreateSheet(S_CRM);
  const leadsRows = _getAllData(S_LEADS);

  sh.clearContents();
  sh.clearFormats();

  const headers = [
    '営業優先度', 'プレイヤー名', '登録日時', 'メール', 'LINE',
    'おすすめ商品', 'おすすめ理由', '大家興味', '舞昆興味',
    '購入意欲スコア', 'オーナータイプ', '最終所持金',
    'ゲームクリア', '対応状況', 'バージョン',
  ];
  const hRange = sh.getRange(1, 1, 1, headers.length);
  hRange.setValues([headers])
        .setBackground(C_GREEN1)
        .setFontColor(C_WHITE)
        .setFontWeight('bold')
        .setFontSize(10);
  sh.setFrozenRows(1);

  const sorted = leadsRows.slice().sort((a, b) => {
    const pa = _priority(a['営業優先度']);
    const pb = _priority(b['営業優先度']);
    if (pa !== pb) return pb - pa;
    return String(b['登録日時']).localeCompare(String(a['登録日時']));
  });

  if (sorted.length === 0) return;

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

  const body = sh.getRange(2, 1, rows.length, headers.length);
  body.setValues(rows);

  // 行ごとに色付け
  rows.forEach((row, i) => {
    const p   = String(row[0]);
    const rng = sh.getRange(i + 2, 1, 1, headers.length);
    if (p.startsWith('🔥'))      rng.setBackground(C_RED_L);
    else if (p.startsWith('⭐')) rng.setBackground(C_ORANGE_L);
    else if (p.startsWith('△')) rng.setBackground(C_BLUE_L);
    else                          rng.setBackground(C_LIGHT);
  });

  // 列幅
  [120, 120, 150, 190, 55, 210, 200, 70, 70, 90, 130, 110, 80, 80, 80]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  if (!sh.getFilter()) sh.getRange(1, 1, 1, headers.length).createFilter();
  SpreadsheetApp.flush();
}

// ================================================================
// Analytics シート（開発者用グラフデータ）
// ================================================================
function refreshAnalytics() {
  const sh         = _getOrCreateSheet(S_ANALYT);
  const choiceRows = _getAllData(S_CHOICE);
  const leadsRows  = _getAllData(S_LEADS);

  sh.clear();

  // ── 日別プレイ人数 (A列) ──────────────────────────────────────
  const dayPlayers = {};
  choiceRows.forEach(r => {
    const d = String(r['日付'] || '').slice(0, 10);
    if (!d) return;
    if (!dayPlayers[d]) dayPlayers[d] = new Set();
    dayPlayers[d].add(r['プレイヤーID']);
  });
  const dayKeys = Object.keys(dayPlayers).sort();
  _writeBlock(sh, 1, 1, '📈 日別プレイ人数', ['日付', '人数'], C_GREEN1,
    dayKeys.map(d => [d, dayPlayers[d].size]));

  // ── 日別LINE登録数 (D列) ──────────────────────────────────────
  const dayLines = {};
  leadsRows.forEach(r => {
    if (!_truthy(r['LINE登録'])) return;
    const d = String(r['登録日時'] || '').slice(0, 10);
    dayLines[d] = (dayLines[d] || 0) + 1;
  });
  _writeBlock(sh, 1, 4, '📱 日別LINE登録数', ['日付', '登録数'], C_GREEN2,
    Object.entries(dayLines).sort().map(([d, n]) => [d, n]));

  // ── オーナータイプ分布 (G列) ──────────────────────────────────
  const ownerMap = {};
  leadsRows.forEach(r => {
    const t = r['オーナータイプ'] || '不明'; ownerMap[t] = (ownerMap[t] || 0) + 1;
  });
  _writeBlock(sh, 1, 7, '🏠 オーナータイプ', ['タイプ', '人数'], C_ORANGE,
    Object.entries(ownerMap).sort((a, b) => b[1] - a[1]));

  // ── 商品人気ランキング (J列) ──────────────────────────────────
  const prodMap = {};
  leadsRows.forEach(r => {
    const p = r['おすすめ商品'] || '—';
    if (p !== '—') prodMap[p] = (prodMap[p] || 0) + 1;
  });
  _writeBlock(sh, 1, 10, '🍙 商品人気', ['商品名', '人数'], C_GOLD,
    Object.entries(prodMap).sort((a, b) => b[1] - a[1]));

  // ── エンディング分布 (M列) ────────────────────────────────────
  const endMap = {};
  leadsRows.forEach(r => {
    const e = r['エンディング'] || '不明'; endMap[e] = (endMap[e] || 0) + 1;
  });
  _writeBlock(sh, 1, 13, '🏆 エンディング', ['エンディング', '人数'], C_GOLD,
    Object.entries(endMap).sort((a, b) => b[1] - a[1]));

  // 列幅
  [100, 60, 16, 100, 60, 16, 130, 60, 16, 200, 60, 16, 120, 60]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  SpreadsheetApp.flush();
}

function _writeBlock(sh, startRow, startCol, title, headers, color, rows) {
  sh.getRange(startRow, startCol).setValue(title)
    .setBackground(color).setFontColor(C_WHITE).setFontWeight('bold');
  sh.getRange(startRow + 1, startCol, 1, 2).setValues([headers])
    .setBackground(color === C_GOLD ? C_GOLD_L : C_GREEN3);
  if (rows.length > 0) {
    sh.getRange(startRow + 2, startCol, rows.length, 2).setValues(rows);
  }
}

// ================================================================
// グラフ生成（Analyticsシートに挿入）
// ================================================================
function createCharts() {
  refreshAnalytics();
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sh     = ss.getSheetByName(S_ANALYT);
  if (!sh) return;

  sh.getCharts().forEach(c => sh.removeChart(c));

  const lastRow = sh.getLastRow();
  if (lastRow < 3) return;

  // 日別プレイ人数（折れ線グラフ）
  const playRows = _dataRows(sh, 3, 1);
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

  // オーナータイプ（ドーナツグラフ）
  const ownerRows = _dataRows(sh, 3, 7);
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

  // 商品人気（横棒グラフ）
  const prodRows = _dataRows(sh, 3, 10);
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
// 初回セットアップ
// ================================================================
function setupAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // シートを所定順に作成
  [S_DASH, S_CRM, S_ANALYT, S_LEADS, S_CHOICE, S_MONTHLY, S_DEBUG].forEach((name, i) => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name, i);
  });

  // ヘッダー設定
  _setHeaders(S_CHOICE,  CHOICE_COLS.map(c => c[1]),  C_GREEN1);
  _setHeaders(S_MONTHLY, MONTHLY_COLS.map(c => c[1]), C_GREEN2);
  _setHeaders(S_LEADS,   LEADS_COLS.map(c => c[1]),   C_GOLD);
  _setHeaders(S_DEBUG,   ['受信日時', 'type', 'playerId', 'JSON全文'], C_MUTED);

  // Leads 条件付き書式
  _applyLeadsConditionalFormat();

  // 全シート更新
  refreshDashboard();
  refreshCRM();
  refreshAnalytics();

  ss.setActiveSheet(ss.getSheetByName(S_DASH));
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✅ セットアップ完了！\n\nDashboard / CRM / Analytics / Leads / choice / monthly シートが準備されました。');
}

// ================================================================
// Leads 条件付き書式
// ================================================================
function _applyLeadsConditionalFormat() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(S_LEADS);
  if (!sh) return;

  sh.clearConditionalFormatRules();

  const maxRow  = sh.getMaxRows();
  const maxCol  = LEADS_COLS.length;
  const fullRng = sh.getRange(2, 1, maxRow - 1, maxCol);

  // 大家＋舞昆両方 → Hot（薄赤）  ※ J列=interestApartment, K列=interestMaikon
  const hotRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($J2=TRUE,$K2=TRUE)')
    .setBackground(C_RED_L)
    .setRanges([fullRng]).build();

  // 大家のみ → 薄オレンジ
  const aptRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$J2=TRUE')
    .setBackground(C_ORANGE_L)
    .setRanges([fullRng]).build();

  // 舞昆のみ → 薄緑
  const maikRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$K2=TRUE')
    .setBackground(C_GREEN3)
    .setRanges([fullRng]).build();

  // LINE登録 → 薄青
  const lineRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$I2=TRUE')
    .setBackground(C_BLUE_L)
    .setRanges([sh.getRange(2, 9, maxRow - 1, 1)]).build();

  sh.setConditionalFormatRules([hotRule, aptRule, maikRule, lineRule]);
}

// ================================================================
// 時間駆動トリガー
// ================================================================
function setTimeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoRefresh')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('autoRefresh')
    .timeBased().everyMinutes(30).create();

  SpreadsheetApp.getUi().alert('✅ 30分ごとの自動更新トリガーを設定しました。');
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
  let sh   = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) {
      const hRng = sh.getRange(1, 1, 1, headers.length);
      hRng.setValues([headers])
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
  const hRng = sh.getRange(1, 1, 1, headers.length);
  hRng.setValues([headers])
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
  if (!p) return 0;
  const s = String(p);
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
