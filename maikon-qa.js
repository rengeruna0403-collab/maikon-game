/**
 * 舞昆茶屋物語 QAツール Phase 1
 * ?qa=1 または ?debug=1 の場合のみ動作
 * ゲーム本体への影響なし・読み取り専用
 */
(function () {
  'use strict';

  // ─── ガード：QAモード以外では即終了 ───
  if (!/[?&](qa|debug)=1/.test(location.search)) return;

  const QA_VERSION = 'Phase 1 v1.0';

  // ─── 既知 effects フィールド（chooseEvent / applyEffects から収集）───
  const KNOWN_FX = new Set([
    // 基本ゲーム値
    'score', 'rep', 'storeSat', 'staffSat', 'custRegular', 'custUp', 'credit',
    'money', 'monthlyBonus', 'fatigue', 'resilience',
    // キャラクター
    'charMeet', 'charLevel', 'charComplete', 'charNote', 'charTarget', 'charNoteText',
    'charComplete',
    // 信頼・絆
    'naritaTrust', 'midoriTrust', 'communityBond', 'customerLoyalty', 'storeBrand',
    // 物件
    'roomSat', 'newBuilding',
    // スタッフ採用
    'hireStaff', 'showMidoriInterview', 'hireArubaito', 'hireLunchStaff',
    // 商品・メニュー
    'unlockProduct', 'unlockEatIn', 'unlockSeasonalGift', 'pendingMenuId',
    // 特殊フロー
    'startBentoDev', 'snsPost', 'adRoll',
    'tamogitakeTastingPending', 'tamogitakeRetryPending', '_bentoSkipSeason',
    '_setCooldown',
    // 来客ボーナス
    'custBonusPerDay', 'custBonusDays', 'source',
    // プロフィール
    'profile',
    // その他（followUp サブフィールドは除く）
  ]);

  // ─── 季節キーワードルール ───
  const SEASONAL_RULES = [
    { kw: '母の日',   minM: 5,  maxM: 5,  label: '5月限定' },
    { kw: '父の日',   minM: 6,  maxM: 6,  label: '6月限定' },
    { kw: 'お中元',   minM: 7,  maxM: 8,  label: '7〜8月' },
    { kw: '敬老の日', minM: 9,  maxM: 9,  label: '9月限定' },
    { kw: 'お歳暮',   minM: 11, maxM: 12, label: '11〜12月' },
    { kw: '夏祭り',   minM: 7,  maxM: 8,  label: '7〜8月' },
    { kw: 'クリスマス',minM:12, maxM: 12, label: '12月限定' },
    { kw: 'お正月',   minM: 1,  maxM: 1,  label: '1月限定' },
    { kw: '桜まつり', minM: 3,  maxM: 4,  label: '3〜4月' },
  ];

  // ─── 見送り系ラベルキーワード ───
  const DECLINE_KW = ['見送る', '断る', '今は難しい', '今は無理', '今回は難しい', '様子を見る', '今回は見送', '参加しない'];

  // ─── スタッフ系送信者キーワード ───
  const STAFF_SENDER_KW = ['スタッフ', 'みどり（スタッフ）'];

  // ─── 空室系送信者キーワード ───
  const VACANCY_SENDER_KW = ['申込者', '空室'];

  // ─── 有効プロダクトID ───
  const VALID_PRODUCT_IDS = new Set(
    Object.keys(window.UNLOCKED_PRODUCT_CATALOG || {})
  );

  // ══════════════════════════════════════════════════════════════
  // ■ 1. データ収集
  // ══════════════════════════════════════════════════════════════

  function collectAllCases() {
    const pools = [
      { name: 'CASE_POOL',          arr: window.CASE_POOL          || [] },
      { name: 'DOMAIN_CASES',       arr: window.DOMAIN_CASES       || [] },
      { name: 'DAILY_EVENTS',       arr: window.DAILY_EVENTS       || [] },
      { name: 'MONTHLY_CHALLENGES', arr: window.MONTHLY_CHALLENGES || [] },
      { name: 'ISSUE_CARDS',        arr: window.ISSUE_CARDS        || [] },
    ];

    const all = [];
    const idMap = {}; // id → [poolName, ...]

    for (const pool of pools) {
      for (const c of pool.arr) {
        const tagged = Object.assign({}, c, { _pool: pool.name });
        all.push(tagged);
        const key = c.id || '__no_id__';
        if (!idMap[key]) idMap[key] = [];
        idMap[key].push(pool.name);
      }
    }

    return { cases: all, idMap };
  }

  // ══════════════════════════════════════════════════════════════
  // ■ 2. 静的監査エンジン
  // ══════════════════════════════════════════════════════════════

  function runStaticAudit(cases, idMap) {
    const warnings = [];
    let w08SuppressedCount = 0; // W08は個別出力しないでサマリに集約

    function warn(severity, c, issue, field, current, recommendation, fpRisk) {
      warnings.push({
        severity,
        eventId:           c.id    || '(no id)',
        title:             c.title || c.label || '(no title)',
        sourcePool:        c._pool || '?',
        issue,
        field:             field        || '',
        current:           current !== undefined ? String(current) : '',
        recommendation:    recommendation || '',
        falsePositiveRisk: fpRisk || '低',
        _raw: c,
      });
    }

    // ── W01: 重複 eventId ──
    for (const [id, pools] of Object.entries(idMap)) {
      if (id === '__no_id__') continue;
      if (pools.length > 1) {
        const c = cases.find(x => x.id === id) || { id, _pool: pools.join(',') };
        warn('P0', c,
          `eventId "${id}" が ${pools.join(' / ')} の ${pools.length} 箇所で重複`,
          'id', id,
          'いずれかを削除するか別 ID に変更',
          '低');
      }
    }

    for (const c of cases) {
      const title   = c.title  || c.label || '';
      const body    = c.body   || '';
      const text    = title + ' ' + body;
      const choices = Array.isArray(c.choices) ? c.choices : [];

      // ── W02: ID なし ──
      if (!c.id) {
        warn('P2', c, 'eventId が未設定', 'id', '(undefined)', 'id フィールドを追加', '低');
      }

      // ── W03: 季節キーワード × 月条件 ──
      for (const rule of SEASONAL_RULES) {
        if (!text.includes(rule.kw)) continue;
        const hasMin = c.minMonth !== undefined;
        const hasMax = c.maxMonth !== undefined;
        if (!hasMin || !hasMax) {
          warn('P1', c,
            `季節キーワード「${rule.kw}」があるが minMonth/maxMonth がない`,
            'minMonth / maxMonth',
            `min:${c.minMonth ?? 'なし'} max:${c.maxMonth ?? 'なし'}`,
            `minMonth:${rule.minM}, maxMonth:${rule.maxM} の追加を検討`,
            '中（コンテキストが別の場合あり）');
        } else if (c.minMonth > rule.minM || c.maxMonth < rule.maxM) {
          warn('P1', c,
            `「${rule.kw}」の月条件が期待値と異なる（期待 ${rule.minM}〜${rule.maxM}月）`,
            'minMonth / maxMonth',
            `${c.minMonth}〜${c.maxMonth}月`,
            `${rule.minM}〜${rule.maxM}月 を検討`,
            '高（ゲームデザイン上の意図的な設定の可能性あり）');
        }
      }

      // ── W04: 「秋」タイトルなのに 8 月以前に発生可能 ──
      if (title.includes('秋') && !c.minMonth && !c.conditionOnly) {
        warn('P2', c,
          `タイトルに「秋」が含まれるが minMonth がない（4月〜から出現可能）`,
          'minMonth',
          String(c.minMonth ?? 'なし'),
          'minMonth:9 などを追加',
          '高（テーマが秋でも常時提供の場合あり）');
      }

      // ── W05: スタッフ系送信者なのに requireStaff なし ──
      if (STAFF_SENDER_KW.some(kw => (c.sender || '').includes(kw))) {
        if (!c.requireStaff && !c.conditionOnly) {
          warn('P1', c,
            `送信者「${c.sender}」はスタッフ系だが requireStaff:true がない`,
            'requireStaff',
            String(c.requireStaff ?? 'なし'),
            'requireStaff:true を追加 または conditionOnly:true で個別制御を確認',
            '高（conditionOnly:true で個別生成の場合は誤検知）');
        }
      }

      // ── W06: 空室系送信者なのに requireVacancy なし（landlord ドメインのみ） ──
      if (c.domain === 'landlord' && VACANCY_SENDER_KW.some(kw => (c.sender || '').includes(kw))) {
        if (!c.requireVacancy && c.maxOccupancyPct === undefined) {
          warn('P2', c,
            `送信者「${c.sender}」は空室系だが requireVacancy / maxOccupancyPct がない`,
            'requireVacancy',
            String(c.requireVacancy ?? 'なし'),
            'requireVacancy:true を追加',
            '中（入居者向け案件の場合は正常）');
        }
      }

      // ── W07: 見送り系選択肢に noAP:true なし ──
      if ((c.apCost || 0) > 0) {
        for (let ci = 0; ci < choices.length; ci++) {
          const ch = choices[ci];
          const lbl = ch.label || '';
          if (DECLINE_KW.some(kw => lbl.includes(kw)) && !ch.noAP) {
            warn('P1', c,
              `choice[${ci}]「${lbl.slice(0, 24)}…」が見送り系だが noAP:true がない（AP不足時に選択不能）`,
              `choices[${ci}].noAP`,
              'false',
              'noAP:true を追加してください',
              '中（実際にAP消費して対応する場合は誤検知）');
          }
        }
      }

      // ── W08: repeatable のクールダウン確認 ──
      if (c.repeatable) {
        const cdMap = window.CASE_COOLDOWN_DAYS || {};
        if (!cdMap[c.id]) {
          w08SuppressedCount++; // 個別警告は出さずサマリに集約
        }
      }

      // ── W09: 季節限定 + repeatable なのに oncePerYear なし ──
      if ((c.minMonth || c.maxMonth) && c.repeatable && !c.oncePerYear) {
        warn('P2', c,
          `季節限定（minMonth/maxMonth あり）かつ repeatable:true だが oncePerYear:true がない`,
          'oncePerYear',
          String(c.oncePerYear ?? 'なし'),
          'oncePerYear:true を追加して同一年内の重複発生を防ぐ',
          '中（年複数回が意図的な場合あり）');
      }

      // ── W10: effects 未確認フィールド ──
      for (let ci = 0; ci < choices.length; ci++) {
        const fx = choices[ci].effects || {};
        for (const key of Object.keys(fx)) {
          if (!KNOWN_FX.has(key)) {
            // 明らかに誤字に見えるもの → P2、それ以外 → P3
            const looksTypo = KNOWN_FX.has(key.replace(/[A-Z]/g, s => '_' + s.toLowerCase()));
            warn(looksTypo ? 'P2' : 'P3', c,
              `choice[${ci}] effects に未確認フィールド "${key}"`,
              `choices[${ci}].effects.${key}`,
              JSON.stringify(fx[key]).slice(0, 40),
              '要確認：chooseEvent() / applyEffects() で処理されているか検証',
              '高（ゲーム固有の拡張フィールドの可能性あり）');
          }
        }
      }

      // ── W11: followUp が空 ──
      for (let ci = 0; ci < choices.length; ci++) {
        const fu = choices[ci].followUp;
        if (fu && !fu.title && !fu.body && !fu.effects) {
          warn('P3', c,
            `choice[${ci}] に followUp があるが title / body / effects がすべて空`,
            `choices[${ci}].followUp`,
            JSON.stringify(fu).slice(0, 60),
            'followUp に title または body を追加',
            '低');
        }
      }

      // ── W12: requireProduct のプロダクト ID が UNLOCKED_PRODUCT_CATALOG に存在しない ──
      if (c.requireProduct && VALID_PRODUCT_IDS.size > 0) {
        if (!VALID_PRODUCT_IDS.has(c.requireProduct)) {
          warn('P2', c,
            `requireProduct:"${c.requireProduct}" が UNLOCKED_PRODUCT_CATALOG に存在しない`,
            'requireProduct',
            c.requireProduct,
            `UNLOCKED_PRODUCT_CATALOG に "${c.requireProduct}" を追加するか ID を修正`,
            '低');
        }
      }

      // ── W13: unlockProduct が UNLOCKED_PRODUCT_CATALOG に存在しない ──
      for (let ci = 0; ci < choices.length; ci++) {
        const uid = (choices[ci].effects || {}).unlockProduct;
        if (uid && VALID_PRODUCT_IDS.size > 0 && !VALID_PRODUCT_IDS.has(uid)) {
          warn('P2', c,
            `choice[${ci}] effects.unlockProduct:"${uid}" が UNLOCKED_PRODUCT_CATALOG に存在しない`,
            `choices[${ci}].effects.unlockProduct`,
            uid,
            `UNLOCKED_PRODUCT_CATALOG に "${uid}" を追加するか ID を修正`,
            '低');
        }
      }
    }

    return { warnings, w08SuppressedCount };
  }

  // ══════════════════════════════════════════════════════════════
  // ■ 3. テーブル用データ整形
  // ══════════════════════════════════════════════════════════════

  function summarizeCase(c) {
    const choices = Array.isArray(c.choices) ? c.choices : [];
    const cdMap   = window.CASE_COOLDOWN_DAYS || {};
    return {
      id:             c.id          || '',
      title:          c.title       || c.label || '',
      pool:           c._pool       || '',
      category:       c.category    || '',
      domain:         c.domain      || '',
      sender:         c.sender      || '',
      apCost:         c.apCost      ?? '',
      conditionOnly:  c.conditionOnly ? '✓' : '',
      repeatable:     c.repeatable   ? '✓' : '',
      oncePerYear:    c.oncePerYear  ? '✓' : '',
      cooldownDays:   cdMap[c.id]    ?? (c.repeatable ? '(30)' : ''),
      expireDays:     c.expireDays   ?? '',
      minDay:         c.minDay       ?? '',
      minMonth:       c.minMonth     ?? '',
      maxMonth:       c.maxMonth     ?? '',
      minRep:         c.minRep       ?? '',
      requireStaff:   c.requireStaff  ? '✓' : '',
      requireVacancy: c.requireVacancy ? '✓' : '',
      maxOccupancy:   c.maxOccupancyPct ?? '',
      requireProduct: c.requireProduct || '',
      choicesCount:   choices.length,
      noAPChoices:    choices.filter(ch => ch.noAP).length,
      hasFollowUp:    choices.some(ch => ch.followUp) ? '✓' : '',
      charMeet:       choices.some(ch => (ch.effects||{}).charMeet) ? '✓' : '',
      unlockProduct:  choices.map(ch => (ch.effects||{}).unlockProduct).filter(Boolean).join(','),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // ■ 4. エクスポート
  // ══════════════════════════════════════════════════════════════

  function toCSV(rows, headers) {
    const escape = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [
      headers.map(escape).join(','),
      ...rows.map(r => headers.map(h => escape(r[h])).join(','))
    ];
    return lines.join('\r\n');
  }

  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // ══════════════════════════════════════════════════════════════
  // ■ 5. UI
  // ══════════════════════════════════════════════════════════════

  const COLORS = {
    P0: '#ff4444', P1: '#ff8800', P2: '#f0c040', P3: '#88aacc',
    bg: '#1a1a2e', bg2: '#16213e', panel: '#0f3460',
    text: '#e0e0e0', muted: '#888', border: '#2a4a6a',
  };

  let _qaData = null;

  function buildQAData() {
    if (_qaData) return _qaData;
    const { cases, idMap } = collectAllCases();
    const { warnings, w08SuppressedCount } = runStaticAudit(cases, idMap);
    const summaries = cases.map(summarizeCase);
    _qaData = { cases, idMap, warnings, summaries, w08SuppressedCount };
    return _qaData;
  }

  // ─── スタイルシート ───
  function injectStyles() {
    if (document.getElementById('qa-styles')) return;
    const style = document.createElement('style');
    style.id = 'qa-styles';
    style.textContent = `
#qa-fab{position:fixed;bottom:20px;right:20px;z-index:99990;
  background:#0f3460;color:#64b5f6;border:1px solid #2a4a6a;
  border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;
  font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.5);
  font-family:system-ui,sans-serif;user-select:none}
#qa-fab:hover{background:#1a4a7a}
#qa-overlay{position:fixed;inset:0;z-index:99995;display:none;
  background:#1a1a2e;flex-direction:column;font-family:system-ui,sans-serif;
  font-size:13px;color:#e0e0e0}
#qa-overlay.qa-open{display:flex}
#qa-header{display:flex;align-items:center;gap:12px;
  background:#0f3460;padding:10px 16px;border-bottom:1px solid #2a4a6a;flex-shrink:0}
#qa-header h1{margin:0;font-size:15px;color:#64b5f6;flex:1}
#qa-header .qa-badge{font-size:10px;background:#1a4a7a;color:#88c0f0;
  padding:2px 6px;border-radius:4px}
.qa-close{background:none;border:none;color:#888;font-size:20px;cursor:pointer;
  line-height:1;padding:0 4px}
.qa-close:hover{color:#e0e0e0}
#qa-tabs{display:flex;background:#16213e;border-bottom:1px solid #2a4a6a;flex-shrink:0}
.qa-tab{padding:8px 16px;cursor:pointer;color:#888;border-bottom:2px solid transparent;
  font-size:12px;font-weight:600;white-space:nowrap;user-select:none}
.qa-tab.active{color:#64b5f6;border-bottom-color:#64b5f6;background:#0f3460}
.qa-tab:hover:not(.active){color:#aaa}
#qa-body{flex:1;overflow:auto;padding:0}
.qa-panel{display:none;padding:12px;height:100%;box-sizing:border-box;overflow:auto}
.qa-panel.active{display:block}
.qa-toolbar{display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap}
.qa-toolbar input{background:#0f3460;border:1px solid #2a4a6a;color:#e0e0e0;
  padding:5px 8px;border-radius:5px;font-size:12px;width:200px}
.qa-toolbar select{background:#0f3460;border:1px solid #2a4a6a;color:#e0e0e0;
  padding:5px 8px;border-radius:5px;font-size:12px}
.qa-btn{background:#0f3460;border:1px solid #2a4a6a;color:#64b5f6;
  padding:5px 10px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600}
.qa-btn:hover{background:#1a4a7a}
.qa-btn.success{background:#1a4a2a;border-color:#2a6a3a;color:#66bb6a}
.qa-count{font-size:11px;color:#888;margin-left:auto}
.qa-table-wrap{overflow:auto;max-height:calc(100vh - 160px)}
table.qa-tbl{border-collapse:collapse;width:100%;font-size:11px;white-space:nowrap}
table.qa-tbl th{background:#0f3460;color:#88c0f0;padding:5px 8px;
  border:1px solid #2a4a6a;position:sticky;top:0;z-index:2;font-weight:600;text-align:left}
table.qa-tbl td{padding:4px 8px;border:1px solid #1a2a3a;color:#ccc;vertical-align:top}
table.qa-tbl tr:hover td{background:#0f3460}
.sev-P0{color:#ff4444;font-weight:700}
.sev-P1{color:#ff8800;font-weight:700}
.sev-P2{color:#f0c040}
.sev-P3{color:#88aacc}
.qa-warn-row{cursor:pointer}
.qa-warn-detail{display:none;background:#0a1a2a;border-top:1px solid #2a4a6a}
.qa-warn-detail.open{display:table-row}
.qa-warn-detail td{padding:10px;font-size:11px;color:#aaa;white-space:pre-wrap;word-break:break-all}
.qa-json{font-family:monospace;font-size:10px;background:#050f1a;padding:8px;
  border-radius:4px;overflow:auto;max-height:300px;margin-top:6px;color:#88c0f0}
.qa-notice{background:#0f2a1a;border:1px solid #2a5a3a;border-radius:6px;
  padding:10px 14px;margin-bottom:10px;color:#88ccaa;font-size:12px;line-height:1.6}
.qa-stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));
  gap:8px;margin-bottom:12px}
.qa-stat-card{background:#0f3460;border:1px solid #2a4a6a;border-radius:6px;
  padding:8px 12px}
.qa-stat-card .label{font-size:10px;color:#888;margin-bottom:2px}
.qa-stat-card .value{font-size:18px;font-weight:700;color:#64b5f6}
.qa-sev-badges{display:flex;gap:6px;flex-wrap:wrap}
.sev-badge{padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer}
.sev-badge-P0{background:#4a0000;color:#ff4444;border:1px solid #ff4444}
.sev-badge-P1{background:#3a2000;color:#ff8800;border:1px solid #ff8800}
.sev-badge-P2{background:#3a3000;color:#f0c040;border:1px solid #f0c040}
.sev-badge-P3{background:#1a2a3a;color:#88aacc;border:1px solid #88aacc}
    `;
    document.head.appendChild(style);
  }

  // ─── FABボタン ───
  function createFAB() {
    const btn = document.createElement('button');
    btn.id = 'qa-fab';
    btn.textContent = '🔍 QA';
    btn.title = 'QAツールを開く（?qa=1 モード）';
    btn.addEventListener('click', openQA);
    document.body.appendChild(btn);
  }

  // ─── オーバーレイ ───
  function createOverlay() {
    const el = document.createElement('div');
    el.id = 'qa-overlay';
    el.innerHTML = `
<div id="qa-header">
  <h1>🔍 舞昆茶屋物語 QAツール <span class="qa-badge">${QA_VERSION}</span></h1>
  <span class="qa-badge" id="qa-mode-badge">READ-ONLY</span>
  <button class="qa-close" id="qa-close-btn" title="閉じる">✕</button>
</div>
<div id="qa-tabs">
  <div class="qa-tab active" data-tab="audit">静的監査</div>
  <div class="qa-tab" data-tab="warnings">警告一覧</div>
  <div class="qa-tab" data-tab="events">イベント一覧</div>
  <div class="qa-tab" data-tab="export">エクスポート</div>
</div>
<div id="qa-body">
  <div class="qa-panel active" id="qa-panel-audit"></div>
  <div class="qa-panel" id="qa-panel-warnings"></div>
  <div class="qa-panel" id="qa-panel-events"></div>
  <div class="qa-panel" id="qa-panel-export"></div>
</div>`;
    document.body.appendChild(el);

    el.querySelector('#qa-close-btn').addEventListener('click', closeQA);
    el.querySelectorAll('.qa-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function openQA() {
    const overlay = document.getElementById('qa-overlay');
    overlay.classList.add('qa-open');
    renderAuditTab();
  }

  function closeQA() {
    document.getElementById('qa-overlay').classList.remove('qa-open');
  }

  function switchTab(name) {
    document.querySelectorAll('.qa-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.qa-panel').forEach(p =>
      p.classList.toggle('active', p.id === `qa-panel-${name}`));
    if (name === 'audit')    renderAuditTab();
    if (name === 'warnings') renderWarningsTab();
    if (name === 'events')   renderEventsTab();
    if (name === 'export')   renderExportTab();
  }

  // ══════════════════════════════════════════════════════════════
  // ■ 6. パネル描画
  // ══════════════════════════════════════════════════════════════

  // ── 静的監査サマリー ──
  function renderAuditTab() {
    const panel = document.getElementById('qa-panel-audit');
    if (panel.dataset.rendered) return;
    panel.dataset.rendered = '1';

    const execTime = new Date().toLocaleString('ja-JP', { hour12: false });
    const gameVer  = (window.G && window.G.version) ? window.G.version
                   : (window.GAME_VERSION || '不明');

    const d = buildQAData();
    const w = d.warnings;
    const bySev = { P0: 0, P1: 0, P2: 0, P3: 0 };
    w.forEach(x => { bySev[x.severity] = (bySev[x.severity] || 0) + 1; });

    // 警告が1件もない案件数
    const warnedIds = new Set(w.map(x => x.eventId));
    const cleanCount = d.cases.filter(c => c.id && !warnedIds.has(c.id)).length;

    const poolCounts = {};
    d.cases.forEach(c => { poolCounts[c._pool] = (poolCounts[c._pool] || 0) + 1; });

    panel.innerHTML = `
<div class="qa-notice">
  <strong>📋 監査範囲</strong><br>
  静的配列（CASE_POOL / DOMAIN_CASES / DAILY_EVENTS / MONTHLY_CHALLENGES / ISSUE_CARDS）の
  <strong>全 ${d.cases.length} 件</strong>を監査対象とします。
  conditionOnly 案件（${d.cases.filter(c=>c.conditionOnly).length} 件）も含みます。<br>
  <strong>対象外：</strong><code>generateConditionCases()</code> 内インラインで動的生成される
  chr_* キャラクター案件（Phase 2 以降で対応予定）。<br><br>
  <strong>W08（デフォルトクールダウン）について：</strong>
  repeatable 案件のうち <code>CASE_COOLDOWN_DAYS</code> 未登録の
  <strong>${d.w08SuppressedCount} 件</strong>はデフォルト 30 日が自動適用されます。
  正常仕様のため個別警告は省略し、このサマリにのみ表示しています。
</div>

<div class="qa-stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
  <div class="qa-stat-card" style="grid-column:1/-1;background:#0a1f3a">
    <div class="label">実行日時</div><div style="font-size:13px;color:#aac8f0;font-weight:600">${execTime}</div>
    <div class="label" style="margin-top:4px">QAバージョン / ゲームバージョン</div>
    <div style="font-size:11px;color:#888">${QA_VERSION} &nbsp;/&nbsp; game: ${gameVer}</div>
  </div>
  <div class="qa-stat-card"><div class="label">監査対象案件数</div><div class="value">${d.cases.length}</div></div>
  <div class="qa-stat-card"><div class="label">警告なし案件数</div><div class="value" style="color:#66bb6a">${cleanCount}</div></div>
  <div class="qa-stat-card"><div class="label">警告総数</div><div class="value">${w.length}</div></div>
  <div class="qa-stat-card"><div class="label sev-P0">P0 進行停止・破損</div><div class="value sev-P0">${bySev.P0}</div></div>
  <div class="qa-stat-card"><div class="label sev-P1">P1 重大矛盾</div><div class="value sev-P1">${bySev.P1}</div></div>
  <div class="qa-stat-card"><div class="label sev-P2">P2 不整合</div><div class="value sev-P2">${bySev.P2}</div></div>
  <div class="qa-stat-card"><div class="label sev-P3">P3 要確認</div><div class="value sev-P3">${bySev.P3}</div></div>
</div>
<div style="font-size:11px;color:#666;margin-bottom:10px">
  プール別：${Object.entries(poolCounts).map(([k,v]) => `${k} ${v}件`).join(' / ')}
</div>

<div class="qa-sev-badges" style="margin-bottom:12px">
  <span style="font-size:12px;color:#888;align-self:center">警告に移動：</span>
  ${['P0','P1','P2','P3'].map(s => `
    <span class="sev-badge sev-badge-${s}" onclick="document.querySelector('.qa-tab[data-tab=warnings]').click();
      document.getElementById('qa-sev-filter').value='${s}';
      window._qaFilterWarnings && window._qaFilterWarnings()">
      ${s} ${bySev[s]}件
    </span>`).join('')}
</div>

<div style="font-size:11px;color:#888;line-height:1.8">
  <strong style="color:#aaa">警告レベル定義：</strong><br>
  <span class="sev-P0">P0</span> — 進行停止・NaN・セーブ破損の可能性があるもの<br>
  <span class="sev-P1">P1</span> — 前提条件・季節・ゲーム状態の重大矛盾<br>
  <span class="sev-P2">P2</span> — 効果や表示の不整合・要修正の可能性<br>
  <span class="sev-P3">P3</span> — 設定上の注意・要確認（誤検知の可能性が高い場合は <em>誤検知の可能性</em> 欄を参照）<br><br>
  <strong style="color:#aaa">注意：</strong>
  自動検出は静的チェックのみです。誤検知の可能性が高い場合は警告を無視して構いません。<br>
  修正は行わず、確認のみ行ってください。
</div>`;
  }

  // ── 警告一覧 ──
  function renderWarningsTab() {
    const panel = document.getElementById('qa-panel-warnings');
    if (panel.dataset.rendered) return;
    panel.dataset.rendered = '1';

    const d = buildQAData();

    panel.innerHTML = `
<div class="qa-toolbar">
  <input id="qa-warn-search" placeholder="eventId / タイトルで検索" oninput="window._qaFilterWarnings && window._qaFilterWarnings()">
  <select id="qa-sev-filter" onchange="window._qaFilterWarnings && window._qaFilterWarnings()">
    <option value="">全レベル</option>
    <option value="P0">P0 進行停止</option>
    <option value="P1">P1 重大矛盾</option>
    <option value="P2">P2 不整合</option>
    <option value="P3">P3 要確認</option>
  </select>
  <select id="qa-pool-filter" onchange="window._qaFilterWarnings && window._qaFilterWarnings()">
    <option value="">全プール</option>
    ${[...new Set(d.cases.map(c => c._pool))].map(p => `<option>${p}</option>`).join('')}
  </select>
  <button class="qa-btn" onclick="window._qaCopyWarningsCSV()">CSV コピー</button>
  <button class="qa-btn" onclick="window._qaCopyWarningsJSON()">JSON コピー</button>
  <span class="qa-count" id="qa-warn-count">全 ${d.warnings.length} 件</span>
</div>
<div class="qa-table-wrap">
<table class="qa-tbl" id="qa-warn-table">
<thead><tr>
  <th>severity</th><th>eventId</th><th>title</th><th>pool</th>
  <th>問題内容</th><th>該当フィールド</th><th>現在値</th>
  <th>推奨対応</th><th>誤検知の可能性</th>
</tr></thead>
<tbody id="qa-warn-tbody"></tbody>
</table>
</div>`;

    function rowsHTML(list) {
      return list.map((w, i) => {
        const detailId = `qa-detail-${i}`;
        return `
<tr class="qa-warn-row" onclick="document.getElementById('${detailId}').classList.toggle('open')">
  <td><span class="sev-${w.severity}">${w.severity}</span></td>
  <td style="font-family:monospace;color:#88c0f0">${esc(w.eventId)}</td>
  <td>${esc(w.title)}</td>
  <td style="color:#888">${esc(w.sourcePool)}</td>
  <td>${esc(w.issue)}</td>
  <td style="font-family:monospace;color:#aaa">${esc(w.field)}</td>
  <td style="font-family:monospace;color:#f0c040">${esc(w.current)}</td>
  <td style="color:#88cc88">${esc(w.recommendation)}</td>
  <td style="color:#888">${esc(w.falsePositiveRisk)}</td>
</tr>
<tr class="qa-warn-detail" id="${detailId}">
  <td colspan="9">
    <strong style="color:#88c0f0">📋 イベント定義（${esc(w.eventId)}）</strong>
    <div class="qa-json">${esc(JSON.stringify(w._raw, null, 2))}</div>
  </td>
</tr>`;
      }).join('');
    }

    function filterWarnings() {
      const search  = (document.getElementById('qa-warn-search')?.value  || '').toLowerCase();
      const sevF    = document.getElementById('qa-sev-filter')?.value    || '';
      const poolF   = document.getElementById('qa-pool-filter')?.value   || '';
      const filtered = d.warnings.filter(w =>
        (!sevF  || w.severity   === sevF) &&
        (!poolF || w.sourcePool === poolF) &&
        (!search || w.eventId.toLowerCase().includes(search) || w.title.toLowerCase().includes(search) || w.issue.toLowerCase().includes(search))
      );
      document.getElementById('qa-warn-tbody').innerHTML = rowsHTML(filtered);
      document.getElementById('qa-warn-count').textContent = `${filtered.length} 件（全 ${d.warnings.length} 件）`;
      return filtered;
    }

    window._qaFilterWarnings     = filterWarnings;
    window._qaCopyWarningsCSV    = () => {
      const rows = filterWarnings();
      const headers = ['severity','eventId','title','sourcePool','issue','field','current','recommendation','falsePositiveRisk'];
      copyText(toCSV(rows, headers));
      flashBtn('CSV コピー');
    };
    window._qaCopyWarningsJSON = () => {
      const rows = filterWarnings();
      const clean = rows.map(r => { const { _raw, ...rest } = r; return rest; });
      copyText(JSON.stringify(clean, null, 2));
      flashBtn('JSON コピー');
    };

    filterWarnings();
  }

  // ── イベント一覧 ──
  function renderEventsTab() {
    const panel = document.getElementById('qa-panel-events');
    if (panel.dataset.rendered) return;
    panel.dataset.rendered = '1';

    const d = buildQAData();
    const COLS = ['id','title','pool','category','domain','sender','apCost',
      'conditionOnly','repeatable','oncePerYear','cooldownDays','expireDays',
      'minDay','minMonth','maxMonth','minRep','requireStaff','requireVacancy',
      'maxOccupancy','requireProduct','choicesCount','noAPChoices','hasFollowUp',
      'charMeet','unlockProduct'];

    panel.innerHTML = `
<div class="qa-toolbar">
  <input id="qa-ev-search" placeholder="id / タイトル / sender で検索" oninput="window._qaFilterEvents && window._qaFilterEvents()">
  <select id="qa-ev-pool" onchange="window._qaFilterEvents && window._qaFilterEvents()">
    <option value="">全プール</option>
    ${[...new Set(d.cases.map(c => c._pool))].map(p => `<option>${p}</option>`).join('')}
  </select>
  <button class="qa-btn" onclick="window._qaEvCSV()">CSV コピー</button>
  <button class="qa-btn" onclick="window._qaEvJSON()">JSON コピー</button>
  <span class="qa-count" id="qa-ev-count">${d.summaries.length} 件</span>
</div>
<div class="qa-table-wrap">
<table class="qa-tbl" id="qa-ev-table">
<thead><tr>${COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead>
<tbody id="qa-ev-tbody"></tbody>
</table>
</div>`;

    function filterEvents() {
      const search = (document.getElementById('qa-ev-search')?.value || '').toLowerCase();
      const poolF  = document.getElementById('qa-ev-pool')?.value || '';
      const filtered = d.summaries.filter(s =>
        (!poolF  || s.pool  === poolF) &&
        (!search || s.id.toLowerCase().includes(search) || s.title.toLowerCase().includes(search) || s.sender.toLowerCase().includes(search))
      );
      document.getElementById('qa-ev-tbody').innerHTML = filtered.map(s =>
        `<tr>${COLS.map(c => `<td>${esc(s[c] ?? '')}</td>`).join('')}</tr>`
      ).join('');
      document.getElementById('qa-ev-count').textContent = `${filtered.length} 件（全 ${d.summaries.length} 件）`;
      return filtered;
    }

    window._qaFilterEvents = filterEvents;
    window._qaEvCSV  = () => { const f = filterEvents(); copyText(toCSV(f, COLS)); flashBtn('CSV コピー'); };
    window._qaEvJSON = () => { const f = filterEvents(); copyText(JSON.stringify(f, null, 2)); flashBtn('JSON コピー'); };

    filterEvents();
  }

  // ── エクスポート ──
  function renderExportTab() {
    const panel = document.getElementById('qa-panel-export');
    if (panel.dataset.rendered) return;
    panel.dataset.rendered = '1';

    const d = buildQAData();
    const bySev = { P0: 0, P1: 0, P2: 0, P3: 0 };
    d.warnings.forEach(w => { bySev[w.severity] = (bySev[w.severity] || 0) + 1; });

    panel.innerHTML = `
<div style="max-width:600px">
  <h3 style="color:#64b5f6;margin-top:0">エクスポート</h3>

  <div style="margin-bottom:16px">
    <h4 style="color:#aaa;margin-bottom:8px">警告一覧（${d.warnings.length} 件）</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="qa-btn" onclick="window._qaExportWarnCSV()">CSV コピー（警告全件）</button>
      <button class="qa-btn" onclick="window._qaExportWarnJSON()">JSON コピー（警告全件）</button>
    </div>
    <div style="margin-top:8px;font-size:11px;color:#888">
      P0:${bySev.P0} / P1:${bySev.P1} / P2:${bySev.P2} / P3:${bySev.P3}
    </div>
  </div>

  <div style="margin-bottom:16px">
    <h4 style="color:#aaa;margin-bottom:8px">イベント一覧（${d.summaries.length} 件）</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="qa-btn" onclick="window._qaExportEvCSV()">CSV コピー（全イベント）</button>
      <button class="qa-btn" onclick="window._qaExportEvJSON()">JSON コピー（全イベント）</button>
    </div>
  </div>

  <div style="margin-bottom:16px">
    <h4 style="color:#aaa;margin-bottom:8px">完全レポート（JSON）</h4>
    <button class="qa-btn" onclick="window._qaExportFullJSON()">JSON コピー（全データ）</button>
    <div style="margin-top:4px;font-size:11px;color:#888">
      warnings + summaries + poolCounts + 実行日時
    </div>
  </div>

  <div class="qa-notice" style="margin-top:20px">
    <strong>注意：</strong>
    コピーしたデータにはゲームの内部実装が含まれます。
    公開環境への貼り付けには注意してください。<br>
    QAデータはゲームのセーブデータには影響しません（読み取り専用）。
  </div>
</div>`;

    const WARN_COLS = ['severity','eventId','title','sourcePool','issue','field','current','recommendation','falsePositiveRisk'];
    const EV_COLS   = ['id','title','pool','category','domain','sender','apCost','conditionOnly','repeatable','oncePerYear','cooldownDays','expireDays','minDay','minMonth','maxMonth','minRep','requireStaff','requireVacancy','choicesCount','noAPChoices','hasFollowUp','unlockProduct'];
    const cleanWarn = d.warnings.map(r => { const { _raw, ...rest } = r; return rest; });

    window._qaExportWarnCSV  = () => { copyText(toCSV(cleanWarn, WARN_COLS));     flashBtn('CSV コピー（警告全件）'); };
    window._qaExportWarnJSON = () => { copyText(JSON.stringify(cleanWarn, null, 2)); flashBtn('JSON コピー（警告全件）'); };
    window._qaExportEvCSV    = () => { copyText(toCSV(d.summaries, EV_COLS));     flashBtn('CSV コピー（全イベント）'); };
    window._qaExportEvJSON   = () => { copyText(JSON.stringify(d.summaries, null, 2)); flashBtn('JSON コピー（全イベント）'); };
    window._qaExportFullJSON = () => {
      const pool = {};
      d.cases.forEach(c => { pool[c._pool] = (pool[c._pool] || 0) + 1; });
      copyText(JSON.stringify({
        meta: { version: QA_VERSION, exportedAt: new Date().toISOString(), gameUrl: location.href },
        poolCounts: pool,
        warnings: cleanWarn,
        summaries: d.summaries,
      }, null, 2));
      flashBtn('JSON コピー（全データ）');
    };
  }

  // ── ユーティリティ ──
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function flashBtn(label) {
    document.querySelectorAll('.qa-btn').forEach(b => {
      if (b.textContent === label) {
        b.textContent = '✓ コピー完了';
        b.classList.add('success');
        setTimeout(() => { b.textContent = label; b.classList.remove('success'); }, 1500);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // ■ 7. 初期化
  // ══════════════════════════════════════════════════════════════

  function init() {
    // ゲームのセーブデータ・状態への書き込みをしないことを保証するため、
    // QAツールは読み取り専用で動作する。saveGame() / localStorage への書き込みは行わない。
    injectStyles();
    createFAB();
    createOverlay();
    console.log(`[QA] 舞昆茶屋物語 QAツール ${QA_VERSION} 起動 (READ-ONLY)`);
    console.log(`[QA] CASE_POOL: ${(window.CASE_POOL||[]).length}件 / DOMAIN_CASES: ${(window.DOMAIN_CASES||[]).length}件`);
  }

  // DOMが準備できていれば即時、そうでなければ待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // 少し遅延させてゲームの init() が完了するのを待つ
    setTimeout(init, 0);
  }

})();
