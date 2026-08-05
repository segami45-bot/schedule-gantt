/*
 * store.js — データ層（DOM非依存 / CLAUDE.md 7）
 *
 * ブラウザ: <script src="js/store.js"> で読み込むとグローバル変数 Store が使えます。
 * Node.js : require('./js/store.js') で同じものを受け取れます（テスト用）。
 *
 * 役割は次の5つです。
 *   (1) 日付 ⇔ 半日シリアル値の変換（CLAUDE.md 4.1）
 *   (2) 表示状態（期間）の保存・復元（CLAUDE.md 5.2 / 5.9）
 *   (3) データの読み書きと migrate（CLAUDE.md 4.3）
 *   (4) 部署・担当者・案件・バーの CRUD（CLAUDE.md 5.6〜5.8）
 *   (5) JSONの書き出し・読み込み（CLAUDE.md 5.9）
 *
 * このファイルは画面に触れません。エラーは日本語メッセージ付きの例外として投げ、
 * 表示は呼び出し側（popup.js など）が行います。
 */
(function (global) {
  'use strict';

  /* ============================================================
   * 定数
   * ============================================================ */

  // 半日シリアル値の基準日。2020-01-01（現地暦）を第0日とする（CLAUDE.md 4.1）
  var BASE_YEAR = 2020;
  var BASE_MONTH = 1;
  var BASE_DAY = 1;

  var MS_PER_DAY = 86400000; // 1日のミリ秒数

  var AM = 0; // 午前
  var PM = 1; // 午後

  var DATA_KEY = 'sgantt.data'; // データ本体の保存キー（CLAUDE.md 5.9）
  var VIEW_KEY = 'sgantt.view'; // 表示状態の保存キー（CLAUDE.md 5.9）

  var DATA_VERSION = 3; // 現在のデータ構造の版（CLAUDE.md 4.2）

  var MIN_DAY_COUNT = 1;   // 表示幅の下限（CLAUDE.md 5.2）
  var MAX_DAY_COUNT = 120; // 表示幅の上限（CLAUDE.md 5.2）

  var DEFAULT_BACK_DAYS = 7;   // ［30日］の開始日は今日の7日前
  var DEFAULT_DAY_COUNT = 30;  // 初回表示は30日間

  // 工程6種。選択肢はこの順に並べる（CLAUDE.md 3）
  var STAGES = ['初校', '修正', 'ラフ', 'MT', '入稿', '納品'];

  /*
   * 「MT」「入稿」「納品」は日付の性質を持つ工程。
   * 常に1日幅で、画面ではバー（背景色）を描かず文字ラベルのみを出す（CLAUDE.md 3 / 5.5）。
   */
  var ONE_DAY_STAGES = ['MT', '入稿', '納品'];

  // 番号（1〜20）を持つのは「修正」のときだけ（CLAUDE.md 4.3）
  var NUMBERED_STAGE = '修正';
  var MIN_STAGE_NO = 1;
  var MAX_STAGE_NO = 20;

  // 状態6種（CLAUDE.md 4.3）
  var STATUSES = ['未着手', '制作中', '校了', '25', '50', '75'];

  /*
   * MT・入稿・納品の文字色（CLAUDE.md 4.3 / 6.2）。
   * "default" は工程ごとの既定色（MT・納品=グレー、入稿=赤）、"white" は白。
   * 色付きバーに重なったときに読めるよう、白を選べるようにしています。
   */
  var MARK_COLORS = ['default', 'white'];

  var DEFAULT_STAGE = 'ラフ';   // バー追加時の初期値（CLAUDE.md 5.6）
  var DEFAULT_STATUS = '未着手';
  var DEFAULT_MARK_COLOR = 'default';

  // その工程が色付きバーを持つか（＝文字だけの表示ではないか）
  function hasBar(stage) {
    return ONE_DAY_STAGES.indexOf(stage) < 0;
  }

  /* ============================================================
   * 日付 ⇔ 半日シリアル値
   *
   * 「通算日数」= 2020-01-01 から数えた日数（2020-01-01 が 0）。
   * 「半日シリアル値」= 通算日数 × 2 + (午前=0 / 午後=1)。
   * タイムゾーンずれを避けるため new Date(y, m-1, d) のローカル日付演算のみを使い、
   * Date.parse / UTC系メソッドは使いません（CLAUDE.md 4.1）。
   * ============================================================ */

  function baseDate() {
    return new Date(BASE_YEAR, BASE_MONTH - 1, BASE_DAY);
  }

  // 通算日数 → Date（その日の0時）
  function dateFromDayIndex(dayIndex) {
    return new Date(BASE_YEAR, BASE_MONTH - 1, BASE_DAY + dayIndex);
  }

  // Date → 通算日数（時刻は切り捨てる）
  function dayIndexFromDate(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    // 夏時間のある地域でも1日ぶんの誤差が出ないように四捨五入する（CLAUDE.md 4.1）
    return Math.round((d - baseDate()) / MS_PER_DAY);
  }

  function dayIndexFromYmd(year, month, day) {
    return dayIndexFromDate(new Date(year, month - 1, day));
  }

  // 通算日数 + 午前午後 → 半日シリアル値
  function serialFromDayIndex(dayIndex, half) {
    return dayIndex * 2 + (half === PM ? PM : AM);
  }

  function dayIndexFromSerial(serial) {
    return Math.floor(serial / 2);
  }

  function halfFromSerial(serial) {
    return ((serial % 2) + 2) % 2; // 負の値でも0か1になるようにする
  }

  function serialFromYmd(year, month, day, half) {
    return serialFromDayIndex(dayIndexFromYmd(year, month, day), half);
  }

  function dateFromSerial(serial) {
    return dateFromDayIndex(dayIndexFromSerial(serial));
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // 通算日数 → "YYYY-MM-DD"
  function ymdTextFromDayIndex(dayIndex) {
    var d = dateFromDayIndex(dayIndex);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function ymdTextFromSerial(serial) {
    return ymdTextFromDayIndex(dayIndexFromSerial(serial));
  }

  // "YYYY-MM-DD" → 通算日数。形式違い・存在しない日付は null を返す
  function dayIndexFromYmdText(text) {
    if (typeof text !== 'string') { return null; }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m) { return null; }
    var year = Number(m[1]);
    var month = Number(m[2]);
    var day = Number(m[3]);
    var d = new Date(year, month - 1, day);
    // 2026-02-31 のような存在しない日付はDateが繰り上がるので、往復させて弾く
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null;
    }
    return dayIndexFromDate(d);
  }

  function serialFromYmdText(text, half) {
    var dayIndex = dayIndexFromYmdText(text);
    return dayIndex === null ? null : serialFromDayIndex(dayIndex, half);
  }

  function todayDayIndex() {
    return dayIndexFromDate(new Date());
  }

  function todaySerial() {
    return serialFromDayIndex(todayDayIndex(), AM);
  }

  /* ============================================================
   * バーの期間
   *
   * バーは「開始日の午前（偶数）〜 終了日の午後（奇数）」を両端含みで持つ。
   * 1日幅は end = start + 1（CLAUDE.md 4.1）。
   * ============================================================ */

  // 開始日・終了日（通算日数）→ { start, end }
  function rangeFromDays(startDayIndex, endDayIndex) {
    var s = startDayIndex;
    var e = endDayIndex;
    if (e < s) { e = s; } // 逆転していたら1日幅にそろえる
    return { start: serialFromDayIndex(s, AM), end: serialFromDayIndex(e, PM) };
  }

  // バー → { startDayIndex, endDayIndex }
  function daysFromRange(bar) {
    return {
      startDayIndex: dayIndexFromSerial(bar.start),
      endDayIndex: dayIndexFromSerial(bar.end)
    };
  }

  // バーが何日ぶんの幅か
  function barDayCount(bar) {
    return dayIndexFromSerial(bar.end) - dayIndexFromSerial(bar.start) + 1;
  }

  // バーの文字ラベル。修正だけ番号を連結する（CLAUDE.md 5.5）
  function barLabel(bar) {
    return bar.stage === NUMBERED_STAGE ? bar.stage + bar.stageNo : bar.stage;
  }

  /* ============================================================
   * 共通の小道具
   * ============================================================ */

  // 日本語メッセージ付きのエラーを作る。画面表示は呼び出し側が行う
  function fail(message) {
    var e = new Error(message);
    e.name = 'SganttError';
    return e;
  }

  // id は crypto.randomUUID() で生成する（CLAUDE.md 4.3）
  function newId() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
    // 古いNode.js向けの保険
    if (typeof require === 'function') {
      try {
        var nodeCrypto = require('crypto');
        if (nodeCrypto && typeof nodeCrypto.randomUUID === 'function') {
          return nodeCrypto.randomUUID();
        }
      } catch (e) { /* ブラウザではここに来ない */ }
    }
    // 最後の保険（乱数の質は落ちるが形式は同じ）
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // 自由入力の文字列項目。未指定なら空文字にする（CLAUDE.md 4.3）
  function freeText(v) {
    return typeof v === 'string' ? v : '';
  }

  // order 昇順に並べた新しい配列を返す
  function sortByOrder(list) {
    return list.slice().sort(function (a, b) { return a.order - b.order; });
  }

  // 同じ階層の中で次に使う order
  function nextOrder(list) {
    var max = 0;
    list.forEach(function (item) {
      if (item.order > max) { max = item.order; }
    });
    return max + 1;
  }

  /* ============================================================
   * migrate（CLAUDE.md 4.3）
   *
   * localStorage読み込みとJSONインポートは必ずここを通します。
   *
   * 直せる不足（省略された自由項目・orderの振り直し・バーの端の丸めなど）は
   * 黙って直さず notes に記録します。
   * データの取り違えにつながる矛盾（存在しない担当者を指している等）は
   * 例外を投げ、既存データを置き換えないようにします（CLAUDE.md 9.6）。
   * ============================================================ */

  var lastNotes = []; // 直近の migrate で自動修正した内容

  function note(text) {
    lastNotes.push(text);
  }

  /*
   * dataVersion 1 → 2 の読み替え（CLAUDE.md 11 の v2.0）。
   *   工程: 「再校」→「修正」
   *   状態: 「完了」→「校了」／「CL確認中」→「制作中」＋囲い点線ON
   * 変換したバーは { stage, status, clsCheck } を書き換えた新しいオブジェクトで返します。
   */
  var V1_STAGE_RENAME = { '再校': '修正' };
  var V1_STATUS_RENAME = { '完了': '校了' };

  function upgradeBarFromV1(raw, projectTitle) {
    var bar = {};
    var key;
    for (key in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) { bar[key] = raw[key]; }
    }

    if (V1_STAGE_RENAME[bar.stage]) {
      note('案件「' + projectTitle + '」の工程「' + bar.stage + '」を「' +
           V1_STAGE_RENAME[bar.stage] + '」に読み替えました。');
      bar.stage = V1_STAGE_RENAME[bar.stage];
    }
    if (V1_STATUS_RENAME[bar.status]) {
      note('案件「' + projectTitle + '」の状態「' + bar.status + '」を「' +
           V1_STATUS_RENAME[bar.status] + '」に読み替えました。');
      bar.status = V1_STATUS_RENAME[bar.status];
    }
    // 「CL確認中」は状態から外れ、囲い点線に置き換わった
    if (bar.status === 'CL確認中') {
      note('案件「' + projectTitle + '」の状態「CL確認中」を「制作中」＋囲い点線に置き換えました。');
      bar.status = '制作中';
      bar.clsCheck = true;
    }
    return bar;
  }

  function migrateBar(raw, projectTitle, fromVersion) {
    if (!isObject(raw)) {
      throw fail('案件「' + projectTitle + '」のバーの形式が正しくありません。');
    }
    if (fromVersion < 2) {
      raw = upgradeBarFromV1(raw, projectTitle);
    }
    if (STAGES.indexOf(raw.stage) < 0) {
      throw fail('案件「' + projectTitle + '」に不明な工程「' + raw.stage + '」があります。');
    }
    if (STATUSES.indexOf(raw.status) < 0) {
      throw fail('案件「' + projectTitle + '」に不明な状態「' + raw.status + '」があります。');
    }

    var start = Math.floor(Number(raw.start));
    var end = Math.floor(Number(raw.end));
    if (!isFinite(start) || !isFinite(end)) {
      throw fail('案件「' + projectTitle + '」のバーに日付が入っていません。');
    }

    // 開始は午前（偶数）、終了は午後（奇数）にそろえる
    if (halfFromSerial(start) !== AM) {
      start = start - 1;
      note('案件「' + projectTitle + '」のバーの開始日を午前にそろえました。');
    }
    if (halfFromSerial(end) !== PM) {
      end = end + 1;
      note('案件「' + projectTitle + '」のバーの終了日を午後にそろえました。');
    }
    if (end < start + 1) {
      end = start + 1;
      note('案件「' + projectTitle + '」のバーの終了日が開始日より前だったため1日幅にしました。');
    }
    // MT・入稿・納品は常に1日幅（CLAUDE.md 5.5）
    if (!hasBar(raw.stage) && end !== start + 1) {
      end = start + 1;
      note('案件「' + projectTitle + '」の「' + raw.stage + '」を1日幅にそろえました。');
    }

    // 番号は修正のときだけ意味を持つ（CLAUDE.md 4.3）
    var stageNo = Math.floor(Number(raw.stageNo));
    if (!isFinite(stageNo) || stageNo < MIN_STAGE_NO || stageNo > MAX_STAGE_NO) {
      if (raw.stage === NUMBERED_STAGE && raw.stageNo !== undefined) {
        note('案件「' + projectTitle + '」の' + NUMBERED_STAGE +
             '番号が1〜20の外だったため1にしました。');
      }
      stageNo = MIN_STAGE_NO;
    }

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
      stage: raw.stage,
      stageNo: stageNo,
      status: raw.status,
      // 囲い点線＝CL&S確認中（CLAUDE.md 4.3）。省略時はOFF
      clsCheck: raw.clsCheck === true,
      // MT・入稿・納品の文字色（CLAUDE.md 4.3）。省略時は既定色
      markColor: MARK_COLORS.indexOf(raw.markColor) >= 0 ? raw.markColor : DEFAULT_MARK_COLOR,
      start: start,
      end: end
    };
  }

  function migrate(raw) {
    lastNotes = [];

    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        throw fail('JSONとして読み取れませんでした。ファイルが壊れていないか確認してください。');
      }
    }
    if (!isObject(raw)) {
      throw fail('データの形式が正しくありません（オブジェクトではありません）。');
    }

    var version = raw.dataVersion === undefined ? DATA_VERSION : Math.floor(Number(raw.dataVersion));
    if (!isFinite(version)) {
      throw fail('dataVersion の値が正しくありません。');
    }
    if (version > DATA_VERSION) {
      throw fail('このファイルは新しい版のsgantt（dataVersion ' + version +
                 '）で作られています。読み込めません。');
    }
    /*
     * 版が上がったときは、ここに旧→新の変換を追加していきます。
     *   1 → 2: 工程・状態の名称変更、CL確認中→囲い点線（migrateBar で行う）
     *   2 → 3: バーに markColor を追加（省略時は既定色になるため、個別の処理は不要）
     */

    if (!Array.isArray(raw.departments) || !Array.isArray(raw.members) ||
        !Array.isArray(raw.projects)) {
      throw fail('データに departments / members / projects のいずれかがありません。');
    }

    // ---- 部署 ----
    var departments = raw.departments.map(function (d, i) {
      if (!isObject(d) || typeof d.name !== 'string') {
        throw fail('部署の形式が正しくありません（' + (i + 1) + '件目）。');
      }
      return {
        id: typeof d.id === 'string' && d.id ? d.id : newId(),
        name: d.name,
        order: Math.floor(Number(d.order)) || (i + 1)
      };
    });
    var deptIds = departments.map(function (d) { return d.id; });

    // ---- 担当者 ----
    var members = raw.members.map(function (m, i) {
      if (!isObject(m) || typeof m.name !== 'string') {
        throw fail('担当者の形式が正しくありません（' + (i + 1) + '件目）。');
      }
      if (deptIds.indexOf(m.deptId) < 0) {
        throw fail('担当者「' + m.name + '」が、存在しない部署に所属しています。');
      }
      return {
        id: typeof m.id === 'string' && m.id ? m.id : newId(),
        deptId: m.deptId,
        name: m.name,
        countText: freeText(m.countText),
        emoji: freeText(m.emoji),
        comment: freeText(m.comment),
        order: Math.floor(Number(m.order)) || (i + 1)
      };
    });
    var memberIds = members.map(function (m) { return m.id; });

    // ---- 案件 ----
    var projects = raw.projects.map(function (p, i) {
      if (!isObject(p)) {
        throw fail('案件の形式が正しくありません（' + (i + 1) + '件目）。');
      }
      var title = freeText(p.title);
      var label = title || '(無題)';

      if (!Array.isArray(p.assigneeIds)) {
        throw fail('案件「' + label + '」に担当者の一覧がありません。');
      }
      // 重複を取り除きつつ、存在しない担当者を指していないか確かめる
      var assigneeIds = [];
      p.assigneeIds.forEach(function (id) {
        if (memberIds.indexOf(id) < 0) {
          throw fail('案件「' + label + '」が、存在しない担当者を指しています。');
        }
        if (assigneeIds.indexOf(id) < 0) { assigneeIds.push(id); }
      });
      if (assigneeIds.length !== p.assigneeIds.length) {
        note('案件「' + label + '」の担当者の重複を取り除きました。');
      }
      // 担当者は最低1名（CLAUDE.md 4.3）
      if (assigneeIds.length === 0) {
        throw fail('案件「' + label + '」に担当者が1人もいません。');
      }

      if (!Array.isArray(p.bars)) {
        throw fail('案件「' + label + '」にバーの一覧がありません。');
      }

      return {
        id: typeof p.id === 'string' && p.id ? p.id : newId(),
        title: title,
        assigneeIds: assigneeIds,
        hidden: p.hidden === true,
        order: Math.floor(Number(p.order)) || (i + 1),
        bars: p.bars.map(function (b) { return migrateBar(b, label, version); })
      };
    });

    return {
      dataVersion: DATA_VERSION,
      departments: departments,
      members: members,
      projects: projects
    };
  }

  function createEmptyData() {
    return { dataVersion: DATA_VERSION, departments: [], members: [], projects: [] };
  }

  /* ============================================================
   * localStorage への保存・復元
   * ============================================================ */

  // localStorageが使えるか（file:// やプライベートモードでの例外を吸収する）
  function storage() {
    try {
      if (typeof localStorage === 'undefined') { return null; }
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  var data = createEmptyData(); // 現在のデータ（唯一の実体）

  function getData() {
    return data;
  }

  // 外から与えたデータで丸ごと置き換える（必ず migrate を通す）
  function setData(raw) {
    data = migrate(raw);
    saveData();
    return data;
  }

  function saveData() {
    var ls = storage();
    if (!ls) { return data; }
    try {
      ls.setItem(DATA_KEY, JSON.stringify(data));
    } catch (e) {
      // 保存できなくても操作は続ける
    }
    return data;
  }

  // localStorageから復元する。壊れていた場合は空データにして理由を notes に残す
  function loadData() {
    lastNotes = [];
    var ls = storage();
    if (!ls) { data = createEmptyData(); return data; }

    var text = null;
    try {
      text = ls.getItem(DATA_KEY);
    } catch (e) {
      text = null;
    }
    if (!text) { data = createEmptyData(); return data; }

    try {
      data = migrate(text);
    } catch (e) {
      data = createEmptyData();
      note('保存されていたデータを読み込めませんでした（' + e.message + '）');
    }
    return data;
  }

  /* ============================================================
   * 表示状態（期間）の保存・復元
   *
   * 形: { startSerial: 表示開始日の午前シリアル値, dayCount: 表示日数 }
   * ============================================================ */

  function clampDayCount(dayCount) {
    var n = Math.round(Number(dayCount));
    if (!isFinite(n)) { return DEFAULT_DAY_COUNT; }
    if (n < MIN_DAY_COUNT) { return MIN_DAY_COUNT; }
    if (n > MAX_DAY_COUNT) { return MAX_DAY_COUNT; }
    return n;
  }

  // 初期表示: 今日の7日前から30日間・非表示の案件は出さない（CLAUDE.md 5.2 / 5.4）
  function defaultView() {
    return {
      startSerial: serialFromDayIndex(todayDayIndex() - DEFAULT_BACK_DAYS, AM),
      dayCount: DEFAULT_DAY_COUNT,
      showHidden: false
    };
  }

  function normalizeView(raw) {
    if (!isObject(raw)) { return defaultView(); }
    var startSerial = Number(raw.startSerial);
    if (!isFinite(startSerial)) { return defaultView(); }
    // 表示開始は必ず「その日の午前」に揃える
    startSerial = serialFromDayIndex(dayIndexFromSerial(startSerial), AM);
    return {
      startSerial: startSerial,
      dayCount: clampDayCount(raw.dayCount),
      // 古い保存値には showHidden が無いため、その場合は false 扱いにする
      showHidden: raw.showHidden === true
    };
  }

  function loadView() {
    var ls = storage();
    if (!ls) { return defaultView(); }
    try {
      var text = ls.getItem(VIEW_KEY);
      if (!text) { return defaultView(); }
      return normalizeView(JSON.parse(text));
    } catch (e) {
      return defaultView(); // 壊れた保存値は黙って初期値に戻す
    }
  }

  function saveView(view) {
    var ls = storage();
    var normalized = normalizeView(view);
    if (!ls) { return normalized; }
    try {
      ls.setItem(VIEW_KEY, JSON.stringify(normalized));
    } catch (e) {
      // 保存できなくても表示は続ける
    }
    return normalized;
  }

  /* ============================================================
   * 取得（読み取り専用）
   * ============================================================ */

  function findDepartment(id) {
    return data.departments.filter(function (d) { return d.id === id; })[0] || null;
  }

  function findMember(id) {
    return data.members.filter(function (m) { return m.id === id; })[0] || null;
  }

  function findProject(id) {
    return data.projects.filter(function (p) { return p.id === id; })[0] || null;
  }

  function findBar(project, barId) {
    return project.bars.filter(function (b) { return b.id === barId; })[0] || null;
  }

  // 見つからなければ日本語メッセージ付きで止める
  function needDepartment(id) {
    var d = findDepartment(id);
    if (!d) { throw fail('部署が見つかりません。'); }
    return d;
  }

  function needMember(id) {
    var m = findMember(id);
    if (!m) { throw fail('担当者が見つかりません。'); }
    return m;
  }

  function needProject(id) {
    var p = findProject(id);
    if (!p) { throw fail('案件が見つかりません。'); }
    return p;
  }

  function needBar(project, barId) {
    var b = findBar(project, barId);
    if (!b) { throw fail('バーが見つかりません。'); }
    return b;
  }

  function listDepartments() {
    return sortByOrder(data.departments);
  }

  // 部署を指定するとその部署の担当者だけを返す
  function listMembers(deptId) {
    var list = deptId === undefined
      ? data.members
      : data.members.filter(function (m) { return m.deptId === deptId; });
    return sortByOrder(list);
  }

  /*
   * 担当者に割り当てられた案件を返す。
   * includeHidden が true でなければ hidden の案件は除く（CLAUDE.md 5.4）。
   */
  function listProjects(memberId, includeHidden) {
    var list = data.projects.filter(function (p) {
      if (memberId !== undefined && p.assigneeIds.indexOf(memberId) < 0) { return false; }
      if (!includeHidden && p.hidden) { return false; }
      return true;
    });
    return sortByOrder(list);
  }

  // その担当者が唯一の担当になっている案件（担当者を消せるかの判定に使う）
  function soleAssignedProjects(memberId) {
    return data.projects.filter(function (p) {
      return p.assigneeIds.length === 1 && p.assigneeIds[0] === memberId;
    });
  }

  /* ============================================================
   * 部署の CRUD（CLAUDE.md 5.8）
   * ============================================================ */

  function addDepartment(name) {
    var text = freeText(name).trim();
    if (!text) { throw fail('部署名を入力してください。'); }
    var dept = { id: newId(), name: text, order: nextOrder(data.departments) };
    data.departments.push(dept);
    saveData();
    return dept;
  }

  function renameDepartment(id, name) {
    var dept = needDepartment(id);
    var text = freeText(name).trim();
    if (!text) { throw fail('部署名を入力してください。'); }
    dept.name = text;
    saveData();
    return dept;
  }

  // 所属担当者が0のときのみ削除できる（CLAUDE.md 5.8）
  function removeDepartment(id) {
    var dept = needDepartment(id);
    var count = data.members.filter(function (m) { return m.deptId === id; }).length;
    if (count > 0) {
      throw fail('部署「' + dept.name + '」には担当者が' + count +
                 '人います。先に担当者を移動または削除してください。');
    }
    data.departments = data.departments.filter(function (d) { return d.id !== id; });
    saveData();
    return true;
  }

  /* ============================================================
   * 担当者の CRUD（CLAUDE.md 5.8）
   * ============================================================ */

  function addMember(deptId, name, options) {
    needDepartment(deptId);
    var text = freeText(name).trim();
    if (!text) { throw fail('担当者名を入力してください。'); }
    var opts = options || {};
    var member = {
      id: newId(),
      deptId: deptId,
      name: text,
      countText: freeText(opts.countText),
      emoji: freeText(opts.emoji),
      comment: freeText(opts.comment),
      order: nextOrder(data.members)
    };
    data.members.push(member);
    saveData();
    return member;
  }

  /*
   * 担当者の項目を更新する。
   * patch に入れた項目だけが変わります（name / deptId / countText / emoji / comment）。
   */
  function updateMember(id, patch) {
    var member = needMember(id);
    var p = patch || {};

    if (p.name !== undefined) {
      var text = freeText(p.name).trim();
      if (!text) { throw fail('担当者名を入力してください。'); }
      member.name = text;
    }
    if (p.deptId !== undefined) {
      needDepartment(p.deptId);
      member.deptId = p.deptId;
    }
    // 自由項目は空でもよい（CLAUDE.md 4.3）
    if (p.countText !== undefined) { member.countText = freeText(p.countText); }
    if (p.emoji !== undefined) { member.emoji = freeText(p.emoji); }
    if (p.comment !== undefined) { member.comment = freeText(p.comment); }

    saveData();
    return member;
  }

  // 唯一の担当になっている案件が1件でもあれば削除できない（CLAUDE.md 5.8）
  function removeMember(id) {
    var member = needMember(id);
    var sole = soleAssignedProjects(id);
    if (sole.length > 0) {
      var titles = sole.slice(0, 3).map(function (p) { return p.title || '(無題)'; }).join('・');
      throw fail('「' + member.name + '」さんが唯一の担当になっている案件が' + sole.length +
                 '件あります（' + titles + (sole.length > 3 ? ' ほか' : '') +
                 '）。先に案件側で担当を変更してください。');
    }
    // 複数担当の案件からは担当を外す
    data.projects.forEach(function (p) {
      p.assigneeIds = p.assigneeIds.filter(function (a) { return a !== id; });
    });
    data.members = data.members.filter(function (m) { return m.id !== id; });
    saveData();
    return true;
  }

  /* ============================================================
   * 案件・バーの CRUD（CLAUDE.md 5.5〜5.7）
   * ============================================================ */

  // バー1本を作る。初期値は 工程「ラフ」・状態「未着手」・囲い点線なし・今日1日（CLAUDE.md 5.6）
  function createBar() {
    var today = todayDayIndex();
    var range = rangeFromDays(today, today);
    return {
      id: newId(),
      stage: DEFAULT_STAGE,
      stageNo: MIN_STAGE_NO,
      status: DEFAULT_STATUS,
      clsCheck: false,
      markColor: DEFAULT_MARK_COLOR,
      start: range.start,
      end: range.end
    };
  }

  /*
   * 新規案件を作る（CLAUDE.md 5.7）。
   * その担当者に割当済み・タイトル空・バー1本（ラフ/未着手/今日1日）。
   */
  function addProject(memberId) {
    needMember(memberId);
    var project = {
      id: newId(),
      title: '',
      assigneeIds: [memberId],
      hidden: false,
      order: nextOrder(data.projects),
      bars: [createBar()]
    };
    data.projects.push(project);
    saveData();
    return project;
  }

  // 案件のタイトル・非表示を更新する
  function updateProject(id, patch) {
    var project = needProject(id);
    var p = patch || {};
    if (p.title !== undefined) { project.title = freeText(p.title); }
    if (p.hidden !== undefined) { project.hidden = p.hidden === true; }
    saveData();
    return project;
  }

  // 担当者の割当をまとめて置き換える。0名にはできない（CLAUDE.md 4.3）
  function setAssignees(projectId, memberIds) {
    var project = needProject(projectId);
    if (!Array.isArray(memberIds)) {
      throw fail('担当者の指定が正しくありません。');
    }
    var ids = [];
    memberIds.forEach(function (id) {
      needMember(id);
      if (ids.indexOf(id) < 0) { ids.push(id); }
    });
    if (ids.length === 0) {
      throw fail('担当者は最低1名必要です。担当者を選んでください。');
    }
    project.assigneeIds = ids;
    saveData();
    return project;
  }

  // 完了・非表示の切り替え（CLAUDE.md 5.6）
  function toggleHidden(projectId) {
    var project = needProject(projectId);
    project.hidden = !project.hidden;
    saveData();
    return project;
  }

  function removeProject(id) {
    needProject(id);
    data.projects = data.projects.filter(function (p) { return p.id !== id; });
    saveData();
    return true;
  }

  function addBar(projectId) {
    var project = needProject(projectId);
    var bar = createBar();
    project.bars.push(bar);
    saveData();
    return bar;
  }

  /*
   * バーを更新する。patch に入れた項目だけが変わります。
   *   stage / stageNo / status  … 一覧にない値は拒否
   *   clsCheck                  … 囲い点線（CL&S確認中）のON/OFF
   *   startYmd / endYmd         … "YYYY-MM-DD"（画面の日付入力に合わせた形）
   *   start / end               … 半日シリアル値を直接指定する場合
   * MT・入稿・納品は指定にかかわらず1日幅にそろえます（CLAUDE.md 5.5）。
   */
  function updateBar(projectId, barId, patch) {
    var project = needProject(projectId);
    var bar = needBar(project, barId);
    var p = patch || {};

    if (p.stage !== undefined) {
      if (STAGES.indexOf(p.stage) < 0) {
        throw fail('工程は ' + STAGES.join(' / ') + ' のいずれかを選んでください。');
      }
      bar.stage = p.stage;
    }
    if (p.stageNo !== undefined) {
      var no = Math.floor(Number(p.stageNo));
      if (!isFinite(no) || no < MIN_STAGE_NO || no > MAX_STAGE_NO) {
        throw fail(NUMBERED_STAGE + 'の番号は' + MIN_STAGE_NO + '〜' + MAX_STAGE_NO +
                   'で指定してください。');
      }
      bar.stageNo = no;
    }
    if (p.status !== undefined) {
      if (STATUSES.indexOf(p.status) < 0) {
        throw fail('状態は ' + STATUSES.join(' / ') + ' のいずれかを選んでください。');
      }
      bar.status = p.status;
    }
    if (p.clsCheck !== undefined) {
      bar.clsCheck = p.clsCheck === true;
    }
    if (p.markColor !== undefined) {
      if (MARK_COLORS.indexOf(p.markColor) < 0) {
        throw fail('文字色は ' + MARK_COLORS.join(' / ') + ' のいずれかを指定してください。');
      }
      bar.markColor = p.markColor;
    }

    // 日付の指定を通算日数にそろえる
    var startDay = dayIndexFromSerial(bar.start);
    var endDay = dayIndexFromSerial(bar.end);
    var dateChanged = false;

    if (p.startYmd !== undefined) {
      var s = dayIndexFromYmdText(p.startYmd);
      if (s === null) { throw fail('開始日の形式が正しくありません（YYYY-MM-DD）。'); }
      startDay = s;
      dateChanged = true;
    } else if (p.start !== undefined) {
      startDay = dayIndexFromSerial(Math.floor(Number(p.start)));
      dateChanged = true;
    }

    if (p.endYmd !== undefined) {
      var e = dayIndexFromYmdText(p.endYmd);
      if (e === null) { throw fail('終了日の形式が正しくありません（YYYY-MM-DD）。'); }
      endDay = e;
      dateChanged = true;
    } else if (p.end !== undefined) {
      endDay = dayIndexFromSerial(Math.floor(Number(p.end)));
      dateChanged = true;
    }

    // 工程がMT・入稿・納品に変わった場合も1日幅にそろえ直す
    if (dateChanged || p.stage !== undefined) {
      if (!hasBar(bar.stage)) {
        endDay = startDay;
      } else if (endDay < startDay) {
        // 終了日が開始日より前なら1日幅にそろえる
        endDay = startDay;
      }
      var range = rangeFromDays(startDay, endDay);
      bar.start = range.start;
      bar.end = range.end;
    }

    saveData();
    return bar;
  }

  function removeBar(projectId, barId) {
    var project = needProject(projectId);
    needBar(project, barId);
    project.bars = project.bars.filter(function (b) { return b.id !== barId; });
    saveData();
    return true;
  }

  /* ============================================================
   * JSONの書き出し・読み込み（CLAUDE.md 5.9）
   * ファイルのダウンロードや選択は画面側（V1-d）が行います。
   * ============================================================ */

  function exportJson() {
    return JSON.stringify(data, null, 2);
  }

  // ファイル名: sgantt-backup-YYYYMMDD-HHMM.json
  function backupFileName(date) {
    var d = date || new Date();
    return 'sgantt-backup-' +
      d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
  }

  // 読み込みは全置換。migrate に通し、問題があれば例外を投げて現在のデータを残す
  function importJson(text) {
    return setData(text);
  }

  /* ============================================================
   * 公開
   * ============================================================ */

  var Store = {
    // 定数
    AM: AM,
    PM: PM,
    DATA_KEY: DATA_KEY,
    VIEW_KEY: VIEW_KEY,
    DATA_VERSION: DATA_VERSION,
    MIN_DAY_COUNT: MIN_DAY_COUNT,
    MAX_DAY_COUNT: MAX_DAY_COUNT,
    DEFAULT_BACK_DAYS: DEFAULT_BACK_DAYS,
    DEFAULT_DAY_COUNT: DEFAULT_DAY_COUNT,
    STAGES: STAGES,
    ONE_DAY_STAGES: ONE_DAY_STAGES,
    NUMBERED_STAGE: NUMBERED_STAGE,
    MIN_STAGE_NO: MIN_STAGE_NO,
    MAX_STAGE_NO: MAX_STAGE_NO,
    STATUSES: STATUSES,
    MARK_COLORS: MARK_COLORS,
    DEFAULT_STAGE: DEFAULT_STAGE,
    DEFAULT_STATUS: DEFAULT_STATUS,
    DEFAULT_MARK_COLOR: DEFAULT_MARK_COLOR,

    // 日付
    dateFromDayIndex: dateFromDayIndex,
    dayIndexFromDate: dayIndexFromDate,
    dayIndexFromYmd: dayIndexFromYmd,
    serialFromDayIndex: serialFromDayIndex,
    dayIndexFromSerial: dayIndexFromSerial,
    halfFromSerial: halfFromSerial,
    serialFromYmd: serialFromYmd,
    dateFromSerial: dateFromSerial,
    hasBar: hasBar,
    ymdTextFromDayIndex: ymdTextFromDayIndex,
    ymdTextFromSerial: ymdTextFromSerial,
    dayIndexFromYmdText: dayIndexFromYmdText,
    serialFromYmdText: serialFromYmdText,
    todayDayIndex: todayDayIndex,
    todaySerial: todaySerial,
    rangeFromDays: rangeFromDays,
    daysFromRange: daysFromRange,
    barDayCount: barDayCount,
    barLabel: barLabel,

    // 表示状態
    clampDayCount: clampDayCount,
    defaultView: defaultView,
    normalizeView: normalizeView,
    loadView: loadView,
    saveView: saveView,

    // データ
    createEmptyData: createEmptyData,
    migrate: migrate,
    getData: getData,
    setData: setData,
    loadData: loadData,
    saveData: saveData,
    notes: function () { return lastNotes.slice(); },

    // 取得
    findDepartment: findDepartment,
    findMember: findMember,
    findProject: findProject,
    listDepartments: listDepartments,
    listMembers: listMembers,
    listProjects: listProjects,
    soleAssignedProjects: soleAssignedProjects,

    // 部署
    addDepartment: addDepartment,
    renameDepartment: renameDepartment,
    removeDepartment: removeDepartment,

    // 担当者
    addMember: addMember,
    updateMember: updateMember,
    removeMember: removeMember,

    // 案件・バー
    addProject: addProject,
    updateProject: updateProject,
    setAssignees: setAssignees,
    toggleHidden: toggleHidden,
    removeProject: removeProject,
    addBar: addBar,
    updateBar: updateBar,
    removeBar: removeBar,

    // 入出力
    exportJson: exportJson,
    importJson: importJson,
    backupFileName: backupFileName
  };

  global.Store = Store;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Store;
  }

}(typeof window !== 'undefined' ? window : globalThis));
