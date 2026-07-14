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

  // ─── シーケンシャルイベント除外グループ（意図的な連続イベント群）───
  // 同一グループ内で定義順に発生した場合は C06 警告対象外。
  // ただし同一 eventId 重複・順序違反・4件目混入・AP過剰・同日重複は別途警告。
  const QA_SEQUENCE_GROUPS = {
    narita_intro: ['narita_site_visit', 'narita_cashflow', 'narita_first_ad'],
  };
  // eventId → グループ名 の逆引きマップ
  const _QA_SEQ_ID_MAP = {};
  for (const [grp, ids] of Object.entries(QA_SEQUENCE_GROUPS)) {
    ids.forEach((id, idx) => { _QA_SEQ_ID_MAP[id] = { grp, pos: idx, total: ids.length }; });
  }

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
/* Phase 2B styles */
.qa-2b-divider{border:none;border-top:1px solid #2a4a6a;margin:20px 0}
.qa-2b-progress-wrap{background:#050f1a;border-radius:4px;height:8px;overflow:hidden;margin:8px 0}
.qa-2b-progress-bar{height:100%;background:#64b5f6;transition:width .3s;border-radius:4px}
.qa-2b-result-tabs{display:flex;gap:0;border-bottom:1px solid #2a4a6a;margin-bottom:10px;flex-wrap:wrap}
.qa-2b-rtab{padding:6px 12px;cursor:pointer;color:#888;font-size:11px;border-bottom:2px solid transparent;user-select:none}
.qa-2b-rtab:hover{color:#e0e0e0}
.qa-2b-rtab.active{color:#64b5f6;border-bottom-color:#64b5f6}
.qa-2b-rpanel{display:none}
.qa-2b-rpanel.active{display:block}
.qa-2b-stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-bottom:10px}
.qa-2b-stat-card{background:#0f3460;border:1px solid #2a4a6a;border-radius:5px;padding:7px 10px}
.qa-2b-stat-card .lbl{font-size:10px;color:#888;margin-bottom:2px}
.qa-2b-stat-card .val{font-size:16px;font-weight:700;color:#64b5f6}
.qa-2b-anomaly-row{display:grid;grid-template-columns:40px 50px 110px 1fr;gap:6px;padding:4px 6px;border-bottom:1px solid #0d1f30;font-size:11px;align-items:baseline}
.qa-2b-anomaly-row:last-child{border-bottom:none}
.qa-2b-elog-row{display:grid;grid-template-columns:90px 140px 120px 50px 60px 1fr;gap:4px;padding:2px 4px;border-bottom:1px solid #0d1f30;font-size:10px;align-items:baseline;font-family:monospace}
.qa-2b-elog-row:last-child{border-bottom:none}
.qa-2b-elog-hdr{color:#64b5f6;font-weight:700;border-bottom:1px solid #2a4a6a;padding-bottom:3px;margin-bottom:4px}
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
  <div class="qa-tab" data-tab="phase3">Phase 3A</div>
  <div class="qa-tab" data-tab="export">エクスポート</div>
</div>
<div id="qa-body">
  <div class="qa-panel active" id="qa-panel-audit"></div>
  <div class="qa-panel" id="qa-panel-warnings"></div>
  <div class="qa-panel" id="qa-panel-events"></div>
  <div class="qa-panel" id="qa-panel-sim"></div>
  <div class="qa-panel" id="qa-panel-phase3"></div>
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
    if (name === 'phase3')   renderPhase3Tab();
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
    // 結果がある場合は再描画する（Phase 2A + Phase 2B を同居）
    panel.innerHTML = `
<div style="max-width:760px">
  <!-- ── Phase 2A ── -->
  <h3 style="color:#64b5f6;margin-top:0">Phase 2A — 1日安全性テスト</h3>
  <div class="qa-notice" style="font-size:11px;padding:8px 12px">
    現在状態から <code>advanceDay()</code> を1回実行。G・localStorage・関数を完全復元して検証します。
  </div>
  <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <button class="qa-btn" id="qa-2a-run" onclick="window._qa2aRun()"
      ${_qa2aRunning ? 'disabled' : ''}>
      ${_qa2aRunning ? '⏳ テスト実行中…' : '▶ 1日テスト実行'}
    </button>
  </div>
  <div id="qa-2a-result-area">
    ${_qa2aLastResult ? renderSimResult(_qa2aLastResult) : '<div style="color:#555;font-size:12px">まだ実行していません。</div>'}
  </div>

  <hr class="qa-2b-divider">

  <!-- ── Phase 2B-1 ── -->
  <h3 style="color:#64b5f6;margin:0 0 8px">Phase 2B-1 — 現在から30日シミュレーション</h3>
  <div class="qa-notice" style="font-size:11px;padding:8px 12px">
    現在のゲーム状態をスナップショット保存し、<strong>バランス型</strong>プレイヤーで30日間自動進行します。<br>
    10日ごとにUIスレッドを解放。終了後、G・localStorage・全関数を完全復元します。<br>
    <strong>saveGame / fetch / XHR は遮断</strong>します。本番データへの影響はありません。
  </div>

  <div style="display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
    <button class="qa-btn" id="qa-2b-run" onclick="window._qa2bRun()"
      ${_sim2bRunning ? 'disabled' : ''}>
      ${_sim2bRunning ? '⏳ 実行中…' : '▶ 現在から30日'}
    </button>
    <button class="qa-btn" id="qa-2b-stop" onclick="window._qa2bStop()"
      ${!_sim2bRunning ? 'disabled' : ''} style="color:#ff8800;border-color:#ff8800">
      ■ 停止
    </button>
    <span style="font-size:11px;color:#666" id="qa-2b-elapsed"></span>
  </div>

  <div style="margin-bottom:12px">
    <div style="font-size:10px;color:#666;margin-bottom:3px" id="qa-2b-progress-info">
      ${_sim2bRunning ? '' : '待機中'}
    </div>
    <div class="qa-2b-progress-wrap">
      <div class="qa-2b-progress-bar" id="qa-2b-progress-bar" style="width:${_sim2bRunning&&_sim2b?Math.round(_sim2b.daysRun/_sim2b.targetDays*100):0}%"></div>
    </div>
  </div>

  <div id="qa-2b-result">
    ${window._qa2bLastResult ? renderPhase2BResult(window._qa2bLastResult) : '<div style="color:#555;font-size:12px">まだ実行していません。</div>'}
  </div>

  <hr class="qa-2b-divider">

  <!-- ── Phase 2C ── -->
  <h3 style="color:#ce93d8;margin:0 0 8px">Phase 2C — 現在から365日シミュレーション</h3>
  <div class="qa-notice" style="font-size:11px;padding:8px 12px">
    現在のゲーム状態から<strong>365日間</strong>自動進行します（バランス型・1回のみ）。<br>
    10日ごとにUIスレッドを解放。終了後、G・localStorage・全関数を完全復元します。<br>
    <strong>saveGame / fetch / XHR / showMainStoryClear をスパイ化</strong>します。本番データへの影響はありません。
  </div>

  <div style="display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
    <button class="qa-btn" id="qa-2c-run" onclick="window._qa2cRun()"
      ${_sim2cRunning ? 'disabled' : ''} style="color:#ce93d8;border-color:#ce93d8">
      ${_sim2cRunning ? '⏳ 実行中…' : '▶ 現在から365日'}
    </button>
    <button class="qa-btn" id="qa-2c-stop" onclick="window._qa2cStop()"
      ${!_sim2cRunning ? 'disabled' : ''} style="color:#ff8800;border-color:#ff8800">
      ■ 停止
    </button>
    <span style="font-size:11px;color:#666" id="qa-2c-elapsed"></span>
  </div>

  <div style="margin-bottom:12px">
    <div style="font-size:10px;color:#666;margin-bottom:3px" id="qa-2c-progress-info">
      ${_sim2cRunning ? '' : '待機中'}
    </div>
    <div class="qa-2b-progress-wrap">
      <div class="qa-2b-progress-bar" id="qa-2c-progress-bar" style="width:${_sim2cRunning&&_sim2c?Math.round(_sim2c.daysRun/_sim2c.targetDays*100):0}%;background:#ce93d8"></div>
    </div>
  </div>

  <div id="qa-2c-result">
    ${window._qa2cLastResult ? renderPhase2CResult(window._qa2cLastResult) : '<div style="color:#555;font-size:12px">まだ実行していません。</div>'}
  </div>
</div>`;

    window._qa2aRun  = runPhase2A;
    window._qa2bRun  = runPhase2B30;
    window._qa2bStop = () => { if (_sim2b) _sim2b.stopRequested = true; };
    window._qa2cRun  = runPhase2C365;
    window._qa2cStop = () => { if (_sim2c) _sim2c.stopRequested = true; };
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

  // ══════════════════════════════════════════════════════════════
  // ■ Phase 2B-1: 30日シミュレーション
  // ══════════════════════════════════════════════════════════════

  let _sim2b = null;
  let _sim2bRunning = false;
  let _sim2bLastChoiceReason = '';
  let _sim2bCurrentSource = 'auto_event'; // 'auto_event' or 'daily_case'

  function _sim2bTotalDays(g) {
    return (g.year - 1) * 360 + (g.month - 1) * 30 + g.day;
  }

  // ─── バランス型 選択ロジック ───
  function _balancedChoiceIdx(ev) {
    const choices = ev.choices || [];
    if (!choices.length) return 0;
    const evAP = ev.apCost ?? 0;
    const DANGER = 200000;

    const xs = choices.map((c, i) => ({
      idx: i,
      isNoAP:     !!c.noAP,
      apCost:     c.noAP ? 0 : (c.apCost ?? evAP),
      moneyDelta: c.effects?.money ?? 0,
      choiceCost: c.cost ?? 0,
      isDecline:  DECLINE_KW.some(kw => (c.label || '').includes(kw)),
    }));

    // Rule 1: filter by current AP and money (chooseEvent returns early if either is insufficient)
    const canDo = xs.filter(x =>
      (x.isNoAP || x.apCost <= G.ap) && x.choiceCost <= G.money
    );
    if (!canDo.length) { _sim2bLastChoiceReason = 'lowAP'; return null; } // anomaly 1

    const active  = canDo.filter(x => !x.isNoAP);
    const passive = canDo.filter(x =>  x.isNoAP);

    if (active.length > 0) {
      let pool = active;
      let reason = 'positiveBalanced';
      // Rule 2: money danger → avoid large losses
      if (G.money < DANGER) {
        const safe = pool.filter(x => x.moneyDelta > -100000);
        if (safe.length > 0) { pool = safe; reason = 'safeCash'; }
      }
      // Rule 4: prefer non-decline, lowest AP cost
      const nonDec = pool.filter(x => !x.isDecline);
      const final  = nonDec.length > 0 ? nonDec : pool;
      final.sort((a, b) => a.apCost - b.apCost);
      _sim2bLastChoiceReason = reason;
      return final[0].idx;
    }
    // Rule 3/5: only passive available
    _sim2bLastChoiceReason = 'noAPFallback';
    return passive[0]?.idx ?? 0;
  }

  // ─── イベント発火時の異常検出 ───
  function _sim2bCheckAnomalies(ev, chosenIdx) {
    const s = _sim2b;
    const choices = ev.choices || [];
    const chosen  = chosenIdx != null ? choices[chosenIdx] : null;
    const date    = `${G.year}年${G.month}月${G.day}日`;

    const add = (num, sev, reason) => {
      s.anomalies.push({
        anomalyNum: num, severity: sev, date,
        eventId:    ev.id    || '',
        title:      ev.title || '',
        choiceLabel: chosen?.label || '(なし)',
        reason,
        gState: { ap: G.ap, money: G.money, year: G.year, month: G.month, day: G.day },
      });
    };

    // 異常1: 全AP選択肢が選べない
    if (chosenIdx === null) { add(1, 'FAIL', `全選択肢がAP不足（G.ap=${G.ap}）`); return; }

    // 異常3: 満室なのに空室系案件
    if (VACANCY_SENDER_KW.some(kw => (ev.sender||'').includes(kw)) || ev.requireVacancy) {
      try {
        const total = (G.buildings||[]).reduce((s,b)=>s+(b.totalRooms??b.capacity??0),0);
        const occ   = (G.buildings||[]).reduce((s,b)=>s+(b.occupants??b.residents?.length??0),0);
        if (total > 0 && occ >= total) add(3,'WARN',`満室(${occ}/${total})で空室案件が発生`);
      } catch(e) {}
    }

    // 異常4: スタッフ0でスタッフ前提
    if (STAFF_SENDER_KW.some(kw=>(ev.sender||'').includes(kw)) || ev.requireStaff) {
      try {
        const hasStaff = G.characters?.midori?.met ||
          (Array.isArray(G.staff) && G.staff.length > 0);
        if (!hasStaff) add(4,'WARN','スタッフ未採用でスタッフ前提案件が発生');
      } catch(e) {}
    }

    // 異常5: みどり未採用でみどり選択肢
    // hireStaff:'midori' は採用アクション自体なので未採用時に表示されて当然 → 除外
    if (choices.some(c=>(c.label||'').includes('みどり') && c.effects?.hireStaff !== 'midori')) {
      try {
        const midoriOk = G.characters?.midori?.level >= 1 ||
          (Array.isArray(G.staff) && G.staff.some(x=>x.id==='midori'||x.name==='みどり'));
        if (!midoriOk) add(5,'WARN','みどり未採用でみどり関連選択肢が表示');
      } catch(e) {}
    }

    // 異常6: 季節外
    if (ev.minMonth || ev.maxMonth) {
      const m=G.month, mn=ev.minMonth??1, mx=ev.maxMonth??12;
      if (m<mn||m>mx) add(6,'WARN',`季節外発火: ${m}月（想定 ${mn}〜${mx}月）`);
    } else {
      for (const rule of SEASONAL_RULES) {
        if ((ev.title||'').includes(rule.kw)) {
          const m=G.month;
          if (m<rule.minM||m>rule.maxM) add(6,'WARN',`季節外: "${rule.kw}"が${m}月（想定:${rule.label}）`);
          break;
        }
      }
    }

    // 異常7: oncePerYear重複
    if (ev.oncePerYear && ev.id) {
      if (!s.oncePerYearSeen[ev.id]) s.oncePerYearSeen[ev.id] = [];
      if (s.oncePerYearSeen[ev.id].includes(G.year)) {
        add(7,'FAIL',`oncePerYear案件が${G.year}年に複数回発生`);
      } else {
        s.oncePerYearSeen[ev.id].push(G.year);
      }
    }

    // 異常8: NaN（イベント処理前）
    const nans = ['ap','money','fatigue'].filter(f=>isNaN(G[f]));
    if (nans.length) add(8,'FAIL',`NaN検出: ${nans.join(', ')}`);
  }

  // ─── _autoResolveEvent の上書き実装（バランス型）───
  function _sim2bAutoResolve() {
    const s = _sim2b;
    const ev = G.activeEvent;
    if (!ev) return;

    const chosenIdx = _balancedChoiceIdx(ev);
    const selectionReason = _sim2bLastChoiceReason;
    _sim2bCheckAnomalies(ev, chosenIdx);

    const choices = ev.choices || [];
    const chosen  = chosenIdx != null ? choices[chosenIdx] : null;
    const isNoAP  = chosen?.noAP ?? false;
    const hasFollowUp = !!(chosen?.followUp || chosen?.followUpId || chosen?.followup);
    const isDecline   = DECLINE_KW.some(kw=>(chosen?.label||'').includes(kw));

    const apBefore    = G.ap;
    const moneyBefore = G.money;

    const logEntry = {
      source:      _sim2bCurrentSource,
      date:        `${G.year}年${G.month}月${G.day}日`,
      eventId:     ev.id    || '(unknown)',
      title:       ev.title || '',
      category:    ev.category || '',
      choiceIdx:   chosenIdx ?? -1,
      choiceLabel: chosen?.label || '(選択不能)',
      selectionReason,
      apBefore,    apAfter: null, apSpent: null,
      moneyBefore, moneyAfter: null, moneyDelta: null,
      isNoAP,
      isDecline,
      hasFollowUp,
      type: chosenIdx===null ? 'unresolvable' : isNoAP ? 'passive' : 'active',
    };
    s.eventLog.push(logEntry);

    s.stats.totalEvents++;
    if (chosenIdx === null) {
      s.stats.unresolvable = (s.stats.unresolvable||0) + 1;
      logEntry.apAfter    = G.ap;    logEntry.apSpent    = 0;
      logEntry.moneyAfter = G.money; logEntry.moneyDelta = 0;
      // Fall back so the event doesn't deadlock
      if (s.origAutoResolve) s.origAutoResolve();
      return;
    }
    if (isNoAP || isDecline) s.stats.declined++;
    else                     s.stats.resolved++;
    if (hasFollowUp) s.stats.followUps++;

    chooseEvent(chosenIdx, false);

    // 実消費を before/after 差分で記録
    logEntry.apAfter    = G.ap;
    logEntry.apSpent    = apBefore - G.ap;
    logEntry.moneyAfter = G.money;
    logEntry.moneyDelta = G.money - moneyBefore;
  }

  // ─── 1日の処理対象案件リストを返す ───
  function _sim2bGetEligibleCases(todayTotal) {
    const cases = G.cases || [];
    return cases.filter(c => {
      if (c.resolved || c.expired) return false;
      // staffAutoProcess が既に処理する ops 案件はスキップ
      if (c.category === 'ops') return false;
      // 条件チェック
      if (c.requireStaff && !G.characters?.midori?.met) return false;
      if (c.requireProduct && !(G.products || {})[c.requireProduct]) return false;
      if (c.minRep  && (G.rep  || 0) < c.minRep)  return false;
      if (c.minDay  && todayTotal       < c.minDay)  return false;
      if (c.minMonth && (G.month || 1)  < c.minMonth) return false;
      return true;
    });
  }

  // ─── 1日の案件自動処理 ───
  function _sim2bProcessDailyCases(todayTotal) {
    const s = _sim2b;
    const DAILY_LIMIT = 5;        // AP 0 ループ防止上限
    let processed = 0;

    const eligible = _sim2bGetEligibleCases(todayTotal);
    if (!eligible.length) return;

    // 優先度: conditionOnly:false → conditionOnly:true の順
    eligible.sort((a, b) => (a.conditionOnly ? 1 : 0) - (b.conditionOnly ? 1 : 0));

    for (const c of eligible) {
      if (processed >= DAILY_LIMIT) break;

      // AP が 0 で全選択肢が AP 消費ありなら後回し
      if (G.ap <= 0) {
        const idx = (G.cases || []).indexOf(c);
        s.caseSkipLog.push({
          date: `${G.year}年${G.month}月${G.day}日`,
          eventId: c.id || '(unknown)',
          title: c.title || '',
          reason: 'lowAP',
        });
        s.stats.caseSkipped++;
        continue;
      }

      const idx = (G.cases || []).indexOf(c);
      if (idx < 0) continue;

      _sim2bCurrentSource = 'daily_case';
      try {
        G.activeEvent = null;
        // eslint-disable-next-line no-eval
        eval(`resolveCase(${idx})`);
        // chooseEvent は autoResolve 内で呼ばれるが G.activeEvent は残る
        G.activeEvent = null;
        processed++;
        s.stats.caseResolved++;
      } catch(e) {
        s.errors.push({ step:`resolveCase(idx=${idx})`, message:e.message, stack:e.stack||'' });
        G.activeEvent = null;
      }
      _sim2bCurrentSource = 'auto_event';
    }
  }

  // ─── 同期チャンク実行（10日分）───
  function _sim2bDoChunk(chunkSize) {
    const s = _sim2b;
    const end = Math.min(s.daysRun + chunkSize, s.targetDays);

    while (s.daysRun < end && !s.stopRequested) {
      const prevTotal = _sim2bTotalDays(G);
      const prevDate  = { year:G.year, month:G.month, day:G.day };

      // クリア（_autoTestChunk 準拠）
      G.isAdvancingDay  = false;
      G.processingMonthly = false;
      G.activeEvent     = null;
      const modal = document.getElementById('event-modal');
      if (modal) modal.style.display = 'none';
      if (G.money < 0) G.money = 0; // cash crisis ブロック回避

      // 案件を自動処理してから日送り
      _sim2bProcessDailyCases(prevTotal);
      G.activeEvent = null;

      try {
        // eslint-disable-next-line no-eval
        eval('advanceDay()');
      } catch(e) {
        s.errors.push({ step:`advanceDay(day${s.daysRun+1})`, message:e.message, stack:e.stack||'' });
      }

      // 残留ロッククリア
      if (G.processingMonthly||G.isAdvancingDay) {
        G.processingMonthly=false; G.isAdvancingDay=false; G.activeEvent=null;
      }

      const afterTotal = _sim2bTotalDays(G);
      const dayDiff    = afterTotal - prevTotal;
      s.apHistory.push(isNaN(G.ap) ? null : G.ap);

      // 異常8: NaN（日送り後）
      const nans = ['ap','money','fatigue'].filter(f=>isNaN(G[f]));
      if (nans.length) {
        s.anomalies.push({ anomalyNum:8, severity:'FAIL',
          date:`${G.year}年${G.month}月${G.day}日`, eventId:'(day tick)', title:'日送り後NaN',
          reason:`NaN: ${nans.join(', ')}`, gState:{ap:G.ap,money:G.money,fatigue:G.fatigue} });
      }

      // 異常9: 日付進行
      if (dayDiff !== 1) {
        s.anomalies.push({ anomalyNum:9, severity:dayDiff===0?'FAIL':'WARN',
          date:`${prevDate.year}年${prevDate.month}月${prevDate.day}日`,
          eventId:'(day tick)', title:'日付進行異常',
          reason:`${dayDiff}日進んだ（期待値:1）`, gState:{ap:G.ap,money:G.money} });
      }

      // 月境界: 月次データ記録
      if (G.month !== prevDate.month || G.year !== prevDate.year) {
        s.monthlyData.push({
          year:  prevDate.year, month: prevDate.month,
          startMoney: s.monthStart.money,
          endMoney:   G.money,
          netChange:  G.money - s.monthStart.money,
        });
        s.monthStart = { money:G.money, month:G.month, year:G.year };
      }

      s.daysRun++;
      s.currentDate = { year:G.year, month:G.month, day:G.day };
    }
  }

  // ─── 進捗 UI 更新 ───
  function _sim2bUpdateProgress() {
    const s = _sim2b;
    if (!s) return;
    const pct     = Math.round(s.daysRun / s.targetDays * 100);
    const elapsed = ((Date.now() - s.startTime) / 1000).toFixed(1);
    const bar  = document.getElementById('qa-2b-progress-bar');
    const info = document.getElementById('qa-2b-progress-info');
    const elEl = document.getElementById('qa-2b-elapsed');
    if (bar)  bar.style.width  = pct + '%';
    if (info) info.textContent = `${s.daysRun} / ${s.targetDays} 日（${pct}%）`;
    if (elEl) elEl.textContent = `経過 ${elapsed}s`;
  }

  // ─── チャンク非同期スケジューラ ───
  function _sim2bScheduleNext() {
    const s = _sim2b;
    if (!s) return;
    if (s.daysRun >= s.targetDays || s.stopRequested) {
      _sim2bFinish();
      return;
    }
    setTimeout(() => {
      _sim2bDoChunk(10);
      _sim2bUpdateProgress();
      _sim2bScheduleNext();
    }, 0);
  }

  // ─── 復元・結果集計 ───
  function _sim2bFinish() {
    const s = _sim2b;
    if (!s) return;

    // シミュレーション終了時の状態を復元前に記録
    const simEndState = {
      year:G.year, month:G.month, day:G.day,
      money:G.money, ap:G.ap, fatigue:G.fatigue,
      casesLength: (G.cases||[]).length,
      pendingFollowUps: (G.pendingFollowUps||[]).length,
    };

    // 未解決ケーススナップショット（G復元前）
    const todayTotal = _sim2bTotalDays(G);
    const midoriHired = !!(G.characters?.midori?.met) ||
      (Array.isArray(G.staff) && G.staff.some(x=>x.id==='midori'||x.name==='みどり'));
    const simEndCases = (G.cases||[]).map(c => {
      if (c.resolved) return { eventId: c.id||'(unknown)', title: c.title||'', resolved: true,  expired: false, conditionOnly: !!c.conditionOnly, status: 'resolved', unresolvedReason: 'resolved済み' };
      if (c.expired)  return { eventId: c.id||'(unknown)', title: c.title||'', resolved: false, expired: true,  conditionOnly: !!c.conditionOnly, status: 'expired',  unresolvedReason: 'expired' };
      const blocks = [];
      if (c.requireStaff && !midoriHired)       blocks.push(`スタッフ待ち`);
      if (c.requireProduct && !(G.products||{})[c.requireProduct]) blocks.push(`商品解放待ち(${c.requireProduct})`);
      if (c.minRep   && (G.rep||0)   < c.minRep)   blocks.push(`評判待ち(${G.rep??0}<${c.minRep})`);
      if (c.minDay   && todayTotal    < c.minDay)   blocks.push(`将来日待ち(day${todayTotal}<${c.minDay})`);
      if (c.minMonth && (G.month||1) < c.minMonth) blocks.push(`将来月待ち(${G.month}月<${c.minMonth}月)`);
      const status = blocks.length ? '条件待ち' : '処理待ち';
      const unresolvedReason = blocks.length ? blocks.join(' / ') : '条件充足済みだが未処理（日次上限 or 抽選待ち）';
      return {
        eventId:       c.id || '(unknown)',
        title:         c.title || '',
        resolved:      false,
        expired:       false,
        conditionOnly: !!c.conditionOnly,
        requireStaff:  c.requireStaff || false,
        requireProduct:c.requireProduct || null,
        minRep:        c.minRep ?? null,
        minDay:        c.minDay ?? null,
        minMonth:      c.minMonth ?? null,
        status,
        unresolvedReason,
      };
    });

    // 月次データ：最終月を記録（境界を跨がない場合のみ）
    // year+month 両方で重複チェック（月のみだと年越しで誤検出）
    {
      const last = s.monthlyData[s.monthlyData.length-1];
      const alreadyRecorded = last &&
        last.year === s.monthStart.year && last.month === s.monthStart.month;
      if (!alreadyRecorded) {
        s.monthlyData.push({
          year:s.monthStart.year, month:s.monthStart.month,
          startMoney:s.monthStart.money, endMoney:G.money,
          netChange:G.money - s.monthStart.money,
        });
      }
    }

    // ── 関数復元 ──
    const unrestoredFunctions = [];
    const restore = (name, fn) => {
      try { fn(); } catch(e) { unrestoredFunctions.push(name); }
    };
    restore('window._autoResolveEvent', () => { window._autoResolveEvent = s.origAutoResolve; });
    restore('window.saveGame',          () => { window.saveGame = s.origSaveGame; });
    restore('window.fetch',             () => { window.fetch   = s.origFetch; });
    restore('XMLHttpRequest',           () => {
      XMLHttpRequest.prototype.send = s.origXHRSend;
      XMLHttpRequest.prototype.open = s.origXHROpen;
    });

    // ── G 復元 ──
    let gRestoreOk = false;
    try {
      // eslint-disable-next-line no-eval
      eval('G = JSON.parse(s.gBeforeStr)');
      gRestoreOk = true;
    } catch(e) {
      s.errors.push({ step:'G復元', message:e.message, stack:e.stack||'' });
    }

    // ── localStorage diff ──
    const captureLS = () => {
      const snap={};
      try { for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&!k.startsWith('_qa'))snap[k]=localStorage.getItem(k);} } catch(e){}
      return snap;
    };
    const captureSS = () => {
      const snap={};
      try { for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);if(k&&!k.startsWith('_qa'))snap[k]=sessionStorage.getItem(k);} } catch(e){}
      return snap;
    };
    const lsAfter  = captureLS();
    const ssAfter  = captureSS();
    const lsDiffs  = Object.keys({...s.lsBefore,...lsAfter})
      .filter(k=>k!==s.saveKey&&!k.startsWith('_qa')&&s.lsBefore[k]!==lsAfter[k])
      .map(k=>({key:k}));
    const ssDiffs  = Object.keys({...s.ssBefore,...ssAfter})
      .filter(k=>!k.startsWith('_qa')&&s.ssBefore[k]!==ssAfter[k])
      .map(k=>({key:k}));

    // ── G フィールド比較 ──
    // eslint-disable-next-line no-eval
    const gAfter   = eval('G');
    const gBefore  = JSON.parse(s.gBeforeStr);
    const gFullMatch = JSON.stringify(gBefore)===JSON.stringify(gAfter);
    const safetyFields = [
      {name:'year',   get:g=>g.year},
      {name:'month',  get:g=>g.month},
      {name:'day',    get:g=>g.day},
      {name:'money',  get:g=>g.money},
      {name:'ap',     get:g=>g.ap},
      {name:'fatigue',get:g=>g.fatigue},
      {name:'cases.length',get:g=>(g.cases||[]).length},
      {name:'autoTesting', get:g=>g.autoTesting},
      {name:'gameEnded',   get:g=>g.gameEnded},
      {name:'freeMode',    get:g=>g.freeMode},
    ];
    const compareFields = safetyFields.map(f=>{
      let before,after,result;
      try{before=f.get(gBefore);after=f.get(gAfter);result=JSON.stringify(before)===JSON.stringify(after)?'PASS':'FAIL';}
      catch(e2){before='(err)';after='(err)';result='WARN';}
      return {name:f.name,before,after,result};
    });

    // ── 判定 ──
    const safetyFail = compareFields.some(f=>f.result==='FAIL') ||
      lsDiffs.length>0 || ssDiffs.length>0 ||
      unrestoredFunctions.length>0 || s.externalSendLog.length>0;
    const safetyOverall = safetyFail?'FAIL':
      compareFields.some(f=>f.result==='WARN')?'WARN':'PASS';

    const failA = s.anomalies.filter(a=>a.severity==='FAIL');
    const warnA = s.anomalies.filter(a=>a.severity==='WARN');
    const simOverall = s.errors.length>0||failA.length>0?'FAIL':
      warnA.length>0?'WARN':'PASS';

    const overall = (simOverall==='FAIL'||safetyOverall==='FAIL')?'FAIL':
      (simOverall==='WARN'||safetyOverall==='WARN')?'WARN':'PASS';

    const apValid = s.apHistory.filter(x=>x!=null);
    const result = {
      executedAt:   new Date().toLocaleString('ja-JP',{hour12:false}),
      elapsed:      ((Date.now()-s.startTime)/1000).toFixed(1)+'s',
      overall, simOverall, safetyOverall,
      stopped:      s.stopRequested,
      daysCompleted: s.daysRun,
      targetDays:   s.targetDays,
      startState:   s.startState,
      endDateSimulated: simEndState,
      stats: {
        totalEvents:    s.stats.totalEvents,
        resolved:       s.stats.resolved,
        declined:       s.stats.declined,
        unresolvable:   s.stats.unresolvable||0,
        followUps:      s.stats.followUps,
        caseResolved:   s.stats.caseResolved,
        caseSkipped:    s.stats.caseSkipped,
        totalCases:     simEndCases.length,
        casesResolved:  simEndCases.filter(c=>c.resolved).length,
        casesExpired:   simEndCases.filter(c=>c.expired).length,
        casesUnresolved: simEndCases.filter(c=>!c.resolved && !c.expired).length,
        startMoney:     s.startState.money,
        endMoney:       simEndState.money,
        startAP:        s.startState.ap,
        endAP:          simEndState.ap,
        avgAP:          apValid.length ? Math.round(apValid.reduce((a,b)=>a+b,0)/apValid.length) : null,
        minAP:          apValid.length ? Math.min(...apValid) : null,
        endFatigue:     simEndState.fatigue,
      },
      monthlyData:  s.monthlyData,
      anomalies:    s.anomalies,
      eventLog:     s.eventLog,
      endCasesSnapshot: simEndCases,
      caseSkipLog:  s.caseSkipLog,
      safety: {
        gFullMatch, gRestoreOk, compareFields,
        lsDiffs, ssDiffs,
        saveCallCount:    s.saveCallCount,
        externalSendLog:  s.externalSendLog,
        unrestoredFunctions,
      },
      errors: s.errors,
    };

    _sim2bRunning = false;
    _sim2b        = null;

    // ── UI 更新 ──
    const runBtn  = document.getElementById('qa-2b-run');
    const stopBtn = document.getElementById('qa-2b-stop');
    if (runBtn)  { runBtn.disabled=false; runBtn.textContent='▶ 現在から30日'; }
    if (stopBtn) stopBtn.disabled = true;
    const bar  = document.getElementById('qa-2b-progress-bar');
    const info = document.getElementById('qa-2b-progress-info');
    if (bar)  bar.style.width = '100%';
    if (info) info.textContent = `完了: ${result.daysCompleted} 日`;

    window._qa2bLastResult  = result;
    window._qa2bCopyJSON    = () => copyText(JSON.stringify(result, null, 2));

    const resultEl = document.getElementById('qa-2b-result');
    if (resultEl) resultEl.innerHTML = renderPhase2BResult(result);
  }

  // ─── エントリポイント ───
  function runPhase2B30() {
    if (_sim2bRunning || _qa2aRunning) return;

    // G 代入可否チェック（Phase 2A と同じ）
    try {
      // eslint-disable-next-line no-eval
      const orig = eval('G');
      const mk   = JSON.parse(JSON.stringify(orig)); mk.__qb=true;
      // eslint-disable-next-line no-eval
      eval('G = mk');
      // eslint-disable-next-line no-eval
      const ok = eval('G.__qb') === true;
      // eslint-disable-next-line no-eval
      eval('G = orig');
      if (!ok) { alert('G代入テスト失敗。シミュレーションを中止します。'); return; }
    } catch(e) { alert('G代入テスト例外: '+e.message); return; }

    _sim2bRunning = true;

    // ── 初期スナップショット ──
    // eslint-disable-next-line no-eval
    const currentG   = eval('G');
    const gBeforeStr = JSON.stringify(currentG);

    const captureLS = () => {
      const snap={};
      try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&!k.startsWith('_qa'))snap[k]=localStorage.getItem(k);}}catch(e){}
      return snap;
    };
    const captureSS = () => {
      const snap={};
      try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);if(k&&!k.startsWith('_qa'))snap[k]=sessionStorage.getItem(k);}}catch(e){}
      return snap;
    };

    const lsBefore = captureLS();
    const ssBefore = captureSS();
    const saveKey  = (typeof getSaveKey==='function') ? getSaveKey() : null;

    _sim2b = {
      targetDays:  30,
      daysRun:     0,
      stopRequested: false,
      startTime:   Date.now(),
      gBeforeStr,
      lsBefore, ssBefore, saveKey,
      origSaveGame:    window.saveGame,
      origAutoResolve: window._autoResolveEvent,
      origFetch:       window.fetch,
      origXHRSend:     XMLHttpRequest.prototype.send,
      origXHROpen:     XMLHttpRequest.prototype.open,
      startState: {
        year:currentG.year, month:currentG.month, day:currentG.day,
        money:currentG.money, ap:currentG.ap, fatigue:currentG.fatigue,
        casesLength:(currentG.cases||[]).length,
      },
      currentDate:  {year:currentG.year,month:currentG.month,day:currentG.day},
      monthStart:   {money:currentG.money,month:currentG.month,year:currentG.year},
      monthlyData:  [],
      apHistory:    [],
      eventLog:     [],
      anomalies:    [],
      oncePerYearSeen: {},
      stats:        {totalEvents:0,resolved:0,declined:0,followUps:0,caseResolved:0,caseSkipped:0},
      saveCallCount:0,
      externalSendLog:[],
      caseSkipLog:  [],
      errors:       [],
    };

    // ── スパイ設置 ──
    window.saveGame = () => { _sim2b && _sim2b.saveCallCount++; };

    window._autoResolveEvent = _sim2bAutoResolve;

    window.fetch = (...args) => {
      if (_sim2b) _sim2b.externalSendLog.push(`fetch:${String(args[0]).slice(0,60)}`);
      return Promise.resolve(new Response('{}',{status:200}));
    };
    const origOpen = _sim2b.origXHROpen;
    XMLHttpRequest.prototype.open = function(m,url,...rest){
      this._qaUrl=url; return origOpen.call(this,m,url,...rest);
    };
    XMLHttpRequest.prototype.send = function(){
      if (_sim2b) _sim2b.externalSendLog.push(`XHR:${this._qaUrl||'?'}`);
    };

    // ── G セットアップ ──
    // eslint-disable-next-line no-eval
    eval('G.autoTesting = true');
    // eslint-disable-next-line no-eval
    eval('G.tut = G.tut || {}; if(!G.tut.phase||G.tut.phase==="opening") G.tut.phase="done";');

    // ── UI 更新 ──
    const runBtn  = document.getElementById('qa-2b-run');
    const stopBtn = document.getElementById('qa-2b-stop');
    if (runBtn)  { runBtn.disabled=true; runBtn.textContent='⏳ 実行中…'; }
    if (stopBtn) stopBtn.disabled = false;
    const resultEl = document.getElementById('qa-2b-result');
    if (resultEl) resultEl.innerHTML = '<div style="color:#64b5f6;font-size:12px">⏳ シミュレーション実行中…</div>';

    _sim2bUpdateProgress();
    setTimeout(() => { _sim2bDoChunk(10); _sim2bUpdateProgress(); _sim2bScheduleNext(); }, 0);
  }

  // ─── Phase 2B 結果描画 ───
  function renderPhase2BResult(r) {
    const oc = r.overall==='PASS'?'#66bb6a':r.overall==='WARN'?'#f0c040':'#ff4444';
    const sc = r.startState, ec = r.endDateSimulated;

    // ── 結果サブタブ ──
    const tabId = 'qa2b-rt-' + Math.random().toString(36).slice(2);

    // 統計HTML
    const st = r.stats;
    const statsHTML = `
<div class="qa-2b-stat-grid">
  <div class="qa-2b-stat-card"><div class="lbl">開始日</div><div class="val" style="font-size:13px">${sc.year}年${sc.month}月${sc.day}日</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">終了日（シム内）</div><div class="val" style="font-size:13px">${ec.year}年${ec.month}月${ec.day}日</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">実行日数</div><div class="val">${r.daysCompleted}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">総案件発火数</div><div class="val">${st.totalEvents}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">解決数（active）</div><div class="val" style="color:#66bb6a">${st.resolved}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">見送り / noAP</div><div class="val" style="color:#f0c040">${st.declined}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">選択不能件数</div><div class="val" style="color:${st.unresolvable>0?'#ff4444':'#888'}">${st.unresolvable}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">followUp発生数</div><div class="val">${st.followUps}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">案件処理数</div><div class="val" style="color:#66bb6a">${st.caseResolved}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">案件スキップ（AP不足）</div><div class="val" style="color:#f0c040">${st.caseSkipped}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">案件 解決/未解決/期限切</div><div class="val" style="font-size:12px">${st.casesResolved} / ${st.casesUnresolved} / ${st.casesExpired}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">開始現金</div><div class="val" style="font-size:12px">¥${(st.startMoney||0).toLocaleString()}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">終了現金（シム）</div><div class="val" style="font-size:12px">¥${(ec.money||0).toLocaleString()}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">開始AP / 終了AP</div><div class="val" style="font-size:12px">${st.startAP} → ${st.endAP}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">平均AP</div><div class="val">${st.avgAP??'—'}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">最低AP</div><div class="val" style="color:${(st.minAP??100)<20?'#ff4444':'#64b5f6'}">${st.minAP??'—'}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">疲労（シム終了時）</div><div class="val">${ec.fatigue}</div></div>
</div>`;

    // 月別売上HTML
    const monthHTML = r.monthlyData.length > 0 ? `
<div style="font-size:11px;color:#888;margin-bottom:6px">※ 月末資金変動（収入 - 支出の概算）</div>
${r.monthlyData.map(m=>`
<div class="qa-2a-field-row">
  <span class="qa-2a-fname">${m.year}年${m.month}月</span>
  <span class="qa-2a-fbadge qa-2a-fbadge-${m.netChange>=0?'PASS':'WARN'}">${m.netChange>=0?'+':''}</span>
  <span class="qa-2a-fval">¥${(m.netChange).toLocaleString()} （${(m.startMoney).toLocaleString()} → ${(m.endMoney).toLocaleString()}）</span>
</div>`).join('')}
` : '<div style="color:#888;font-size:11px">月次データなし（30日未満の場合）</div>';

    // 異常HTML
    const anomHTML = r.anomalies.length === 0
      ? '<div style="color:#66bb6a;font-size:12px">異常なし ✓</div>'
      : r.anomalies.map(a=>`
<div class="qa-2b-anomaly-row">
  <span style="color:${a.severity==='FAIL'?'#ff4444':'#f0c040'};font-weight:700">${a.severity}</span>
  <span style="color:#888">異常${a.anomalyNum}</span>
  <span style="color:#aaa;font-family:monospace;font-size:10px">${esc(a.date)}</span>
  <span><span style="color:#88c0f0">${esc(a.eventId)}</span> ${esc(a.reason)}</span>
</div>`).join('');

    // 発火ログHTML（最大300件表示）
    const logSlice = r.eventLog.slice(0, 300);
    const elogHTML = logSlice.length === 0
      ? '<div style="color:#888;font-size:11px">イベントなし</div>'
      : `<div class="qa-2b-elog-row qa-2b-elog-hdr">
  <span>日付</span><span>eventId</span><span>choiceLabel</span><span>AP</span><span>種別</span><span>title</span>
</div>` + logSlice.map(e=>`
<div class="qa-2b-elog-row">
  <span style="color:#666">${esc(e.date)}</span>
  <span style="color:#88c0f0">${esc(e.eventId)}</span>
  <span>${esc(e.choiceLabel.slice(0,16))}</span>
  <span style="color:#f0c040">${e.isNoAP?'—':e.apCost}</span>
  <span style="color:${e.type==='active'?'#66bb6a':e.type==='passive'?'#888':'#ff4444'}">${e.type}</span>
  <span style="color:#777">${esc(e.title.slice(0,24))}</span>
</div>`).join('')
    + (r.eventLog.length>300?`<div style="color:#666;font-size:10px">…他 ${r.eventLog.length-300} 件（JSONコピーで全件確認）</div>`:'');

    // 安全性HTML
    const sf = r.safety;
    const safeHTML = `
<div style="margin-bottom:8px">
  <span style="font-size:11px;color:#888">G JSON 全体一致: </span>
  <span style="color:${sf.gFullMatch?'#66bb6a':'#f0c040'}">${sf.gFullMatch?'✓ 完全一致':'△ 差異あり'}</span>
  &nbsp;|&nbsp; saveGame呼出: <strong>${sf.saveCallCount}</strong>回
  &nbsp;|&nbsp; localStorage変更: <strong style="color:${sf.lsDiffs.length?'#ff4444':'#66bb6a'}">${sf.lsDiffs.length}件</strong>
  &nbsp;|&nbsp; sessionStorage変更: <strong style="color:${sf.ssDiffs.length?'#f0c040':'#66bb6a'}">${sf.ssDiffs.length}件</strong>
  &nbsp;|&nbsp; 外部送信: <strong style="color:${sf.externalSendLog.length?'#ff4444':'#66bb6a'}">${sf.externalSendLog.length}件</strong>
  &nbsp;|&nbsp; 復元失敗関数: <strong style="color:${sf.unrestoredFunctions.length?'#ff4444':'#66bb6a'}">${sf.unrestoredFunctions.length}件</strong>
</div>
${sf.compareFields.map(f=>_fieldRow(f.name, f.result, f.before, f.result!=='PASS'?f.after:undefined)).join('')}
${sf.lsDiffs.length>0?`<div style="color:#ff4444;margin-top:6px">localStorage変化キー: ${sf.lsDiffs.map(d=>esc(d.key)).join(', ')}</div>`:''}
${sf.unrestoredFunctions.length>0?`<div style="color:#ff4444;margin-top:4px">復元失敗: ${sf.unrestoredFunctions.map(esc).join(', ')}</div>`:''}`;

    // エラーHTML
    const errHTML = r.errors.length === 0
      ? '<div style="color:#66bb6a;font-size:12px">例外なし ✓</div>'
      : r.errors.map(e=>`<div style="color:#ff4444;margin-bottom:6px;font-size:11px">
  <strong>[${esc(e.step)}]</strong> ${esc(e.message)}<br>
  <span style="color:#555;font-size:10px">${esc((e.stack||'').slice(0,300))}</span>
</div>`).join('');

    const tabs = [
      {id:'stats',  label:'基本統計', html:statsHTML},
      {id:'monthly',label:'月別資金', html:monthHTML},
      {id:'anom',   label:`異常一覧(${r.anomalies.length})`, html:`<div style="font-family:monospace">${anomHTML}</div>`},
      {id:'elog',   label:`発火ログ(${r.eventLog.length})`, html:`<div class="qa-2a-log" style="max-height:360px;overflow-y:auto">${elogHTML}</div>`},
      {id:'safety', label:`安全性(${r.safetyOverall})`, html:safeHTML},
      {id:'errors', label:`エラー(${r.errors.length})`, html:errHTML},
    ];

    return `
<div style="background:#0a1525;border:1px solid #1e3a5a;border-radius:6px;padding:12px;margin-bottom:8px">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;flex-wrap:wrap">
    <span class="qa-2a-overall qa-2a-overall-${r.overall}">${r.overall}</span>
    <div>
      <div style="font-size:11px;color:#888">${esc(r.executedAt)} &nbsp; 経過 ${esc(r.elapsed)}</div>
      <div style="font-size:11px;color:#888">
        Sim: <span style="color:${r.simOverall==='PASS'?'#66bb6a':r.simOverall==='WARN'?'#f0c040':'#ff4444'}">${r.simOverall}</span>
        &nbsp;|&nbsp; Safety: <span style="color:${r.safetyOverall==='PASS'?'#66bb6a':r.safetyOverall==='WARN'?'#f0c040':'#ff4444'}">${r.safetyOverall}</span>
        &nbsp;|&nbsp; 実行日数: ${r.daysCompleted}/${r.targetDays}
        ${r.stopped?'&nbsp;<span style="color:#f0c040">（停止）</span>':''}
      </div>
    </div>
  </div>

  <div class="qa-2b-result-tabs" id="${tabId}-tabs">
    ${tabs.map((t,i)=>`<div class="qa-2b-rtab${i===0?' active':''}" onclick="
      document.querySelectorAll('#${tabId}-tabs .qa-2b-rtab').forEach(x=>x.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('#${tabId}-panels .qa-2b-rpanel').forEach(x=>x.classList.remove('active'));
      document.getElementById('${tabId}-${t.id}').classList.add('active');
    ">${esc(t.label)}</div>`).join('')}
  </div>
  <div id="${tabId}-panels">
    ${tabs.map((t,i)=>`<div class="qa-2b-rpanel${i===0?' active':''}" id="${tabId}-${t.id}" style="padding-top:8px">${t.html}</div>`).join('')}
  </div>

  <div style="margin-top:10px">
    <button class="qa-btn" onclick="window._qa2bCopyJSON()">JSON コピー（全データ）</button>
  </div>
</div>`;
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
  // ■ 6B. Phase 2C — 365日シミュレーション
  // ══════════════════════════════════════════════════════════════

  let _sim2c = null;
  let _sim2cRunning = false;

  // ─── ユーティリティ ───
  function _sim2cTotalDays(g) {
    return ((g.year||1)-1)*360 + ((g.month||1)-1)*30 + ((g.day||1)-1);
  }

  function _sim2cOccupied() {
    try { return eval('occupiedRooms()'); } catch(e) { return 0; }
  }
  function _sim2cTotalRooms() {
    try { return eval('totalRooms()'); } catch(e) { return 0; }
  }
  function _sim2cStoreRevenue() {
    try { return G.monthRevenue || 0; } catch(e) { return 0; }
  }
  function _sim2cStoreExpense() {
    try { return G.monthExpense || 0; } catch(e) { return 0; }
  }

  // ─── 月別スナップショット取得 ───
  function _sim2cMonthSnap(prevDate) {
    const occupied = _sim2cOccupied();
    const total    = _sim2cTotalRooms();
    return {
      year:     prevDate.year,
      month:    prevDate.month,
      money:    G.money,
      rep:      (G.regions&&G.regions[0]) ? (G.regions[0].reputation||0) : 0,
      credit:   G.creditScore||0,
      fatigue:  G.fatigue||0,
      staffCount: (G.staff||[]).length,
      occupied, total,
      storeRevenue: _sim2cStoreRevenue(),
      storeExpense: _sim2cStoreExpense(),
    };
  }

  // ─── 新規異常チェック（Phase 2C 専用）───
  function _sim2cCheckExtra(s, prevDate) {
    const add = (num, sev, title, reason) => {
      s.anomalies.push({ anomalyNum:num, severity:sev,
        date:`${G.year}年${G.month}月${G.day}日`, eventId:'(sim2c)', title, reason,
        gState:{ap:G.ap,money:G.money,year:G.year,month:G.month,day:G.day} });
    };

    // C01: 第一章クリア日通過後 gameEnded が立っていない
    const td = _sim2cTotalDays(G);
    if (G.year===1 && G.month===3 && G.day===30 && !G.gameEnded && !G.freeMode) {
      add('C01','FAIL','第一章クリア日通過で gameEnded が未設定','1年3月30日を通過したが gameEnded=false のまま');
    }

    // C02: 月次売上が6か月以上連続増加（P3）
    const mdata = s.monthlyData;
    if (mdata.length >= 6) {
      const last6 = mdata.slice(-6);
      if (last6.every((m,i) => i===0 || m.storeRevenue > last6[i-1].storeRevenue)) {
        if (!s._c02warned) { s._c02warned = true; add('C02','P3','月次売上6か月連続増加','自動プレイ過最適化の可能性。P3:バランス注意'); }
      }
    }

    // C03: 月次利益が6か月以上連続増加（P3）
    if (mdata.length >= 6) {
      const last6 = mdata.slice(-6);
      if (last6.every((m,i) => i===0 || m.netChange > last6[i-1].netChange)) {
        if (!s._c03warned) { s._c03warned = true; add('C03','P3','月次利益6か月連続増加','自動プレイ過最適化の可能性。P3:バランス注意'); }
      }
    }
  }

  // ─── イベント発火時の Phase 2C 用追記チェック ───
  function _sim2cEventCheck(s, ev, chosenIdx) {
    if (!ev) return;
    const add = (num, sev, title, reason) => s.anomalies.push({
      anomalyNum:num, severity:sev,
      date:`${G.year}年${G.month}月${G.day}日`, eventId:ev.id||'(unknown)', title, reason,
      gState:{ap:G.ap,money:G.money,year:G.year,month:G.month,day:G.day}
    });

    // C05 (C04 はシム共通の異常7で検知済みのため省略)
    const evId = ev.id||'';
    // C05: 商品解放イベントが30日以内に連続
    if ((ev.category==='product'||ev.category==='menu'||(ev.id||'').startsWith('unlock_')) && chosenIdx!==null) {
      const now = _sim2cTotalDays(G);
      if (s.lastProductUnlockDay !== null && now - s.lastProductUnlockDay < 30) {
        add('C05','WARN','商品解放が30日以内に連続','前回解放から'+(now-s.lastProductUnlockDay)+'日: '+evId);
      }
      s.lastProductUnlockDay = now;
    }

    // C06: 同一キャラのイベントが7日以内に3件以上（シーケンスグループは除外）
    const sender = ev.sender || (ev.id||'').split('_')[0];
    if (sender) {
      const now = _sim2cTotalDays(G);
      const seqInfo = _QA_SEQ_ID_MAP[evId];

      // ── シーケンスグループ内チェック ──
      if (seqInfo) {
        if (!s._seqState) s._seqState = {};
        if (!s._seqState[seqInfo.grp]) s._seqState[seqInfo.grp] = { seen: [], days: [] };
        const sg = s._seqState[seqInfo.grp];
        const expectedPos = sg.seen.length;
        const expectedId  = QA_SEQUENCE_GROUPS[seqInfo.grp][expectedPos];

        // 同一 eventId 重複（グループ内で同じイベントが2回）
        if (sg.seen.includes(evId)) {
          add('C06','P1','シーケンスイベント同一ID重複',`grp=${seqInfo.grp} id=${evId} 既発生済み`);
        }
        // 順序違反（期待と異なる順に発生）
        else if (evId !== expectedId) {
          add('C06','P1','シーケンスイベント順序違反',`grp=${seqInfo.grp} expected=${expectedId} actual=${evId}`);
          sg.seen.push(evId); sg.days.push(now);
        }
        // 正常シーケンス
        else {
          sg.seen.push(evId); sg.days.push(now);

          // 想定外の4件目（グループ完了後にまた同グループのIDが来た場合は重複チェックで捕捉）

          // 同日2件以上チェック（グループ内）
          const todayCount = sg.days.filter(d => d === now).length;
          if (todayCount >= 2) {
            add('C06','P2','シーケンスイベント同日重複',`grp=${seqInfo.grp} id=${evId} ${now}日に${todayCount}件目`);
          }

          // AP過剰チェック（グループ全体のAP合計）
          if (sg.seen.length === seqInfo.total) {
            const grpIds = QA_SEQUENCE_GROUPS[seqInfo.grp];
            const allCases = [...(typeof DOMAIN_CASES!=='undefined'?DOMAIN_CASES:[]),...CASE_POOL];
            const totalAP = grpIds.reduce((sum, id) => {
              const c = allCases.find(x=>x.id===id);
              return sum + (c?.apCost||0);
            }, 0);
            if (totalAP > 30) {
              add('C06','P2','シーケンス合計AP過剰',`grp=${seqInfo.grp} 合計AP=${totalAP}`);
            }
          }
        }
      }
      // ── 通常キャラ密集チェック（非シーケンス） ──
      else {
        if (!s.charEventDays[sender]) s.charEventDays[sender] = [];
        s.charEventDays[sender].push({ day: now, id: evId });
        const recent = s.charEventDays[sender].filter(e => now - e.day <= 7);
        s.charEventDays[sender] = recent;

        // 同日2件以上
        const todayIds = recent.filter(e => e.day === now).map(e => e.id);
        if (todayIds.length >= 2 && !s._charSameDayWarn?.[sender+now]) {
          if (!s._charSameDayWarn) s._charSameDayWarn = {};
          s._charSameDayWarn[sender+now] = true;
          add('C06','P2','同一sender同日2件以上',`sender=${sender} ${todayIds.join(', ')}`);
        }

        // 同一 eventId 重複（7日以内）
        const dupId = recent.filter(e => e.id === evId);
        if (dupId.length >= 2) {
          add('C06','P1','同一イベントID短期重複',`sender=${sender} id=${evId} 7日以内${dupId.length}件`);
        }

        // 7日以内3件以上（P3 集中注意）
        if (recent.length >= 3 && !s._charWarn?.[sender]) {
          if (!s._charWarn) s._charWarn = {};
          s._charWarn[sender] = true;
          add('C06','P3','同一sender7日以内3件以上',`sender=${sender} ${recent.length}件 / 7日`);
        }
      }
    }
  }

  // ─── Phase 2C 用 autoResolve ───
  // _sim2b を _sim2c に向けて _sim2bAutoResolve を呼ぶ。Phase 2C 固有チェックを追加。
  function _sim2cAutoResolve() {
    const ev = G.activeEvent;
    if (!ev || !_sim2c) return;

    // Phase 2C 固有チェック（chosenIdx のプレビュー）
    const previewIdx = _balancedChoiceIdx(ev);
    _sim2cEventCheck(_sim2c, ev, previewIdx);

    // キャラクター進行ログ
    const sender = ev.sender || (ev.id||'').split('_')[0];
    if (sender && ['midori','narita','takahashi','yamada'].some(c => sender.includes(c))) {
      _sim2c.charLog.push({
        date:`${G.year}年${G.month}月${G.day}日`,
        char: sender, eventId: ev.id||'(unknown)', title: ev.title||'',
        choiceIdx: previewIdx??-1,
      });
    }

    // _sim2b を _sim2c に向けて共通ロジックを実行（stats/eventLog は _sim2c に蓄積）
    _sim2b = _sim2c;
    _sim2bAutoResolve();
    _sim2b = null;

    // 月内案件カウント（daily_case 源）
    if (_sim2bCurrentSource === 'daily_case') _sim2c._monthCaseCount++;
  }

  // ─── Phase 2C チャンク実行 ───
  function _sim2cDoChunk(chunkSize) {
    const s = _sim2c;
    const end = Math.min(s.daysRun + chunkSize, s.targetDays);

    while (s.daysRun < end && !s.stopRequested) {
      const prevTotal = _sim2cTotalDays(G);
      const prevDate  = { year:G.year, month:G.month, day:G.day };

      // ウォッチドッグ：同じtotalDaysが3回連続したらフリーズ検知
      if (!s._wdLastTotal) s._wdLastTotal = -1;
      if (!s._wdRepeatCount) s._wdRepeatCount = 0;
      if (prevTotal === s._wdLastTotal) {
        s._wdRepeatCount++;
        if (s._wdRepeatCount >= 3) {
          const modal = document.getElementById('event-modal');
          s.errors.push({
            step: `watchdog freeze at ${prevDate.year}年${prevDate.month}月${prevDate.day}日`,
            message: `同一totalDays(${prevTotal})が3回連続 → 無限ループ検知`,
            gState: {
              processingMonthly: G.processingMonthly, isAdvancingDay: G.isAdvancingDay,
              activeEvent: G.activeEvent && (G.activeEvent.id || G.activeEvent),
              _pendingChallenge: G._pendingChallenge,
              modalVisible: modal ? modal.style.display !== 'none' : false,
            }
          });
          s.stopRequested = true;
          break;
        }
      } else {
        s._wdLastTotal = prevTotal;
        s._wdRepeatCount = 0;
      }
      let _chunkStepOk = false;
      try {

      G.isAdvancingDay  = false;
      G.processingMonthly = false;
      G.activeEvent     = null;
      const modal = document.getElementById('event-modal');
      if (modal) modal.style.display = 'none';
      if (G.money < 0) G.money = 0;

      // _sim2b を _sim2c に向けておく（_sim2bProcessDailyCases / _sim2bAutoResolve が参照）
      _sim2b = s;

      // 日次案件処理（Phase 2B と共通）
      _sim2bProcessDailyCases(prevTotal);
      G.activeEvent = null;

      // 月末売上/経費を advanceDay 前にキャプチャ（月初リセット前の最終値）
      s._lastDayRevenue = _sim2cStoreRevenue();
      s._lastDayExpense = _sim2cStoreExpense();

      // AP 不足日数カウント
      if (G.ap <= 0) s.stats.apShortageDays++;

      try {
        eval('advanceDay()');
      } catch(e) {
        s.errors.push({ step:`advanceDay(day${s.daysRun+1})`, message:e.message, stack:e.stack||'' });
      }

      // チャンク終了後に _sim2b をリセット
      _sim2b = null;

      if (G.processingMonthly||G.isAdvancingDay) {
        G.processingMonthly=false; G.isAdvancingDay=false; G.activeEvent=null;
      }

      const afterTotal = _sim2cTotalDays(G);
      const dayDiff    = afterTotal - prevTotal;
      s.apHistory.push(isNaN(G.ap) ? null : G.ap);

      // NaN チェック
      const nans = ['ap','money','fatigue'].filter(f=>isNaN(G[f]));
      if (nans.length) {
        s.anomalies.push({ anomalyNum:8, severity:'FAIL',
          date:`${G.year}年${G.month}月${G.day}日`, eventId:'(day tick)', title:'日送り後NaN',
          reason:`NaN: ${nans.join(', ')}`, gState:{ap:G.ap,money:G.money,fatigue:G.fatigue} });
      }

      // 日付進行チェック
      if (dayDiff !== 1) {
        s.anomalies.push({ anomalyNum:9, severity:dayDiff===0?'FAIL':'WARN',
          date:`${prevDate.year}年${prevDate.month}月${prevDate.day}日`,
          eventId:'(day tick)', title:'日付進行異常',
          reason:`${dayDiff}日進んだ（期待値:1）`, gState:{ap:G.ap,money:G.money} });
      }

      // 現金危機チェック
      if (G.money < 50000) s.stats.cashCrisisCount++;

      // 月境界
      if (G.month !== prevDate.month || G.year !== prevDate.year) {
        const snap = _sim2cMonthSnap(prevDate);
        snap.storeRevenue = s._lastDayRevenue || snap.storeRevenue;
        snap.storeExpense = s._lastDayExpense || snap.storeExpense;
        snap.storeProfit  = snap.storeRevenue - snap.storeExpense;
        const prevSnap = s.monthlyData[s.monthlyData.length-1];
        snap.netChange   = snap.money - (prevSnap ? prevSnap.money : s.startState.money);
        snap.apAvg       = (() => { const v=s.apHistory.filter(x=>x!=null); return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null; })();
        snap.apMin       = (() => { const v=s.apHistory.filter(x=>x!=null); return v.length?Math.min(...v):null; })();
        // 月内案件統計
        snap.casesProcessed = s._monthCaseCount||0;
        snap.casesPassed    = s._monthPassCount||0;
        s._monthCaseCount = 0; s._monthPassCount = 0;
        s.monthlyData.push(snap);
        s.monthStart = { money:G.money, month:G.month, year:G.year };
        s.stats.monthsCompleted++;

        // 赤字チェック
        if (snap.netChange < 0) s.stats.redMonths++;

        // 月次追加チェック
        _sim2cCheckExtra(s, prevDate);
      }

      _chunkStepOk = true;
      s.daysRun++;
      s.currentDate = { year:G.year, month:G.month, day:G.day };
      } catch(e) {
        s.errors.push({ step:`chunk day${s.daysRun+1} (${prevDate.year}年${prevDate.month}月${prevDate.day}日)`, message:e.message, stack:e.stack||'' });
        // 状態リセットして継続
        try { G.isAdvancingDay=false; G.processingMonthly=false; G.activeEvent=null; } catch(e2){}
        if (!_chunkStepOk) s.daysRun++;
      }
    }
  }

  // ─── プログレス更新 ───
  function _sim2cUpdateProgress() {
    const s = _sim2c;
    if (!s) return;
    const pct = Math.round(s.daysRun / s.targetDays * 100);
    const elapsed = ((Date.now()-s.startTime)/1000).toFixed(1);
    const bar  = document.getElementById('qa-2c-progress-bar');
    const info = document.getElementById('qa-2c-progress-info');
    const elEl = document.getElementById('qa-2c-elapsed');
    if (bar)  bar.style.width  = pct + '%';
    if (info) info.textContent = `${s.daysRun} / ${s.targetDays} 日（${pct}%）`;
    if (elEl) elEl.textContent = `経過 ${elapsed}s`;
  }

  // ─── スケジューラ ───
  function _sim2cScheduleNext() {
    const s = _sim2c;
    if (!s) return;
    if (s.daysRun >= s.targetDays || s.stopRequested) {
      _sim2cFinish();
      return;
    }
    setTimeout(() => {
      _sim2cDoChunk(10);
      _sim2cUpdateProgress();
      _sim2cScheduleNext();
    }, 0);
  }

  // ─── 復元・結果集計 ───
  function _sim2cFinish() {
    const s = _sim2c;
    if (!s) return;

    // DOM 更新系関数を復元
    if (s._restoreRender) { try { s._restoreRender(); } catch(e) {} }

    // シム終了時点の状態記録（復元前）
    const simEndState = {
      year:G.year, month:G.month, day:G.day,
      money:G.money, ap:G.ap, fatigue:G.fatigue,
      casesLength:(G.cases||[]).length,
    };

    // 最終月記録
    {
      const last = s.monthlyData[s.monthlyData.length-1];
      const alreadyRecorded = last && last.year===s.monthStart.year && last.month===s.monthStart.month;
      if (!alreadyRecorded) {
        const snap = _sim2cMonthSnap({ year:s.monthStart.year, month:s.monthStart.month });
        snap.netChange = snap.money - (s.monthlyData.length ? s.monthlyData[s.monthlyData.length-1].money : s.startState.money);
        const apV = s.apHistory.filter(x=>x!=null);
        snap.apAvg = apV.length ? Math.round(apV.reduce((a,b)=>a+b,0)/apV.length) : null;
        snap.apMin = apV.length ? Math.min(...apV) : null;
        snap.casesProcessed = s._monthCaseCount||0;
        snap.casesPassed    = s._monthPassCount||0;
        if (snap.netChange < 0) s.stats.redMonths++;
        s.monthlyData.push(snap);
      }
    }

    // 未解決ケーススナップショット（Phase 2B の共通関数を再利用）
    const todayTotal = _sim2cTotalDays(G);
    const midoriHired = !!(G.characters?.midori?.met) ||
      (Array.isArray(G.staff) && G.staff.some(x=>x.id==='midori'||x.name==='みどり'));
    const simEndCases = (G.cases||[]).map(c => {
      if (c.resolved) return { eventId:c.id||'(unknown)', title:c.title||'', resolved:true, expired:false, conditionOnly:!!c.conditionOnly, status:'resolved', unresolvedReason:'resolved済み' };
      if (c.expired)  return { eventId:c.id||'(unknown)', title:c.title||'', resolved:false, expired:true,  conditionOnly:!!c.conditionOnly, status:'expired',  unresolvedReason:'expired' };
      const blocks = [];
      if (c.requireStaff && !midoriHired)       blocks.push('スタッフ待ち');
      if (c.requireProduct && !(G.products||{})[c.requireProduct]) blocks.push(`商品待ち(${c.requireProduct})`);
      if (c.minRep   && (G.rep||0)   < c.minRep)   blocks.push(`評判待ち(${G.rep??0}<${c.minRep})`);
      if (c.minDay   && todayTotal    < c.minDay)   blocks.push(`将来日待ち(${todayTotal}<${c.minDay})`);
      if (c.minMonth && (G.month||1) < c.minMonth) blocks.push(`将来月待ち(${G.month}<${c.minMonth})`);
      const status = blocks.length ? '条件待ち' : '処理待ち';
      return { eventId:c.id||'(unknown)', title:c.title||'', resolved:false, expired:false, conditionOnly:!!c.conditionOnly, status, unresolvedReason: blocks.length ? blocks.join(' / ') : '条件充足済みだが未処理（日次上限）' };
    });

    // 全条件チェック
    // 月次処理期待回数：開始月と終了月（G復元前のsimEndState）の差
    const _c00StartIdx = (s.startState.year-1)*12 + (s.startState.month-1);
    const _c00EndIdx   = (simEndState.year-1)*12 + (simEndState.month-1);
    const _expectedTicks = _c00EndIdx - _c00StartIdx;
    if (s.stats.monthsCompleted !== _expectedTicks) {
      s.anomalies.push({
        anomalyNum:'C00', severity:'FAIL',
        date:`${G.year}年${G.month}月${G.day}日`, eventId:'(finish)', title:'月次処理回数異常',
        reason:`月次処理 ${s.stats.monthsCompleted}回（期待:${_expectedTicks}、開始:${s.startState.year}年${s.startState.month}月${s.startState.day}日→終了:${G.year}年${G.month}月${G.day}日）`,
        gState:{}
      });
    }

    // G 復元
    try {
      const gBefore = JSON.parse(s.gBeforeStr);
      const gActual = eval('G');
      Object.assign(gActual, gBefore);
      // autoTesting は JSON では undefined になり Object.assign で残留するため明示リセット
      if (!gBefore.hasOwnProperty('autoTesting')) delete gActual.autoTesting;
      else gActual.autoTesting = gBefore.autoTesting;
      // freeMode もシム中に変更した可能性があるため同様に処理
      if (!gBefore.hasOwnProperty('freeMode')) delete gActual.freeMode;
      else gActual.freeMode = gBefore.freeMode;
    } catch(e) {
      s.errors.push({ step:'G restore', message:e.message, stack:'' });
    }

    // スパイ解除
    window.saveGame           = s.origSaveGame;
    window._autoResolveEvent  = s.origAutoResolve;
    window.showMainStoryEnding = s.origShowEnding;
    window.showMainStoryClear  = s.origShowClear;
    window.fetch              = s.origFetch;
    XMLHttpRequest.prototype.send = s.origXHRSend;
    XMLHttpRequest.prototype.open = s.origXHROpen;

    // 安全性チェック
    const lsAfter  = (() => { const snap={}; try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&!k.startsWith('_qa'))snap[k]=localStorage.getItem(k);}}catch(e){}return snap; })();
    const lsDiffs  = Object.keys({...s.lsBefore,...lsAfter}).filter(k=>k!==s.saveKey&&!k.startsWith('_qa')&&s.lsBefore[k]!==lsAfter[k]).map(k=>({key:k}));
    const gAfter   = eval('G');
    const gBefore2 = JSON.parse(s.gBeforeStr);
    const gFullMatch = JSON.stringify(gBefore2)===JSON.stringify(gAfter);
    const safetyFields = [
      {name:'year',get:g=>g.year},{name:'month',get:g=>g.month},{name:'day',get:g=>g.day},
      {name:'money',get:g=>g.money},{name:'ap',get:g=>g.ap},{name:'fatigue',get:g=>g.fatigue},
      {name:'cases.length',get:g=>(g.cases||[]).length},
      {name:'autoTesting',get:g=>g.autoTesting},{name:'gameEnded',get:g=>g.gameEnded},
    ];
    const compareFields = safetyFields.map(f=>{
      let before,after,result;
      try{before=f.get(gBefore2);after=f.get(gAfter);result=JSON.stringify(before)===JSON.stringify(after)?'PASS':'FAIL';}
      catch(e2){before='(err)';after='(err)';result='WARN';}
      return {name:f.name,before,after,result};
    });
    const safetyFail    = compareFields.some(f=>f.result==='FAIL') || lsDiffs.length>0 || s.externalSendLog.length>0;
    const safetyOverall = safetyFail?'FAIL': compareFields.some(f=>f.result==='WARN')?'WARN':'PASS';

    const failA = s.anomalies.filter(a=>a.severity==='FAIL');
    const warnA = s.anomalies.filter(a=>a.severity==='WARN'||a.severity==='P3');
    const simOverall = s.errors.length>0||failA.length>0?'FAIL': warnA.length>0?'WARN':'PASS';
    const overall = (simOverall==='FAIL'||safetyOverall==='FAIL')?'FAIL': (simOverall==='WARN'||safetyOverall==='WARN')?'WARN':'PASS';

    // 年間統計算出
    const apValid  = s.apHistory.filter(x=>x!=null);
    const moneyArr = s.monthlyData.map(m=>m.money);
    const revArr   = s.monthlyData.map(m=>m.storeRevenue||0);
    const netArr   = s.monthlyData.map(m=>m.netChange||0);
    const maxRevMonth = revArr.indexOf(Math.max(...revArr));
    const minRevMonth = revArr.indexOf(Math.min(...revArr));
    const allBlack = s.monthlyData.every(m=>(m.netChange||0)>=0);
    const allRed   = s.monthlyData.every(m=>(m.netChange||0)<0);
    if (allBlack && s.monthlyData.length===12) s.anomalies.push({ anomalyNum:'C10',severity:'P3',date:'(年間)',eventId:'(finish)',title:'12か月すべて黒字',reason:'P3:バランス注意',gState:{} });
    if (allRed   && s.monthlyData.length===12) s.anomalies.push({ anomalyNum:'C11',severity:'P3',date:'(年間)',eventId:'(finish)',title:'12か月すべて赤字',reason:'P3:バランス注意',gState:{} });

    const annualStats = {
      totalEvents:      s.stats.totalEvents,
      totalRevenue:     revArr.reduce((a,b)=>a+b,0),
      totalNetChange:   netArr.reduce((a,b)=>a+b,0),
      redMonths:        s.stats.redMonths,
      maxRevMonth:      s.monthlyData[maxRevMonth] ? `${s.monthlyData[maxRevMonth].year}年${s.monthlyData[maxRevMonth].month}月` : '-',
      minRevMonth:      s.monthlyData[minRevMonth] ? `${s.monthlyData[minRevMonth].year}年${s.monthlyData[minRevMonth].month}月` : '-',
      maxCash:          moneyArr.length ? Math.max(...moneyArr) : 0,
      minCash:          moneyArr.length ? Math.min(...moneyArr) : 0,
      cashCrisisCount:  s.stats.cashCrisisCount,
      apShortageDays:   s.stats.apShortageDays,
      unresolvable:     s.stats.unresolvable||0,
      noAPFallback:     s.stats.declined||0,
      followUps:        s.stats.followUps||0,
      caseResolved:     s.stats.caseResolved||0,
      monthsCompleted:  s.stats.monthsCompleted,
      chapter1ClearDate: s.chapter1ClearLog.length ? s.chapter1ClearLog[0].date : null,
      chapter1ClearCount: s.chapter1ClearLog.length,
      productsUnlocked: s.stats.productsUnlocked||0,
    };

    // 月次期待回数（simEndStateはG復元前の値）
    const _smi = (s.startState.year-1)*12 + (s.startState.month-1);
    const _emi = (simEndState.year-1)*12 + (simEndState.month-1);
    const _expectedMonthlyTicks = _emi - _smi;

    const result = {
      executedAt: new Date().toLocaleString('ja-JP',{hour12:false}),
      elapsed:    ((Date.now()-s.startTime)/1000).toFixed(1)+'s',
      overall, simOverall, safetyOverall,
      stopped:    s.stopRequested,
      daysCompleted: s.daysRun, targetDays: s.targetDays,
      expectedMonthlyTicks: _expectedMonthlyTicks,
      startState: s.startState,
      endDateSimulated: simEndState,
      annualStats,
      monthlyData:  s.monthlyData,
      anomalies:    s.anomalies,
      eventLog:     s.eventLog,
      charLog:      s.charLog,
      chapter1ClearLog: s.chapter1ClearLog,
      endCasesSnapshot: simEndCases,
      caseSkipLog:  s.caseSkipLog||[],
      safety: { gFullMatch, compareFields, lsDiffs, saveCallCount:s.saveCallCount, externalSendLog:s.externalSendLog },
    };

    window._qa2cLastResult = result;
    _sim2cRunning = false;
    _sim2c = null;

    // 結果表示
    const resultEl = document.getElementById('qa-2c-result');
    if (resultEl) resultEl.innerHTML = renderPhase2CResult(result);

    // ボタン更新
    const simPanel = document.getElementById('qa-panel-sim');
    if (simPanel) { delete simPanel.dataset.rendered; document.querySelector('.qa-tab[data-tab="sim"]')?.click(); }
  }

  // ─── エントリポイント ───
  function runPhase2C365() {
    if (_sim2cRunning || _sim2bRunning || _qa2aRunning) return;

    try {
      const testG = eval('G');
      testG._qaTestWrite = true;
      if (!eval('G')._qaTestWrite) { alert('G代入テスト失敗。中止します。'); return; }
      delete eval('G')._qaTestWrite;
    } catch(e) { alert('G代入テスト例外: '+e.message); return; }

    _sim2cRunning = true;

    const currentG  = eval('G');
    const gBeforeStr = JSON.stringify(currentG);
    const captureLS = () => { const snap={}; try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&!k.startsWith('_qa'))snap[k]=localStorage.getItem(k);}}catch(e){}return snap; };
    const lsBefore  = captureLS();
    const saveKey   = (typeof getSaveKey==='function') ? getSaveKey() : null;

    _sim2c = {
      targetDays:   365,
      daysRun:      0,
      stopRequested:false,
      startTime:    Date.now(),
      gBeforeStr, lsBefore, saveKey,
      origSaveGame:     window.saveGame,
      origAutoResolve:  window._autoResolveEvent,
      origShowEnding:   window.showMainStoryEnding,
      origShowClear:    window.showMainStoryClear,
      origFetch:        window.fetch,
      origXHRSend:      XMLHttpRequest.prototype.send,
      origXHROpen:      XMLHttpRequest.prototype.open,
      startState: {
        year:currentG.year, month:currentG.month, day:currentG.day,
        money:currentG.money, ap:currentG.ap, fatigue:currentG.fatigue,
        casesLength:(currentG.cases||[]).length,
      },
      currentDate:  {year:currentG.year,month:currentG.month,day:currentG.day},
      monthStart:   {money:currentG.money,month:currentG.month,year:currentG.year},
      monthlyData:  [],
      apHistory:    [],
      eventLog:     [],
      charLog:      [],
      chapter1ClearLog: [],
      caseSkipLog:  [],
      anomalies:    [],
      seenYearlyEvents: {},
      charEventDays:{},
      lastProductUnlockDay: null,
      oncePerYearSeen:{},
      stats:{
        totalEvents:0, resolved:0, declined:0, followUps:0,
        caseResolved:0, caseSkipped:0, unresolvable:0,
        apShortageDays:0, cashCrisisCount:0, redMonths:0,
        monthsCompleted:0, productsUnlocked:0,
      },
      _monthCaseCount:0, _monthPassCount:0,
      saveCallCount:0,
      externalSendLog:[],
      errors:[],
    };

    // スパイ設置
    window.saveGame = () => { _sim2c && _sim2c.saveCallCount++; };
    window._autoResolveEvent = _sim2cAutoResolve;

    // 第一章クリアスパイ
    window.showMainStoryEnding = (...args) => {
      if (_sim2c) {
        _sim2c.chapter1ClearLog.push({
          date:`${G.year}年${G.month}月${G.day}日`,
          fn:'showMainStoryEnding', args:JSON.stringify(args),
          gameEnded:G.gameEnded,
        });
        // gameEnded がセットされてゲームが止まるのを防ぐためフリーモードで継続
        G.freeMode = true;
      }
    };
    window.showMainStoryClear = (...args) => {
      if (_sim2c) {
        _sim2c.chapter1ClearLog.push({
          date:`${G.year}年${G.month}月${G.day}日`,
          fn:'showMainStoryClear', args:JSON.stringify(args),
          gameEnded:G.gameEnded,
        });
        G.freeMode = true;
      }
    };

    // 外部通信遮断
    window.fetch = () => Promise.reject(new Error('[QA] fetch blocked'));
    XMLHttpRequest.prototype.open = function(m, url) {
      _sim2c && _sim2c.externalSendLog.push({ method:m, url });
    };
    XMLHttpRequest.prototype.send = function() {};

    // 自動テストモード有効化（eval('G') = 実際のゲームオブジェクト）
    eval('G').autoTesting = true;

    // DOM 更新系関数をスパイで無効化（シム中は不要、速度向上）
    const _origRenderTab    = window.renderTab;
    const _origUpdateHeader = window.updateHeader;
    const _origNotify       = window.notify;
    const _origAddNews      = window.addNews;
    window.renderTab    = function() {};
    window.updateHeader = function() {};
    window.notify       = function() {};
    window.addNews      = function() {};
    _sim2c._restoreRender = () => {
      window.renderTab    = _origRenderTab;
      window.updateHeader = _origUpdateHeader;
      window.notify       = _origNotify;
      window.addNews      = _origAddNews;
    };

    _sim2cScheduleNext();
  }

  // ─── Phase 2C 結果レンダリング ───
  function renderPhase2CResult(r) {
    if (!r) return '';
    const ov  = r.overall;
    const ovColor = ov==='PASS'?'#66bb6a':ov==='WARN'?'#f0c040':'#ff5252';
    const st  = r.annualStats || {};
    const ec  = r.endDateSimulated || {};
    const apV = r.monthlyData?.map(m=>m.apMin).filter(x=>x!=null) || [];
    const minAP = apV.length ? Math.min(...apV) : '-';

    const tabs = ['総合','異常','月別推移','AP分析','売上分析','イベント','キャラクター','商品・メニュー','未解決案件','JSON'];
    const tid = 'qa2c_' + Math.random().toString(36).slice(2);

    const tabHdr = tabs.map((t,i) =>
      `<button class="qa-2c-tab" data-ti="${tid}" data-idx="${i}" onclick="qa2cSwitchTab('${tid}',${i})"
        style="background:${i===0?'#333':'#1a1a1a'};color:#ccc;border:1px solid #444;padding:4px 10px;cursor:pointer;font-size:11px;border-radius:4px">${t}</button>`
    ).join('');

    // ── タブ0: 総合 ──
    const tab0 = `
<div style="font-size:28px;font-weight:700;color:${ovColor};margin-bottom:4px">${ov}</div>
<div style="font-size:11px;color:#888;margin-bottom:12px">${r.executedAt} &nbsp; 経過 ${r.elapsed} &nbsp; ${r.stopped?'⚠ 途中停止':'完走'}</div>
<div style="font-size:11px;color:#aaa;margin-bottom:8px">Sim: <b style="color:${r.simOverall==='PASS'?'#66bb6a':r.simOverall==='WARN'?'#f0c040':'#ff5252'}">${r.simOverall}</b> &nbsp;|&nbsp; Safety: <b style="color:${r.safetyOverall==='PASS'?'#66bb6a':'#ff5252'}">${r.safetyOverall}</b> &nbsp;|&nbsp; 実行日数: ${r.daysCompleted}/${r.targetDays}</div>
<div style="font-size:11px;color:#e8a0bf;margin-bottom:12px">
  ⚠ 第一章クリア画面はスパイ化して継続。showMainStoryEnding呼出回数: <b>${r.chapter1ClearLog?.length||0}</b>
  ${r.chapter1ClearLog?.length ? ' / 初回: '+r.chapter1ClearLog[0].date : ''}
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;margin-bottom:10px">
  <div class="qa-2b-stat-card"><div class="lbl">総イベント発火</div><div class="val">${r.annualStats?.totalEvents??0}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">月次処理回数</div><div class="val" style="color:${st.monthsCompleted===r.expectedMonthlyTicks?'#66bb6a':'#ff5252'}">${st.monthsCompleted}/${r.expectedMonthlyTicks??'?'}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">案件処理数</div><div class="val" style="color:#66bb6a">${st.caseResolved}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">赤字月数</div><div class="val" style="color:${st.redMonths>6?'#ff5252':st.redMonths>3?'#f0c040':'#888'}">${st.redMonths}/12</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">現金危機日数</div><div class="val" style="color:${st.cashCrisisCount>0?'#ff5252':'#888'}">${st.cashCrisisCount}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">AP不足日数</div><div class="val" style="color:${st.apShortageDays>10?'#ff5252':st.apShortageDays>0?'#f0c040':'#66bb6a'}">${st.apShortageDays}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">異常件数 (FAIL/WARN/P3)</div><div class="val" style="color:${r.anomalies?.filter(a=>a.severity==='FAIL').length>0?'#ff5252':'#888'}">${r.anomalies?.filter(a=>a.severity==='FAIL').length||0} / ${r.anomalies?.filter(a=>a.severity==='WARN').length||0} / ${r.anomalies?.filter(a=>a.severity==='P3').length||0}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">最低AP（月別最小）</div><div class="val">${minAP}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">総売上（シム）</div><div class="val" style="font-size:12px">¥${(st.totalRevenue||0).toLocaleString()}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">純現金変動</div><div class="val" style="font-size:12px;color:${(st.totalNetChange||0)>=0?'#66bb6a':'#ff5252'}">¥${(st.totalNetChange||0).toLocaleString()}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">第一章クリア呼出</div><div class="val" style="color:${st.chapter1ClearCount>0?'#66bb6a':'#ff5252'}">${st.chapter1ClearCount>0?'✅ '+st.chapter1ClearDate:'未呼出'}</div></div>
  <div class="qa-2b-stat-card"><div class="lbl">エラー</div><div class="val" style="color:${r.errors?.length?'#ff5252':'#888'}">${r.errors?.length||0}</div></div>
</div>`;

    // ── タブ1: 異常一覧 ──
    const aRows = (r.anomalies||[]).map(a => {
      const c = a.severity==='FAIL'?'#ff5252':a.severity==='WARN'?'#f0c040':'#aaa';
      return `<tr><td style="color:${c};font-weight:700">${a.severity}</td><td>${a.date}</td><td style="font-size:10px">${a.eventId||''}</td><td>${a.title||''}</td><td style="font-size:10px">${a.reason||''}</td></tr>`;
    }).join('') || '<tr><td colspan="5" style="color:#555;text-align:center">異常なし</td></tr>';
    const tab1 = `<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">
<tr style="color:#888"><th style="text-align:left;padding:3px 6px">重大度</th><th>日付</th><th>eventId</th><th>タイトル</th><th>理由</th></tr>${aRows}</table></div>`;

    // ── タブ2: 月別推移 ──
    const mRows = (r.monthlyData||[]).map(m => {
      const occ = m.total ? Math.round(m.occupied/m.total*100)+'%' : '-';
      return `<tr>
<td>${m.year}年${m.month}月</td>
<td style="text-align:right">¥${(m.money||0).toLocaleString()}</td>
<td style="text-align:right;color:${(m.netChange||0)>=0?'#66bb6a':'#ff5252'}">¥${(m.netChange||0).toLocaleString()}</td>
<td style="text-align:right">¥${(m.storeRevenue||0).toLocaleString()}</td>
<td style="text-align:right">${m.apAvg??'-'}</td>
<td style="text-align:right">${m.apMin??'-'}</td>
<td style="text-align:right">${m.fatigue??'-'}</td>
<td style="text-align:right">${m.rep??'-'}</td>
<td style="text-align:right">${occ}</td>
<td style="text-align:right">${m.staffCount??0}</td>
<td style="text-align:right">${m.casesProcessed??0}</td>
</tr>`;
    }).join('');
    const tab2 = `<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse;white-space:nowrap">
<tr style="color:#888;position:sticky;top:0;background:#1e1e1e"><th style="text-align:left;padding:3px 6px">月</th><th>現金</th><th>月次損益</th><th>売上</th><th>AP平均</th><th>AP最低</th><th>疲労</th><th>評判</th><th>入居率</th><th>スタッフ</th><th>案件処理</th></tr>${mRows}</table></div>`;

    // ── タブ3: AP分析 ──
    const apRows = (r.monthlyData||[]).map(m =>
      `<tr><td>${m.year}年${m.month}月</td><td style="text-align:right">${m.apAvg??'-'}</td><td style="text-align:right;color:${(m.apMin??99)<20?'#ff5252':(m.apMin??99)<40?'#f0c040':'#888'}">${m.apMin??'-'}</td><td style="text-align:right">${m.casesProcessed??0}</td><td style="text-align:right">${m.casesPassed??0}</td></tr>`
    ).join('');
    const tab3 = `<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">
<tr style="color:#888"><th style="text-align:left">月</th><th>AP平均</th><th>AP最低</th><th>案件処理数</th><th>スキップ数</th></tr>${apRows}</table>
<div style="margin-top:8px;font-size:11px;color:#888">AP不足日数合計: <b>${st.apShortageDays}</b></div></div>`;

    // ── タブ4: 売上分析 ──
    const revRows = (r.monthlyData||[]).map(m => {
      const profit = m.storeProfit != null ? m.storeProfit : (m.storeRevenue||0)-(m.storeExpense||0);
      const pc = profit >= 0 ? '#66bb6a' : '#ff5252';
      const nc = (m.netChange||0) >= 0 ? '#66bb6a' : '#ff5252';
      return `<tr><td>${m.year}年${m.month}月</td><td style="text-align:right">¥${(m.storeRevenue||0).toLocaleString()}</td><td style="text-align:right">¥${(m.storeExpense||0).toLocaleString()}</td><td style="text-align:right;color:${pc}">¥${profit.toLocaleString()}</td><td style="text-align:right;color:${nc}">¥${(m.netChange||0).toLocaleString()}</td><td style="text-align:right">¥${(m.money||0).toLocaleString()}</td></tr>`;
    }).join('');
    const tab4 = `<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">
<tr style="color:#888"><th style="text-align:left">月</th><th>売上</th><th>経費</th><th>店舗損益</th><th>現金変動</th><th>現金残高</th></tr>${revRows}</table>
<div style="margin-top:8px;font-size:11px;color:#888">最高売上月: <b>${st.maxRevMonth}</b> &nbsp; 最低売上月: <b>${st.minRevMonth}</b> &nbsp; 赤字月: <b>${st.redMonths}</b>/12</div></div>`;

    // ── タブ5: イベント発火ログ ──
    const evRows = (r.eventLog||[]).slice(0,200).map(e =>
      `<tr><td style="white-space:nowrap">${e.date}</td><td style="font-size:10px">${e.source||''}</td><td style="font-size:10px">${e.eventId||''}</td><td style="font-size:10px">${(e.choiceLabel||'').slice(0,30)}</td><td style="text-align:right">${e.apSpent??''}</td><td style="text-align:right;color:${(e.moneyDelta||0)>=0?'#66bb6a':'#ff5252'}">${e.moneyDelta!=null?'¥'+(e.moneyDelta).toLocaleString():''}</td></tr>`
    ).join('');
    const tab5 = `<div style="font-size:11px;color:#888;margin-bottom:6px">最大200件表示 / 全${r.eventLog?.length||0}件</div>
<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse;white-space:nowrap">
<tr style="color:#888"><th style="text-align:left">日付</th><th>種別</th><th>eventId</th><th>選択</th><th>AP消費</th><th>損益</th></tr>${evRows}</table></div>`;

    // ── タブ6: キャラクター進行 ──
    const charRows = (r.charLog||[]).map(e =>
      `<tr><td style="white-space:nowrap">${e.date}</td><td>${e.char||''}</td><td style="font-size:10px">${e.eventId||''}</td><td style="font-size:10px">${e.title||''}</td></tr>`
    ).join('') || '<tr><td colspan="4" style="color:#555;text-align:center">キャラクターイベントなし</td></tr>';
    const chap1rows = (r.chapter1ClearLog||[]).map(c =>
      `<tr><td>${c.date}</td><td>${c.fn}</td><td style="font-size:10px">${c.args||''}</td><td>${c.gameEnded}</td></tr>`
    ).join('') || '<tr><td colspan="4" style="color:#555;text-align:center">未呼出</td></tr>';
    const tab6 = `<h4 style="color:#ce93d8;margin:0 0 6px">第一章クリア呼出</h4>
<div style="overflow-x:auto;margin-bottom:12px"><table style="width:100%;font-size:11px;border-collapse:collapse">
<tr style="color:#888"><th>日付</th><th>関数名</th><th>引数</th><th>gameEnded</th></tr>${chap1rows}</table></div>
<h4 style="color:#ce93d8;margin:0 0 6px">キャラクターイベント</h4>
<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">
<tr style="color:#888"><th style="text-align:left">日付</th><th>キャラ</th><th>eventId</th><th>タイトル</th></tr>${charRows}</table></div>`;

    // ── タブ7: 商品・メニュー ──
    const prodEvs = (r.eventLog||[]).filter(e => (e.eventId||'').startsWith('unlock_') || e.category==='product'||e.category==='menu');
    const prodRows = prodEvs.map(e =>
      `<tr><td>${e.date}</td><td style="font-size:10px">${e.eventId}</td><td style="font-size:10px">${e.choiceLabel||''}</td></tr>`
    ).join('') || '<tr><td colspan="3" style="color:#555;text-align:center">商品・メニューイベントなし</td></tr>';
    const tab7 = `<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">
<tr style="color:#888"><th style="text-align:left">日付</th><th>eventId</th><th>選択</th></tr>${prodRows}</table></div>`;

    // ── タブ8: 未解決案件 ──
    const unresolved = (r.endCasesSnapshot||[]).filter(c=>!c.resolved&&!c.expired);
    const caseRows = unresolved.map(c =>
      `<tr><td style="font-size:10px">${c.eventId}</td><td>${c.title||''}</td><td style="color:#f0c040">${c.status||''}</td><td style="font-size:10px">${c.unresolvedReason||''}</td></tr>`
    ).join('') || '<tr><td colspan="4" style="color:#555;text-align:center">なし</td></tr>';
    const resolved = (r.endCasesSnapshot||[]).filter(c=>c.resolved).length;
    const expired  = (r.endCasesSnapshot||[]).filter(c=>c.expired).length;
    const tab8 = `<div style="font-size:11px;color:#888;margin-bottom:6px">解決: ${resolved} / 未解決: ${unresolved.length} / 期限切: ${expired}</div>
<div style="overflow-x:auto"><table style="width:100%;font-size:11px;border-collapse:collapse">
<tr style="color:#888"><th style="text-align:left">eventId</th><th>タイトル</th><th>ステータス</th><th>理由</th></tr>${caseRows}</table></div>`;

    // ── タブ9: JSON ──
    const tab9 = `<button class="qa-btn" onclick="
      navigator.clipboard.writeText(JSON.stringify(window._qa2cLastResult,null,2));
      this.textContent='✅ コピー済み'; setTimeout(()=>this.textContent='JSON コピー（全データ）',1500)">
      JSON コピー（全データ）</button>`;

    const tabContents = [tab0,tab1,tab2,tab3,tab4,tab5,tab6,tab7,tab8,tab9];

    return `<div style="background:#111;border:1px solid #333;border-radius:8px;padding:12px;margin-top:8px">
<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${tabHdr}</div>
${tabContents.map((c,i)=>`<div id="${tid}_tab${i}" style="display:${i===0?'block':'none'}">${c}</div>`).join('')}
</div>
<script>
function qa2cSwitchTab(tid,idx){
  for(let i=0;i<10;i++){
    const el=document.getElementById(tid+'_tab'+i);
    if(el){el.style.display=i===idx?'block':'none';}
    const btn=document.querySelector('[data-ti="'+tid+'"][data-idx="'+i+'"]');
    if(btn){btn.style.background=i===idx?'#333':'#1a1a1a';}
  }
}
</script>`;
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

  // ══════════════════════════════════════════════════════════════
  // ■ Phase 3A — シード付き乱数・再現性テスト
  // ══════════════════════════════════════════════════════════════

  // ─── 3A-1. Mulberry32 シード付き乱数 ───
  function _mkRng(seed) {
    let s = ((seed | 0) >>> 0);
    const rng = function() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng._getSeed = () => s;
    return rng;
  }

  // ─── 3A-2. DJB2 ハッシュ ───
  function _djb2Hash(str) {
    let h = 5381 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  // ─── 3A-3. 正規化状態ハッシュ ───
  function _sim3StateHash(gObj) {
    if (!gObj) return '00000000';
    const sortObj = (o) => {
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
      return Object.fromEntries(Object.keys(o).sort().map(k => [k, sortObj(o[k])]));
    };
    const snap = {
      date:   { year: gObj.year, month: gObj.month, day: gObj.day },
      money:  gObj.money,
      ap:     gObj.ap,
      fatigue: gObj.fatigue,
      creditScore: gObj.creditScore,
      cases: (gObj.cases||[]).map(c => ({
        id: c.id, created: c.createdDay,
        resolved: !!c.resolved, expired: !!c.expired
      })).sort((a, b) => {
        const aid = String(a?.id ?? '');
        const bid = String(b?.id ?? '');
        const cmp = aid.localeCompare(bid);
        if (cmp !== 0) return cmp;
        return (a.created ?? 0) - (b.created ?? 0);
      }),
      stores: (gObj.stores||[]).map(s => ({
        id: s.id, customers: s.customers|0, revenue: s.revenue|0,
        menus: [...(s.menus||[])].sort()
      })),
      buildings: (gObj.buildings||[]).map(b => ({
        id: b.id,
        totalRooms: b.totalRooms || b.capacity || 0,
        occupants:  b.occupants || (b.residents||[]).length || 0
      })),
      staff: (gObj.staff||[]).map(s => ({
        id: s.id||s.name||'', sat: s.satisfaction|0, level: s.level|0
      })).sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''))),
      characters: sortObj(
        Object.fromEntries(Object.entries(gObj.characters||{}).map(([k,v]) => [k, {
          met: !!v.met, level: v.level|0, notesCount: (v.notes||[]).length
        }]))
      ),
      unlockedProducts: [...(gObj.unlockedProducts||[])].sort(),
      caseCooldowns:       sortObj(gObj.caseCooldowns||{}),
      eventCooldowns:      sortObj(gObj.eventCooldowns||{}),
      seasonalEventStatus: sortObj(gObj.seasonalEventStatus||{}),
      pendingFollowUps: (gObj.pendingFollowUps||[]).map(f => (f&&f.id)||f||'').sort(),
      currentChallengeId: (gObj.currentChallenge&&gObj.currentChallenge.id)||null,
    };
    return _djb2Hash(JSON.stringify(snap));
  }

  // ─── 3A-4. 計測付き RNG ラッパー ───
  function _mkTrackedRng(seed) {
    const rng = _mkRng(seed);
    let callCount = 0;
    const firstVals = [];
    const recent = new Array(10);
    let ri = 0;
    const tracked = function() {
      const v = rng();
      callCount++;
      if (callCount <= 10) firstVals.push(parseFloat(v.toFixed(6)));
      recent[ri % 10] = { n: callCount, v: parseFloat(v.toFixed(6)) };
      ri++;
      return v;
    };
    tracked._count    = () => callCount;
    tracked._first10  = () => [...firstVals];
    tracked._last10   = () => {
      const len = Math.min(callCount, 10);
      const out = [];
      for (let i = len - 1; i >= 0; i--) {
        out.unshift(recent[(ri - 1 - i + 20) % 10]);
      }
      return out;
    };
    tracked._state    = () => rng._getSeed();
    return tracked;
  }

  // ─── 3A-5. Phase 3A 状態 ───
  let _sim3Running  = false;
  let _sim3LastReprod = null;

  // ─── 3A-6. 再現性テスト（seed×2） ───
  function _sim3StartReprod(seed) {
    if (_sim3Running || _sim2cRunning || _sim2bRunning || _qa2aRunning) {
      alert('別のシミュレーションが実行中です。停止してから再実行してください。');
      return;
    }
    _sim3Running  = true;
    _sim3LastReprod = null;
    renderPhase3Tab();

    const origRandom = Math.random;
    const gNow = eval('G');

    // 非文字列ID診断（初回のみ）
    const badIds = (gNow.cases||[]).filter(c => typeof c.id !== 'string');
    if (badIds.length > 0) {
      console.warn('[QA-3A] 非文字列IDのcase検出:');
      console.table(badIds.map(c => ({ id: c.id, type: typeof c.id, title: c.title, source: c.source })));
    } else {
      console.log('[QA-3A] case.id 型チェック: 全件 string — 問題なし');
    }

    const startHash = _sim3StateHash(gNow);
    const overallStart = Date.now();

    // 試行データ
    const trials = [];

    function runOneTrial(trialIdx, onDone) {
      const rng = _mkTrackedRng(seed);
      Math.random = rng;
      const t0 = Date.now();
      const prevExecAt = window._qa2cLastResult ? window._qa2cLastResult.executedAt : null;

      window._qa2cRun();

      const pollId = setInterval(() => {
        const r = window._qa2cLastResult;
        if (r && r.executedAt !== prevExecAt) {
          clearInterval(pollId);

          // G はこの時点で Phase 2C により復元済み
          const postHash = _sim3StateHash(eval('G'));

          trials[trialIdx] = {
            trialIdx,
            seed,
            elapsed:   ((Date.now() - t0) / 1000).toFixed(2) + 's',
            rng: {
              calls:    rng._count(),
              first10:  rng._first10(),
              last10:   rng._last10(),
              finalState: rng._state().toString(16).padStart(8,'0'),
            },
            startHash,
            endHash:   postHash,
            overall:       r.overall,
            simOverall:    r.simOverall,
            safetyOverall: r.safetyOverall,
            daysCompleted: r.daysCompleted,
            anomalyCount:  (r.anomalies||[]).length,
            p1Count:       (r.anomalies||[]).filter(a=>a.severity==='P1').length,
            annualStats:   r.annualStats,
            endDate:       r.endDateSimulated,
            // イベント系列（全件ハッシュ用 + 先頭50・末尾50保存）
            eventSeqHash:  _djb2Hash(
              (r.eventLog||[]).map(e => `${e.date}:${e.eventId}:${e.choiceIdx}`).join('|')
            ),
            eventLogHead:  (r.eventLog||[]).slice(0, 50).map(e => ({
              date: e.date, id: e.eventId, choice: e.choiceIdx
            })),
            eventLogTail:  (r.eventLog||[]).slice(-50).map(e => ({
              date: e.date, id: e.eventId, choice: e.choiceIdx
            })),
            // 月別データ（完了暦月のみ）
            monthlyData:   r.monthlyData,
            monthlyFull:   (r.monthlyData||[]).filter((_,i,a) => i>0 && i<a.length-1),
            safety:        r.safety,
          };

          Math.random = origRandom;  // 各試行後に必ず復元
          onDone();
        }
      }, 300);
    }

    runOneTrial(0, () => {
      runOneTrial(1, () => {
        Math.random = origRandom;
        _sim3Running = false;
        _sim3LastReprod = _sim3CompareReprod(trials[0], trials[1], Date.now() - overallStart);
        renderPhase3Tab();
      });
    });
  }

  // ─── 3A-7. 2試行比較 ───
  function _sim3CompareReprod(t0, t1, totalMs) {
    if (!t0 || !t1) return null;
    const checks = [];
    const chk = (label, a, b) => {
      const ok = JSON.stringify(a) === JSON.stringify(b);
      checks.push({ label, ok, a: String(a).substring(0, 80), b: String(b).substring(0, 80) });
      return ok;
    };

    chk('開始状態ハッシュ一致',    t0.startHash,      t1.startHash);
    chk('終了状態ハッシュ一致',    t0.endHash,        t1.endHash);
    chk('イベント系列ハッシュ一致', t0.eventSeqHash,   t1.eventSeqHash);
    chk('RNG呼出回数一致',         t0.rng.calls,      t1.rng.calls);
    chk('RNG最終状態一致',         t0.rng.finalState, t1.rng.finalState);
    chk('overall一致',             t0.overall,        t1.overall);
    chk('365日完走',               t0.daysCompleted,  365);
    chk('Safety PASS',             t0.safetyOverall,  'PASS');
    chk('年間売上一致',
      t0.annualStats?.totalRevenue,  t1.annualStats?.totalRevenue);
    chk('年末現金一致',
      t0.endDate?.money,             t1.endDate?.money);
    chk('月別データ件数一致',
      (t0.monthlyData||[]).length,   (t1.monthlyData||[]).length);

    // 月別データ詳細比較
    const m0 = t0.monthlyData||[], m1 = t1.monthlyData||[];
    const monthMismatch = [];
    for (let i = 0; i < Math.max(m0.length, m1.length); i++) {
      const a = m0[i], b = m1[i];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        monthMismatch.push({ month: i+1, a: a?.storeRevenue, b: b?.storeRevenue });
      }
    }

    // イベント系列の最初の差分を探す
    const el0 = (t0.eventLogHead||[]), el1 = (t1.eventLogHead||[]);
    let firstDiff = null;
    for (let i = 0; i < Math.max(el0.length, el1.length); i++) {
      if (JSON.stringify(el0[i]) !== JSON.stringify(el1[i])) {
        firstDiff = { idx: i, a: el0[i], b: el1[i] };
        break;
      }
    }

    const allPass = checks.every(c => c.ok) && monthMismatch.length === 0;
    return {
      allPass, totalMs,
      trials: [t0, t1],
      checks, monthMismatch, firstDiff,
    };
  }

  // ─── 3A-8. Phase 3A タブ描画 ───
  function renderPhase3Tab() {
    const panel = document.getElementById('qa-panel-phase3');
    if (!panel) return;
    const r = _sim3LastReprod;
    const running = _sim3Running;

    let resultHtml = '';
    if (running) {
      resultHtml = `<div style="color:#f0c040;font-size:13px;margin-top:16px">⏳ テスト実行中…</div>`;
    } else if (r) {
      const ovColor = r.allPass ? '#66bb6a' : '#ff5252';
      const ovLabel = r.allPass ? '✅ 再現性 PASS' : '❌ 再現性 FAIL';

      // チェック一覧
      const chkRows = r.checks.map(c =>
        `<tr><td style="padding:3px 8px;color:#aaa">${esc(c.label)}</td>
          <td style="color:${c.ok?'#66bb6a':'#ff5252'};font-weight:700">${c.ok?'✓':'✗'}</td>
          <td style="font-size:10px;color:#888">${esc(c.a)}</td>
          <td style="font-size:10px;color:#888">${c.ok?'':esc(c.b)}</td></tr>`
      ).join('');

      // RNG比較
      const rngHtml = r.trials.map((t,i) => `
        <div style="margin-bottom:8px;font-size:11px;color:#aaa">
          <strong style="color:#64b5f6">試行${i+1} (seed=${t.seed})</strong>
          &nbsp; 経過: ${t.elapsed} &nbsp; RNG呼出: ${t.rng.calls.toLocaleString()}回
          &nbsp; RNG最終: <code>${t.rng.finalState}</code><br>
          最初の10個: <code>${t.rng.first10.join(', ')}</code>
        </div>`).join('');

      // 月別不一致
      const monthHtml = r.monthMismatch.length === 0
        ? `<div style="color:#66bb6a;font-size:11px">月別データ完全一致</div>`
        : `<div style="color:#ff5252;font-size:11px">月別不一致 ${r.monthMismatch.length}件:<br>`
          + r.monthMismatch.map(m=>`M${m.month}: 試行1=${m.a} / 試行2=${m.b}`).join('<br>')
          + '</div>';

      // イベント差分
      const diffHtml = r.firstDiff
        ? `<div style="color:#ff5252;font-size:11px;margin-top:8px">
            ⚠ 最初の差分 index=${r.firstDiff.idx}:<br>
            試行1: ${JSON.stringify(r.firstDiff.a)}<br>
            試行2: ${JSON.stringify(r.firstDiff.b)}</div>`
        : `<div style="color:#66bb6a;font-size:11px;margin-top:6px">イベント系列先頭50件 一致</div>`;

      resultHtml = `
<div style="margin-bottom:14px">
  <span style="font-size:20px;font-weight:900;padding:4px 16px;border-radius:6px;
    background:${r.allPass?'#0a2a0a':'#2a0000'};color:${ovColor};border:2px solid ${ovColor}">
    ${ovLabel}</span>
  <span style="font-size:11px;color:#888;margin-left:10px">
    総経過時間: ${(r.totalMs/1000).toFixed(1)}s &nbsp;
    1試行推定: ${(r.trials[0].elapsed)}</span>
</div>

<div style="background:#0d1f2d;border:1px solid #1e3a5a;border-radius:6px;padding:10px 14px;margin-bottom:12px">
  <div style="font-size:11px;color:#64b5f6;font-weight:700;margin-bottom:8px">📊 検証チェック</div>
  <table style="font-size:11px;border-collapse:collapse;width:100%">${chkRows}</table>
</div>

<div style="background:#0d1f2d;border:1px solid #1e3a5a;border-radius:6px;padding:10px 14px;margin-bottom:12px">
  <div style="font-size:11px;color:#64b5f6;font-weight:700;margin-bottom:6px">🎲 RNG情報</div>
  ${rngHtml}
</div>

<div style="background:#0d1f2d;border:1px solid #1e3a5a;border-radius:6px;padding:10px 14px;margin-bottom:12px">
  <div style="font-size:11px;color:#64b5f6;font-weight:700;margin-bottom:6px">📅 月別・イベント系列</div>
  ${monthHtml}
  ${diffHtml}
</div>

<button class="qa-btn" onclick="window._qa3CopyJSON()">JSON コピー</button>`;

      window._qa3CopyJSON = () => {
        navigator.clipboard.writeText(JSON.stringify(r, null, 2)).catch(()=>{});
      };
    } else {
      resultHtml = `<div style="color:#555;font-size:12px">まだ実行していません。</div>`;
    }

    panel.innerHTML = `
<h3 style="color:#ce93d8;margin:0 0 8px">Phase 3A — Step 1：同一seed×2回 再現性テスト</h3>
<div class="qa-notice" style="font-size:11px;padding:8px 12px">
  同じseedで365日シミュレーションを<strong>2回</strong>実行し、イベント順・月別売上・終了状態が完全一致するか検証します。<br>
  一致した場合のみ、次のステップ（多試行実行）へ進みます。
</div>
<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
  <label style="font-size:12px;color:#aaa">Seed:
    <input id="qa3-seed" type="number" value="1001" min="1"
      style="width:80px;background:#111;color:#eee;border:1px solid #444;padding:3px 6px;margin-left:6px;border-radius:4px">
  </label>
  <button class="qa-btn" id="qa3-reprod-btn"
    onclick="(function(){const s=parseInt(document.getElementById('qa3-seed').value)||1001;window._qa3ReproRun(s);})()"
    ${running ? 'disabled' : ''}>
    ${running ? '⏳ 実行中…' : '▶ seed×2 再現テスト'}
  </button>
  ${running ? `<button class="qa-btn" onclick="window._qa2cStop()" style="color:#ff8800;border-color:#ff8800">■ 停止</button>` : ''}
</div>
${resultHtml}`;

    window._qa3ReproRun = (seed) => _sim3StartReprod(seed);
  }

  // renderPhase3Tab を window に公開
  window._qa3RefreshPhase3 = renderPhase3Tab;

  // DOMが準備できていれば即時、そうでなければ待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

})();
