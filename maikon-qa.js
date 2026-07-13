/**
 * 舞昆茶屋物語 QAツール Phase 1 v1.1 / Phase 2A
 * ?qa=1 または ?debug=1 の場合のみ動作
 * ゲーム本体への影響なし・読み取り専用（Phase 2Aは1日テスト後に必ず復元）
 */
(function () {
  'use strict';

  // ─── ガード：QAモード以外では即終了 ───
  if (!/[?&](qa|debug)=1/.test(location.search)) return;

  const QA_VERSION = 'Phase 1 v1.1 / Phase 2A';

  // ══════════════════════════════════════════════════════════════
  // ■ 0. グローバル変数アクセス ヘルパー
  //   let / const はwindowプロパティではないためwindow.*では取得不可。
  //   同一レルムの宣言的グローバル環境を eval で参照する。
  // ══════════════════════════════════════════════════════════════

  /**
   * ゲーム側の let/const グローバル変数を安全に取得する。
   * @param {string} name - 変数名
   * @returns {{ found:boolean, isArray:boolean, arr:Array, value:*, reason:string|null }}
   */
  function _getGlobal(name) {
    try {
      // eslint-disable-next-line no-eval
      const v = eval(name);
      if (v === undefined || v === null) {
        return { found: false, isArray: false, arr: [], value: v, reason: `${name} は undefined/null` };
      }
      return { found: true, isArray: Array.isArray(v), arr: Array.isArray(v) ? v : [], value: v, reason: null };
    } catch (e) {
      return { found: false, isArray: false, arr: [], value: undefined, reason: e.message };
    }
  }

  // ─── 既知 effects フィールド（chooseEvent / applyEffects から収集）───
  const KNOWN_FX = new Set([
    // 基本ゲーム値
    'score', 'rep', 'storeSat', 'staffSat', 'custRegular', 'custUp', 'credit',
    'money', 'monthlyBonus', 'fatigue', 'resilience',
    // キャラクター
    'charMeet', 'charLevel', 'charComplete', 'charNote', 'charTarget', 'charNoteText',
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
    '_setCooldown', '_setFlag',
    // 来客ボーナス
    'custBonusPerDay', 'custBonusDays', 'source',
    // プロフィール
    'profile',
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

  // ─── 有効プロダクトID（let/const → _getGlobal で取得）───
  const _catalogInfo = _getGlobal('UNLOCKED_PRODUCT_CATALOG');
  const VALID_PRODUCT_IDS = new Set(
    (_catalogInfo.found && !_catalogInfo.isArray && typeof _catalogInfo.value === 'object')
      ? Object.keys(_catalogInfo.value)
      : []
  );

  // ══════════════════════════════════════════════════════════════
  // ■ 1. データ収集
  // ══════════════════════════════════════════════════════════════

  /**
   * 5つのケースプールを収集し、アクセス可否診断も返す。
   * window.* は不可（let/const）のため _getGlobal() を使用。
   */
  function collectAllCases() {
    const POOL_NAMES = [
      'CASE_POOL', 'DOMAIN_CASES', 'DAILY_EVENTS', 'MONTHLY_CHALLENGES', 'ISSUE_CARDS',
    ];
    const poolDiagnostics = {};
    const all   = [];
    const idMap = {};
    const p0Warnings = []; // プールアクセス不能をP0として記録

    for (const name of POOL_NAMES) {
      const info = _getGlobal(name);
      poolDiagnostics[name] = {
        found:   info.found,
        isArray: info.isArray,
        count:   info.arr.length,
        reason:  info.reason,
      };

      if (!info.found || !info.isArray) {
        p0Warnings.push({
          severity: 'P0',
          eventId: '(システム)',
          title: `プールアクセス不能: ${name}`,
          sourcePool: name,
          issue: info.reason
            ? `${name} へアクセスできないため監査未実行（理由: ${info.reason}）`
            : `${name} が配列ではないため監査未実行`,
          field: name,
          current: info.found ? typeof info.value : 'undefined',
          recommendation: 'ゲーム本体が正常に読み込まれているか確認してください',
          falsePositiveRisk: '低',
          _raw: { id: null },
        });
        continue;
      }

      for (const c of info.arr) {
        const tagged = Object.assign({}, c, { _pool: name });
        all.push(tagged);
        const key = c.id || '__no_id__';
        if (!idMap[key]) idMap[key] = [];
        idMap[key].push(name);
      }
    }

    return { cases: all, idMap, poolDiagnostics, p0Warnings };
  }

  // ══════════════════════════════════════════════════════════════
  // ■ 2. 静的監査エンジン
  // ══════════════════════════════════════════════════════════════

  function runStaticAudit(cases, idMap, p0Warnings) {
    const warnings = [...p0Warnings]; // プールP0を先頭に
    let w08SuppressedCount = 0;

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
            'requireStaff:true を追加、またはスタッフ未採用時の挙動を確認',
            '中（conditionOnly経路でのみ発生する場合あり）');
        }
      }

      // ── W06: 空室系送信者なのに requireVacancy なし（landlord domain 限定）──
      if (c.domain === 'landlord' && VACANCY_SENDER_KW.some(kw => (c.sender || '').includes(kw))) {
        if (!c.requireVacancy && !c.conditionOnly) {
          warn('P2', c,
            `送信者「${c.sender}」は空室系だが requireVacancy:true がない`,
            'requireVacancy',
            String(c.requireVacancy ?? 'なし'),
            'requireVacancy:true を追加、または送信者キーワードを見直す',
            '中（条件制御済みの場合あり）');
        }
      }

      // ── W07: 見送り系ラベルなのに noAP:true なし ──
      for (let ci = 0; ci < choices.length; ci++) {
        const ch = choices[ci];
        if (DECLINE_KW.some(kw => (ch.label || '').includes(kw))) {
          if (!ch.noAP && (c.apCost || 0) > 0) {
            warn('P1', c,
              `choice[${ci}] ラベル「${ch.label}」は見送り系だが noAP:true がない（AP消費${c.apCost}）`,
              `choices[${ci}].noAP`,
              String(ch.noAP ?? 'なし'),
              'noAP:true を追加して見送り時の AP 消費を防ぐ',
              '低');
          }
        }
      }

      // ── W08: repeatable なのに CASE_COOLDOWN_DAYS 未登録（個別警告省略・サマリ集計）──
      if (c.repeatable) {
        const cdInfo = _getGlobal('CASE_COOLDOWN_DAYS');
        const cdMap  = (cdInfo.found && !cdInfo.isArray) ? cdInfo.value : {};
        if (!cdMap[c.id]) {
          w08SuppressedCount++;
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
            `choice[${ci}] に followUp があるが title / body / effects がすべてない`,
            `choices[${ci}].followUp`,
            JSON.stringify(fu).slice(0, 60),
            'followUp の内容を確認・補完',
            '中（最小 followUp として意図的な場合あり）');
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
    const cdInfo  = _getGlobal('CASE_COOLDOWN_DAYS');
    const cdMap   = (cdInfo.found && !cdInfo.isArray) ? cdInfo.value : {};
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
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
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
    const { cases, idMap, poolDiagnostics, p0Warnings } = collectAllCases();
    const { warnings, w08SuppressedCount } = runStaticAudit(cases, idMap, p0Warnings);
    const summaries = cases.map(summarizeCase);
    _qaData = { cases, idMap, warnings, summaries, w08SuppressedCount, poolDiagnostics };
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
#qa-tabs{display:flex;border-bottom:1px solid #2a4a6a;flex-shrink:0;background:#16213e}
.qa-tab{padding:8px 16px;cursor:pointer;color:#888;font-size:12px;
  border-bottom:2px solid transparent;user-select:none;white-space:nowrap}
.qa-tab:hover{color:#e0e0e0}
.qa-tab.active{color:#64b5f6;border-bottom-color:#64b5f6}
#qa-body{flex:1;overflow:hidden;display:flex;flex-direction:column}
.qa-panel{display:none;flex:1;overflow-y:auto;padding:16px}
.qa-panel.active{display:block}
.qa-toolbar{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center}
.qa-toolbar input{background:#0f3460;border:1px solid #2a4a6a;color:#e0e0e0;
  padding:5px 8px;border-radius:5px;font-size:12px;min-width:200px}
.qa-toolbar select{background:#0f3460;border:1px solid #2a4a6a;color:#e0e0e0;
  padding:5px 8px;border-radius:5px;font-size:12px}
.qa-btn{background:#0f3460;border:1px solid #2a4a6a;color:#64b5f6;
  padding:5px 10px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600}
.qa-btn:hover{background:#1a4a7a}
.qa-btn.success{background:#1a4a2a;border-color:#2a6a3a;color:#66bb6a}
.qa-btn:disabled{opacity:.4;cursor:default}
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
.qa-notice.warn{background:#2a1a0a;border-color:#5a3a0a;color:#ccaa66}
.qa-notice.error{background:#2a0a0a;border-color:#5a0a0a;color:#cc6666}
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
/* Phase 2A styles */
.qa-2a-log{font-family:monospace;font-size:11px;background:#050f1a;border-radius:6px;
  padding:10px;margin:8px 0;max-height:300px;overflow-y:auto;line-height:1.8}
.qa-2a-PASS{color:#66bb6a}
.qa-2a-WARN{color:#f0c040}
.qa-2a-FAIL{color:#ff4444;font-weight:700}
.qa-2a-INFO{color:#88aacc}
.qa-pool-diag{font-family:monospace;font-size:11px;line-height:1.8;margin:6px 0}
.qa-pool-ok{color:#66bb6a}
.qa-pool-ng{color:#ff4444;font-weight:700}
/* Phase 2A result sections */
.qa-2a-section{background:#0a1525;border:1px solid #1e3a5a;border-radius:6px;
  margin-bottom:10px;overflow:hidden}
.qa-2a-section-hdr{background:#0f3060;padding:7px 12px;font-size:12px;
  font-weight:700;color:#88c0f0;display:flex;align-items:center;gap:8px;
  cursor:pointer;user-select:none}
.qa-2a-section-hdr .qa-2a-hdr-badge{font-size:11px;padding:1px 7px;
  border-radius:3px;font-weight:700;margin-left:auto}
.qa-2a-section-body{padding:10px 12px;font-size:11px;line-height:1.9}
.qa-2a-section-body.collapsed{display:none}
.qa-2a-field-row{display:grid;grid-template-columns:180px 80px 1fr;gap:6px;
  padding:2px 0;border-bottom:1px solid #0d1f30;align-items:baseline}
.qa-2a-field-row:last-child{border-bottom:none}
.qa-2a-fname{color:#aaa;font-family:monospace}
.qa-2a-fbadge{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;
  text-align:center}
.qa-2a-fbadge-PASS{background:#1a3a1a;color:#66bb6a}
.qa-2a-fbadge-WARN{background:#3a3000;color:#f0c040}
.qa-2a-fbadge-FAIL{background:#3a0a0a;color:#ff4444}
.qa-2a-fval{font-family:monospace;color:#888;font-size:10px;word-break:break-all}
.qa-2a-pool-row{display:grid;grid-template-columns:190px 60px 60px 60px 1fr;
  gap:6px;padding:2px 0;border-bottom:1px solid #0d1f30;align-items:baseline}
.qa-2a-pool-row:last-child{border-bottom:none}
.qa-2a-overall{font-size:22px;font-weight:900;padding:4px 18px;border-radius:6px}
.qa-2a-overall-PASS{background:#0a2a0a;color:#66bb6a;border:2px solid #66bb6a}
.qa-2a-overall-WARN{background:#2a2a00;color:#f0c040;border:2px solid #f0c040}
.qa-2a-overall-FAIL{background:#2a0000;color:#ff4444;border:2px solid #ff4444}
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
  <div class="qa-tab" data-tab="sim">シミュレーション</div>
  <div class="qa-tab" data-tab="export">エクスポート</div>
</div>
<div id="qa-body">
  <div class="qa-panel active" id="qa-panel-audit"></div>
  <div class="qa-panel" id="qa-panel-warnings"></div>
  <div class="qa-panel" id="qa-panel-events"></div>
  <div class="qa-panel" id="qa-panel-sim"></div>
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
    if (name === 'sim')      renderSimTab();
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
    const gameVerInfo = _getGlobal('GAME_VERSION');
    const gameVer = gameVerInfo.found ? gameVerInfo.value : '不明';

    const d = buildQAData();
    const w = d.warnings;
    const bySev = { P0: 0, P1: 0, P2: 0, P3: 0 };
    w.forEach(x => { bySev[x.severity] = (bySev[x.severity] || 0) + 1; });

    const warnedIds = new Set(w.map(x => x.eventId));
    const cleanCount = d.cases.filter(c => c.id && !warnedIds.has(c.id)).length;

    const poolCounts = {};
    d.cases.forEach(c => { poolCounts[c._pool] = (poolCounts[c._pool] || 0) + 1; });

    // プールアクセス診断HTML
    const POOL_NAMES = ['CASE_POOL','DOMAIN_CASES','DAILY_EVENTS','MONTHLY_CHALLENGES','ISSUE_CARDS'];
    const diagHTML = POOL_NAMES.map(name => {
      const diag = d.poolDiagnostics[name];
      if (!diag) return `<span class="qa-pool-ng">? ${name}: 診断なし</span><br>`;
      const icon = (diag.found && diag.isArray) ? '✓' : '✗';
      const cls  = (diag.found && diag.isArray) ? 'qa-pool-ok' : 'qa-pool-ng';
      const detail = (diag.found && diag.isArray)
        ? `${diag.count}件`
        : (diag.reason || '取得失敗');
      return `<span class="${cls}">${icon} ${name}: ${detail}</span><br>`;
    }).join('');

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

<div style="background:#0a1f3a;border:1px solid #2a4a6a;border-radius:6px;padding:10px 14px;margin-bottom:12px">
  <div style="font-size:11px;color:#64b5f6;font-weight:700;margin-bottom:6px">📦 プールアクセス診断</div>
  <div class="qa-pool-diag">${diagHTML}</div>
  <div style="font-size:10px;color:#666;margin-top:4px">
    ✓ = 正常取得 &nbsp;✗ = 取得失敗（P0警告あり）&nbsp;
    ※ window.* 不可のため eval 経由でグローバル let/const を参照
  </div>
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

  // ── シミュレーション（Phase 2A）──
  let _qa2aRunning = false;
  let _qa2aLastResult = null;

  function renderSimTab() {
    const panel = document.getElementById('qa-panel-sim');
    // 結果がある場合は再描画する
    panel.innerHTML = `
<div style="max-width:720px">
  <h3 style="color:#64b5f6;margin-top:0">Phase 2A — 1日安全性テスト</h3>

  <div class="qa-notice">
    <strong>⚙️ テスト内容</strong><br>
    現在のゲーム状態から <code>advanceDay()</code> を1回だけ実行し、本番Gへの影響がないことを確認します。<br>
    <strong>saveGame()は呼出を許可しますが書込を遮断</strong>します（advanceDayの通常経路を通すため）。<br>
    実行後、G・localStorage・主要DOM状態が完全に復元されたことをフィールド単位で確認します。<br><br>
    <strong>事前チェック：</strong>G代入可否 / 現在日付が安全か / G・localStorage全体スナップショット<br>
    <strong>事後チェック：</strong>各フィールドの PASS / WARN / FAIL 判定
  </div>

  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <button class="qa-btn" id="qa-2a-run" onclick="window._qa2aRun()"
      ${_qa2aRunning ? 'disabled' : ''}>
      ${_qa2aRunning ? '⏳ テスト実行中…' : '▶ 1日テスト実行'}
    </button>
  </div>

  ${_qa2aLastResult ? renderSimResult(_qa2aLastResult) : '<div style="color:#666;font-size:12px">まだテストを実行していません。</div>'}
</div>`;

    window._qa2aRun = runPhase2A;
  }

  function _sectionBadge(verdict) {
    const cls = verdict === 'PASS' ? 'qa-2a-PASS' : verdict === 'WARN' ? 'qa-2a-WARN' : 'qa-2a-FAIL';
    const bg  = verdict === 'PASS' ? '#1a3a1a'   : verdict === 'WARN' ? '#3a3000'    : '#3a0a0a';
    return `<span class="qa-2a-hdr-badge ${cls}" style="background:${bg}">${verdict}</span>`;
  }

  function _section(title, verdict, bodyHTML, collapsed) {
    const id = 'qa2a-s-' + Math.random().toString(36).slice(2);
    const initCls = collapsed ? 'collapsed' : '';
    return `
<div class="qa-2a-section">
  <div class="qa-2a-section-hdr" onclick="document.getElementById('${id}').classList.toggle('collapsed')">
    ${esc(title)} ${_sectionBadge(verdict)}
  </div>
  <div class="qa-2a-section-body ${initCls}" id="${id}">${bodyHTML}</div>
</div>`;
  }

  function _fieldRow(name, verdict, valBefore, valAfter) {
    const showVals = verdict !== 'PASS';
    const afterStr = valAfter !== undefined ? String(valAfter) : '';
    return `
<div class="qa-2a-field-row">
  <span class="qa-2a-fname">${esc(name)}</span>
  <span class="qa-2a-fbadge qa-2a-fbadge-${verdict}">${verdict}</span>
  <span class="qa-2a-fval">${showVals
    ? `before: ${esc(String(valBefore))} → after: ${esc(afterStr)}`
    : esc(String(valBefore))}</span>
</div>`;
  }

  function renderSimResult(r) {
    const overall = r.overall;

    // ── セクション 0：総合判定 ──
    const s0 = `
<div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;flex-wrap:wrap">
  <span class="qa-2a-overall qa-2a-overall-${overall}">${overall}</span>
  <div>
    <div style="font-size:11px;color:#888">実行日時: ${esc(r.executedAt)}</div>
    ${r.modeNote ? `<div style="font-size:11px;color:#f0c040;margin-top:2px">⚠️ ${esc(r.modeNote)}</div>` : ''}
    ${r.abortedAt ? `<div style="font-size:11px;color:#ff4444;margin-top:2px">中断ステップ: ${esc(r.abortedAt)}</div>` : ''}
  </div>
</div>`;

    // ── セクション 1：Phase1 プール ──
    let s1verdict = 'PASS';
    const p1 = r.phase1 || {};
    const poolsHTML = (p1.pools || []).map(p => {
      const pv = (p.found && p.isArray) ? 'PASS' : 'FAIL';
      if (pv === 'FAIL') s1verdict = 'FAIL';
      return `
<div class="qa-2a-pool-row">
  <span class="qa-2a-fname">${esc(p.name)}</span>
  <span class="qa-2a-fbadge qa-2a-fbadge-${pv}">${pv}</span>
  <span class="qa-2a-fval" style="color:${p.found?'#66bb6a':'#ff4444'}">${p.found?'found':'missing'}</span>
  <span class="qa-2a-fval" style="color:${p.isArray?'#66bb6a':'#ff4444'}">${p.isArray?'Array':'×'}</span>
  <span class="qa-2a-fval">${p.count != null ? p.count+'件' : (p.reason ? esc(p.reason) : '—')}</span>
</div>`;
    }).join('');
    const s1body = `
<div style="font-size:10px;color:#666;margin-bottom:6px">プール名 / 状態 / found / isArray / 件数</div>
${poolsHTML}
<div style="margin-top:8px;font-size:11px;color:#aaa">
  合計件数: <strong style="color:#64b5f6">${p1.totalCases ?? '—'}</strong>件 &nbsp;|&nbsp;
  P0警告: <strong style="color:${(p1.p0Count||0)>0?'#ff4444':'#66bb6a'}">${p1.p0Count ?? 0}件</strong>
</div>`;
    const sec1 = _section('【Phase 1】プールアクセス', s1verdict, s1body, s1verdict === 'PASS');

    // ── セクション 2：G差し替え ──
    const gr = r.gReplace || {};
    const s2verdict = gr.result || 'FAIL';
    const s2body = `
${_fieldRow('marker.__qaMarker === true', gr.markerApplied ? 'PASS' : 'FAIL',
    gr.markerApplied ? 'true（マーカー反映済み）' : 'false（マーカー未反映）')}
${_fieldRow('G !== originalRef（別参照）', gr.markerDiffers ? 'PASS' : 'FAIL',
    gr.markerDiffers ? '別参照（代入成功）' : '同一参照（代入不能）')}
${_fieldRow('即時復元（marker → original）', gr.restored ? 'PASS' : 'FAIL',
    gr.restored ? '成功' : '失敗')}
${gr.error ? `<div style="color:#ff4444;margin-top:4px;font-size:10px">例外: ${esc(gr.error)}</div>` : ''}`;
    const sec2 = _section('【G差し替え】marker test', s2verdict, s2body, s2verdict === 'PASS');

    // ── セクション 3：1日進行 ──
    const da = r.dayAdvance || {};
    const s3verdict = da.result || 'FAIL';
    const bef = da.before || {};
    const dur = da.during || {};
    const s3body = `
${_fieldRow('テスト前日付', 'PASS', `${bef.year}年${bef.month}月${bef.day}日 (totalDays ${bef.totalDays})`)}
${_fieldRow('advanceDay後日付（復元前）', da.result, `${dur.year}年${dur.month}月${dur.day}日 (totalDays ${dur.totalDays})`,
    `差分: +${(dur.totalDays||0)-(bef.totalDays||0)}日`)}
${_fieldRow('1日だけ進んだか', da.dayDiff === 1 ? 'PASS' : (da.dayDiff > 1 ? 'FAIL' : 'WARN'),
    da.dayDiff != null ? `${da.dayDiff}日進行` : '計測不能')}
${_fieldRow('ロッククリア（実行前）', da.lockCleared ? 'PASS' : 'WARN',
    da.lockCleared ? '完了' : '一部未クリア')}
${_fieldRow('ロック残留（実行後）', da.lockRemainedAfter ? 'WARN' : 'PASS',
    da.lockRemainedAfter ? '残留あり（強制クリア済み）' : 'なし')}
${_fieldRow('G.autoTesting 設定', da.autoTestingSet ? 'PASS' : 'WARN',
    da.autoTestingSet ? 'true に設定済み' : '未設定')}
${da.note ? `<div style="color:#f0c040;font-size:10px;margin-top:4px">${esc(da.note)}</div>` : ''}`;
    const sec3 = _section('【1日進行】advanceDay() 動作確認', s3verdict, s3body, false);

    // ── セクション 4：復元確認 ──
    const cf = r.compareFields || [];
    const s4verdict = cf.some(f => f.result === 'FAIL') ? 'FAIL'
      : cf.some(f => f.result === 'WARN') ? 'WARN' : (cf.length ? 'PASS' : 'FAIL');
    const s4body = cf.length
      ? cf.map(f => _fieldRow(f.name, f.result, f.before, f.result !== 'PASS' ? f.after : undefined)).join('')
        + (r.gFullMatch != null
          ? `<div style="margin-top:8px;font-size:10px;color:${r.gFullMatch?'#66bb6a':'#f0c040'}">
              G JSON 全体一致: ${r.gFullMatch ? '✓ 完全一致' : '△ 差異あり（個別フィールドの判定を参照）'}</div>` : '')
      : '<div style="color:#888">データなし（テスト未到達）</div>';
    const sec4 = _section('【復元確認】G フィールド比較', s4verdict, s4body, false);

    // ── セクション 5：副作用 ──
    const se = r.sideEffects || {};
    const lsDiffs   = se.lsDiffs   || [];
    const ssDiffs   = se.ssDiffs   || [];
    const extSends  = se.externalSendCount || 0;
    const unrestored= se.unrestoredFunctions || [];
    const s5verdict = (lsDiffs.length > 0 || extSends > 0 || unrestored.length > 0) ? 'FAIL'
      : (ssDiffs.length > 0) ? 'WARN' : 'PASS';
    const lsHTML = lsDiffs.length > 0
      ? lsDiffs.map(d => `<div style="color:#ff8800;font-size:10px;margin-left:8px">key: ${esc(d.key)}</div>`).join('')
      : '<span style="color:#66bb6a">なし</span>';
    const ssHTML = ssDiffs.length > 0
      ? ssDiffs.map(d => `<div style="color:#f0c040;font-size:10px;margin-left:8px">key: ${esc(d.key)}</div>`).join('')
      : '<span style="color:#66bb6a">なし</span>';
    const extHTML = se.externalSendLog && se.externalSendLog.length > 0
      ? se.externalSendLog.map(l => `<div style="color:#ff4444;font-size:10px;margin-left:8px">${esc(l)}</div>`).join('')
      : '';
    const unreHTML = unrestored.map(fn => `<div style="color:#ff4444;font-size:10px;margin-left:8px">${esc(fn)}</div>`).join('');
    const s5body = `
${_fieldRow('saveGame() 呼出回数', 'PASS', `${se.saveGameCallCount ?? 0}回（すべて書込遮断済み）`)}
${_fieldRow('localStorage 変更件数', lsDiffs.length > 0 ? 'FAIL' : 'PASS', `${lsDiffs.length}件`)}
${lsDiffs.length > 0 ? lsHTML : ''}
${_fieldRow('sessionStorage 変更件数', ssDiffs.length > 0 ? 'WARN' : 'PASS', `${ssDiffs.length}件`)}
${ssDiffs.length > 0 ? ssHTML : ''}
${_fieldRow('外部送信呼出回数 (fetch/XHR)', extSends > 0 ? 'FAIL' : 'PASS',
    `${extSends}回${extSends > 0 ? '（遮断済み）' : ''}`)}
${extHTML}
${_fieldRow('復元できなかった関数', unrestored.length > 0 ? 'FAIL' : 'PASS',
    unrestored.length > 0 ? `${unrestored.length}件` : 'なし')}
${unreHTML}`;
    const sec5 = _section('【副作用】外部影響チェック', s5verdict, s5body, s5verdict === 'PASS');

    // ── セクション 6：エラー ──
    const errs = r.errors || [];
    const s6verdict = errs.length > 0 ? 'FAIL' : 'PASS';
    const s6body = errs.length > 0
      ? errs.map(e => `
<div style="margin-bottom:8px;border-left:3px solid #ff4444;padding-left:8px">
  <div style="color:#ff8800;font-size:11px">ステップ: ${esc(e.step)}</div>
  <div style="color:#ff4444;font-size:11px">${esc(e.message)}</div>
  ${e.stack ? `<div style="color:#666;font-size:10px;margin-top:4px;white-space:pre-wrap">${esc(e.stack.slice(0, 500))}</div>` : ''}
</div>`).join('')
      : '<div style="color:#66bb6a">例外なし</div>';
    const sec6 = _section('【エラー】例外・中断', s6verdict, s6body, s6verdict === 'PASS');

    // ── 実行ログ（折りたたみ）──
    const logHTML = (r.log || []).map(entry => {
      const cls = `qa-2a-${entry.status}`;
      const detail = entry.detail ? `<br><span style="color:#555;font-size:10px;padding-left:16px">${esc(String(entry.detail)).slice(0,200)}</span>` : '';
      return `<div><span class="${cls}">[${entry.status}]</span> ${esc(entry.msg)}${detail}</div>`;
    }).join('');
    const secLog = _section('実行ログ（詳細）', overall, `<div class="qa-2a-log">${logHTML}</div>`, true);

    return `
${s0}${sec1}${sec2}${sec3}${sec4}${sec5}${sec6}${secLog}
<div style="margin-top:10px;display:flex;gap:8px">
  <button class="qa-btn" onclick="window._qa2aCopyJSON()">JSON コピー</button>
</div>`;
  }

  // ─── Phase 2A 本体 ───
  function runPhase2A() {
    if (_qa2aRunning) return;
    _qa2aRunning = true;

    const runBtn = document.getElementById('qa-2a-run');
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = '⏳ テスト実行中…'; }

    // ── 結果オブジェクト初期値 ──
    const log       = [];
    const errors    = [];
    let overall     = 'PASS';
    let modeNote    = null;
    let abortedAt   = null;

    const addLog = (status, msg, detail) => {
      log.push({ status, msg, detail: detail ?? null });
      console.log(`[QA2A][${status}] ${msg}`, detail ?? '');
    };
    const addErr = (step, e) => {
      errors.push({ step, message: e?.message ?? String(e), stack: e?.stack ?? '' });
      addLog('FAIL', `[${step}] 例外: ${e?.message ?? e}`, e?.stack ?? '');
      overall = 'FAIL';
    };
    const warnOverall = () => { if (overall === 'PASS') overall = 'WARN'; };

    // ── ストレージスナップショットヘルパー ──
    const captureStorage = (storage, label) => {
      const snap = {};
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && !k.startsWith('_qa')) snap[k] = storage.getItem(k);
        }
      } catch(e) { addLog('WARN', `${label} 取得失敗: ${e.message}`); }
      return snap;
    };
    const diffStorage = (before, after, excludeKey) => {
      const diffs = [];
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (k === excludeKey || k.startsWith('_qa')) continue;
        if (before[k] !== after[k]) diffs.push({ key: k, before: before[k], after: after[k] });
      }
      return diffs;
    };

    // ════════════════════════════════════════
    // ステップ1: Phase1 プール診断
    // ════════════════════════════════════════
    const d = buildQAData();
    const POOL_NAMES = ['CASE_POOL','DOMAIN_CASES','DAILY_EVENTS','MONTHLY_CHALLENGES','ISSUE_CARDS'];
    const phase1 = {
      pools: POOL_NAMES.map(name => {
        const info = d.poolDiagnostics[name] || { found: false, isArray: false, count: 0, reason: '不明' };
        return { name, found: info.found, isArray: info.isArray, count: info.count ?? 0, reason: info.reason };
      }),
      totalCases: d.cases.length,
      p0Count: d.warnings.filter(w => w.severity === 'P0').length,
    };
    addLog('INFO', `Phase1 プール: 合計 ${phase1.totalCases}件 / P0警告 ${phase1.p0Count}件`);

    // ════════════════════════════════════════
    // ステップ2: G差し替えテスト
    // ════════════════════════════════════════
    const gReplace = { result: 'FAIL', markerApplied: false, markerDiffers: false, restored: false, error: null };
    try {
      // eslint-disable-next-line no-eval
      const origRef = eval('G');
      // eslint-disable-next-line no-eval
      const marker = JSON.parse(JSON.stringify(eval('G')));
      marker.__qaMarker = true;
      // eslint-disable-next-line no-eval
      eval('G = marker');
      // eslint-disable-next-line no-eval
      gReplace.markerApplied = eval('G.__qaMarker') === true;
      // eslint-disable-next-line no-eval
      gReplace.markerDiffers = eval('G') !== origRef;
      // eslint-disable-next-line no-eval
      eval('G = origRef');
      gReplace.restored = true;
      gReplace.result   = (gReplace.markerApplied && gReplace.markerDiffers) ? 'PASS' : 'FAIL';
    } catch(e) {
      gReplace.error = e.message;
      addErr('G差し替えテスト', e);
    }
    if (gReplace.result !== 'PASS') overall = 'FAIL';
    addLog(gReplace.result, `G差し替えテスト: ${gReplace.result}（markerApplied:${gReplace.markerApplied} differs:${gReplace.markerDiffers}）`);

    if (gReplace.result !== 'PASS') {
      abortedAt = 'G差し替えテスト';
      addLog('FAIL', 'G代入不能のためテストを中断します。advanceDay() は呼びません。');
      _qa2aRunning = false;
      _qa2aLastResult = _buildResult({ log, errors, overall: 'FAIL', modeNote, abortedAt, phase1, gReplace,
        dayAdvance: null, compareFields: null, gFullMatch: null, sideEffects: null });
      window._qa2aCopyJSON = () => copyText(JSON.stringify(_qa2aLastResult, null, 2));
      renderSimTab();
      return;
    }

    // ════════════════════════════════════════
    // ステップ3: 事前スナップショット
    // ════════════════════════════════════════
    // eslint-disable-next-line no-eval
    const currentG   = eval('G');
    const gBeforeStr = JSON.stringify(currentG);
    const lsBefore   = captureStorage(localStorage,  'localStorage');
    const ssBefore   = captureStorage(sessionStorage, 'sessionStorage');
    const saveKey    = (typeof getSaveKey === 'function') ? getSaveKey() : null;
    addLog('INFO', `スナップショット完了: LS ${Object.keys(lsBefore).length}件 / SS ${Object.keys(ssBefore).length}件`);

    // 日付チェック
    const isNearStoryEnd = !currentG.freeMode && !currentG.gameEnded
      && currentG.year === 1 && currentG.month === 3 && currentG.day >= 28;
    if (isNearStoryEnd) {
      modeNote = `現在日 ${currentG.year}年${currentG.month}月${currentG.day}日 は第一章終了付近。G.freeMode=true を一時適用してテストします。`;
      addLog('WARN', modeNote);
      warnOverall();
    }

    // DOM前状態
    const domBefore = {
      title:           document.title,
      eventModalStyle: (document.getElementById('event-modal') || {}).style?.display ?? 'N/A',
    };

    // 外部送信スパイ
    const origFetch = window.fetch;
    const origXHRSend = XMLHttpRequest.prototype.send;
    const extSendLog  = [];
    const restoreFns  = []; // 復元すべき関数リスト: [{name, restore}]

    // saveGame spy
    const origSaveGame  = window.saveGame;
    const saveCallLog   = [];

    // dayAdvanceデータ
    const dayAdvance = {
      before:  { year: currentG.year, month: currentG.month, day: currentG.day,
                 totalDays: (currentG.year-1)*360 + (currentG.month-1)*30 + currentG.day },
      during:  null,
      dayDiff: null,
      result:  'FAIL',
      lockCleared: false,
      lockRemainedAfter: false,
      autoTestingSet: false,
      note: null,
    };

    try {
      // ── saveGame spy 設置 ──
      window.saveGame = () => { saveCallLog.push(new Date().toISOString()); };
      restoreFns.push({ name: 'window.saveGame', restore: () => { window.saveGame = origSaveGame; } });

      // ── 外部送信 spy 設置 ──
      window.fetch = (...args) => {
        extSendLog.push(`fetch: ${String(args[0]).slice(0, 80)}`);
        addLog('WARN', `fetch() 遮断: ${String(args[0]).slice(0, 80)}`);
        return Promise.resolve(new Response('{}', { status: 200 }));
      };
      restoreFns.push({ name: 'window.fetch', restore: () => { window.fetch = origFetch; } });

      XMLHttpRequest.prototype.send = function(...args) {
        extSendLog.push(`XHR: ${this._qaUrl || '(url不明)'}`);
        addLog('WARN', `XHR.send() 遮断`);
      };
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(m, url, ...rest) {
        this._qaUrl = url;
        return origOpen.call(this, m, url, ...rest);
      };
      restoreFns.push({ name: 'XMLHttpRequest.prototype.send', restore: () => {
        XMLHttpRequest.prototype.send = origXHRSend;
        XMLHttpRequest.prototype.open = origOpen;
      }});

      // ── G セットアップ ──
      // eslint-disable-next-line no-eval
      eval('G.autoTesting = true');
      dayAdvance.autoTestingSet = true;
      if (isNearStoryEnd) {
        // eslint-disable-next-line no-eval
        eval('G.freeMode = true');
      }

      // ── ロッククリア ──
      // eslint-disable-next-line no-eval
      eval('G.isAdvancingDay = false; G.processingMonthly = false; G.activeEvent = null;');
      const modal = document.getElementById('event-modal');
      if (modal) modal.style.display = 'none';
      dayAdvance.lockCleared = true;
      addLog('INFO', 'ブロッカークリア完了（isAdvancingDay / processingMonthly / activeEvent / event-modal）');

      // ── 1日進行 ──
      addLog('INFO', `advanceDay() 呼出: ${dayAdvance.before.year}年${dayAdvance.before.month}月${dayAdvance.before.day}日`);
      // eslint-disable-next-line no-eval
      eval('advanceDay()');

      // ── 進行後日付キャプチャ（復元前）──
      // eslint-disable-next-line no-eval
      const gDuring = eval('G');
      dayAdvance.during = {
        year: gDuring.year, month: gDuring.month, day: gDuring.day,
        totalDays: (gDuring.year-1)*360 + (gDuring.month-1)*30 + gDuring.day,
      };
      dayAdvance.dayDiff = dayAdvance.during.totalDays - dayAdvance.before.totalDays;
      addLog('INFO', `advanceDay()後: ${gDuring.year}年${gDuring.month}月${gDuring.day}日（+${dayAdvance.dayDiff}日）`);

      // ── ロック残留チェック ──
      // eslint-disable-next-line no-eval
      const stillLocked = eval('G.processingMonthly || G.isAdvancingDay');
      if (stillLocked) {
        dayAdvance.lockRemainedAfter = true;
        dayAdvance.note = '月末チェーンが未完了。強制クリアしました。';
        addLog('WARN', 'advanceDay() 後もロック残留 → 強制クリア');
        // eslint-disable-next-line no-eval
        eval('G.processingMonthly = false; G.isAdvancingDay = false; G.activeEvent = null;');
        warnOverall();
      } else {
        addLog('PASS', 'ロック正常解除を確認');
      }

      dayAdvance.result = dayAdvance.dayDiff === 1 ? 'PASS'
        : dayAdvance.dayDiff > 1  ? 'FAIL'
        : 'WARN'; // 0 or null
      if (dayAdvance.result === 'FAIL') overall = 'FAIL';
      if (dayAdvance.result === 'WARN') warnOverall();

    } catch(e) {
      addErr('advanceDay実行', e);
      dayAdvance.result = 'FAIL';
    } finally {
      // ════════════════════════════════════════
      // 復元フェーズ（例外時も必ず実行）
      // ════════════════════════════════════════
      const unrestoredFunctions = [];
      for (const fn of restoreFns) {
        try { fn.restore(); addLog('INFO', `復元: ${fn.name}`); }
        catch(e) { unrestoredFunctions.push(fn.name); addErr(`復元[${fn.name}]`, e); }
      }

      // G 復元
      let gRestoreOk = false;
      try {
        // eslint-disable-next-line no-eval
        eval('G = JSON.parse(gBeforeStr)');
        gRestoreOk = true;
        addLog('INFO', 'G 復元完了');
      } catch(e) { addErr('G復元', e); }

      // ── localStorage 比較 ──
      const lsAfter = captureStorage(localStorage, 'localStorage（復元後）');
      const lsDiffs  = diffStorage(lsBefore, lsAfter, saveKey);
      if (lsDiffs.length === 0) addLog('PASS', 'localStorage: 変化なし');
      else { addLog('FAIL', `localStorage: ${lsDiffs.length}件変化`, lsDiffs.map(d=>d.key).join(', ')); overall = 'FAIL'; }

      // ── sessionStorage 比較 ──
      const ssAfter = captureStorage(sessionStorage, 'sessionStorage（復元後）');
      const ssDiffs  = diffStorage(ssBefore, ssAfter, null);
      if (ssDiffs.length > 0) {
        addLog('WARN', `sessionStorage: ${ssDiffs.length}件変化`);
        warnOverall();
      }

      // ── G フィールド比較 ──
      // eslint-disable-next-line no-eval
      const gAfter    = eval('G');
      const gAfterStr = JSON.stringify(gAfter);
      const gFullMatch = gBeforeStr === gAfterStr;
      const gBefore   = JSON.parse(gBeforeStr);

      const fieldDefs = [
        { name: 'year',                   get: g => g.year },
        { name: 'month',                  get: g => g.month },
        { name: 'day',                    get: g => g.day },
        { name: 'totalDays（計算値）',    get: g => (g.year-1)*360+(g.month-1)*30+g.day },
        { name: 'money',                  get: g => g.money },
        { name: 'cash（= money alias）',  get: g => g.cash ?? g.money },
        { name: 'ap',                     get: g => g.ap },
        { name: 'apMax',                  get: g => g.apMax },
        { name: 'fatigue',                get: g => g.fatigue },
        { name: 'cases.length',           get: g => (g.cases||[]).length },
        { name: 'pendingFollowUps.length',get: g => (g.pendingFollowUps||[]).length },
        { name: 'activeEvent',            get: g => g.activeEvent == null ? 'null' : '(有)' },
        { name: 'stores（JSON）',         get: g => JSON.stringify((g.stores||[]).map(s=>({id:s.id,sat:s.sat,cust:s.customers}))) },
        { name: 'buildings.length',       get: g => (g.buildings||[]).length },
        { name: 'characters（JSON）',     get: g => JSON.stringify(g.characters||{}) },
        { name: 'gameEnded',              get: g => g.gameEnded },
        { name: 'freeMode',              get: g => g.freeMode },
        { name: 'autoTesting',            get: g => g.autoTesting },
      ];
      const compareFields = fieldDefs.map(f => {
        let before, after, result;
        try {
          before = f.get(gBefore);
          after  = f.get(gAfter);
          result = JSON.stringify(before) === JSON.stringify(after) ? 'PASS' : 'FAIL';
        } catch(e2) { before = '(取得失敗)'; after = '(取得失敗)'; result = 'WARN'; }
        if (result === 'FAIL') overall = 'FAIL';
        return { name: f.name, before, after, result };
      });
      addLog(gFullMatch ? 'PASS' : 'WARN', `G JSON 全体一致: ${gFullMatch ? '✓' : '△（個別判定参照）'}`);

      // DOM 復元確認
      const domAfterTitle = document.title;
      if (domBefore.title !== domAfterTitle) {
        addLog('WARN', `document.title 変化: "${domBefore.title}" → "${domAfterTitle}"`);
        warnOverall();
      }

      // 総合ログ
      addLog(overall, `=== Phase 2A 完了 / 総合判定: ${overall} ===`);

      const sideEffects = {
        saveGameCallCount:  saveCallLog.length,
        lsDiffs,
        ssDiffs,
        externalSendCount:  extSendLog.length,
        externalSendLog:    extSendLog,
        unrestoredFunctions,
      };

      _qa2aRunning = false;
      _qa2aLastResult = _buildResult({
        log, errors, overall, modeNote, abortedAt,
        phase1, gReplace, dayAdvance, compareFields, gFullMatch, sideEffects,
      });
      window._qa2aCopyJSON = () => copyText(JSON.stringify(_qa2aLastResult, null, 2));
      renderSimTab();
    }
  }

  function _buildResult(r) {
    return {
      executedAt:    new Date().toLocaleString('ja-JP', { hour12: false }),
      overall:       r.overall,
      modeNote:      r.modeNote    ?? null,
      abortedAt:     r.abortedAt   ?? null,
      phase1:        r.phase1      ?? null,
      gReplace:      r.gReplace    ?? null,
      dayAdvance:    r.dayAdvance  ?? null,
      compareFields: r.compareFields ?? null,
      gFullMatch:    r.gFullMatch  ?? null,
      sideEffects:   r.sideEffects ?? null,
      errors:        r.errors      ?? [],
      log:           r.log         ?? [],
    };
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
    <h4 style="color:#aaa;margin-bottom:8px">全データ</h4>
    <button class="qa-btn" onclick="window._qaExportFullJSON()">JSON コピー（全データ）</button>
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
        meta: {
          version: QA_VERSION,
          exportedAt: new Date().toISOString(),
          gameUrl: location.href,
          poolDiagnostics: d.poolDiagnostics,
        },
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
    injectStyles();
    createFAB();
    createOverlay();

    // プールアクセス確認（let/const は window.* 不可、eval 経由で取得）
    const poolCheck = ['CASE_POOL','DOMAIN_CASES','DAILY_EVENTS','MONTHLY_CHALLENGES','ISSUE_CARDS']
      .map(n => { const i = _getGlobal(n); return `${n}:${i.found && i.isArray ? i.arr.length+'件' : 'NG'}`; })
      .join(' / ');
    console.log(`[QA] 舞昆茶屋物語 QAツール ${QA_VERSION} 起動 (READ-ONLY)`);
    console.log(`[QA] プール診断: ${poolCheck}`);
  }

  // DOMが準備できていれば即時、そうでなければ待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

})();
