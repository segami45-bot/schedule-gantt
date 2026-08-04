/*
 * store.js — データ層（DOM非依存 / CLAUDE.md 7）
 *
 * ブラウザ: <script src="js/store.js"> で読み込むとグローバル変数 Store が使えます。
 * Node.js : require('./js/store.js') で同じものを受け取れます（テスト用）。
 *
 * V1-a時点の実装範囲は次の2つだけです。
 *   (1) 日付 ⇔ 半日シリアル値の変換（CLAUDE.md 4.1）
 *   (2) 表示状態（期間）の localStorage 保存・復元（CLAUDE.md 5.2 / 5.9）
 * 案件データのCRUD・migrate・JSON入出力は V1-b 以降で追加します。
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

  var VIEW_KEY = 'sgantt.view'; // 表示状態の保存キー（CLAUDE.md 5.9）

  var MIN_DAY_COUNT = 1;   // 表示幅の下限（CLAUDE.md 5.2）
  var MAX_DAY_COUNT = 120; // 表示幅の上限（CLAUDE.md 5.2）

  var DEFAULT_BACK_DAYS = 7;   // 初回表示は「今日の7日前」から
  var DEFAULT_DAY_COUNT = 30;  // 初回表示は30日間

  /* ============================================================
   * 日付 ⇔ 半日シリアル値
   *
   * 「通算日数」= 2020-01-01 から数えた日数（2020-01-01 が 0）。
   * 「半日シリアル値」= 通算日数 × 2 + (午前=0 / 午後=1)。
   * タイムゾーンずれを避けるため new Date(y, m-1, d) のローカル日付演算のみを使い、
   * Date.parse / UTC系メソッドは使いません（CLAUDE.md 4.1）。
   * ============================================================ */

  // 基準日のDateを作る
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

  // 年月日 → 通算日数
  function dayIndexFromYmd(year, month, day) {
    return dayIndexFromDate(new Date(year, month - 1, day));
  }

  // 通算日数 + 午前午後 → 半日シリアル値
  function serialFromDayIndex(dayIndex, half) {
    return dayIndex * 2 + (half === PM ? PM : AM);
  }

  // 半日シリアル値 → 通算日数
  function dayIndexFromSerial(serial) {
    return Math.floor(serial / 2);
  }

  // 半日シリアル値 → 午前(0) / 午後(1)
  function halfFromSerial(serial) {
    return ((serial % 2) + 2) % 2; // 負の値でも0か1になるようにする
  }

  // 年月日 → 半日シリアル値（halfを省略すると午前）
  function serialFromYmd(year, month, day, half) {
    return serialFromDayIndex(dayIndexFromYmd(year, month, day), half);
  }

  // 半日シリアル値 → Date
  function dateFromSerial(serial) {
    return dateFromDayIndex(dayIndexFromSerial(serial));
  }

  // 数値を2桁の文字列にする（例: 3 → "03"）
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // 通算日数 → "YYYY-MM-DD"
  function ymdTextFromDayIndex(dayIndex) {
    var d = dateFromDayIndex(dayIndex);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // 半日シリアル値 → "YYYY-MM-DD"（午前午後は落ちます）
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

  // "YYYY-MM-DD" → 半日シリアル値（午前）。不正なら null
  function serialFromYmdText(text, half) {
    var dayIndex = dayIndexFromYmdText(text);
    return dayIndex === null ? null : serialFromDayIndex(dayIndex, half);
  }

  // 今日の通算日数
  function todayDayIndex() {
    return dayIndexFromDate(new Date());
  }

  // 今日の午前の半日シリアル値
  function todaySerial() {
    return serialFromDayIndex(todayDayIndex(), AM);
  }

  /* ============================================================
   * 表示状態（期間）の保存・復元
   *
   * 形: { startSerial: 表示開始日の午前シリアル値, dayCount: 表示日数 }
   * ============================================================ */

  // 表示日数を 1〜120 に収める（CLAUDE.md 5.2）
  function clampDayCount(dayCount) {
    var n = Math.round(Number(dayCount));
    if (!isFinite(n)) { return DEFAULT_DAY_COUNT; }
    if (n < MIN_DAY_COUNT) { return MIN_DAY_COUNT; }
    if (n > MAX_DAY_COUNT) { return MAX_DAY_COUNT; }
    return n;
  }

  // 初期表示: 今日の7日前から30日間（CLAUDE.md 5.2）
  function defaultView() {
    return {
      startSerial: serialFromDayIndex(todayDayIndex() - DEFAULT_BACK_DAYS, AM),
      dayCount: DEFAULT_DAY_COUNT
    };
  }

  // 保存された値が壊れていても落ちないように整える
  function normalizeView(raw) {
    if (!raw || typeof raw !== 'object') { return defaultView(); }
    var startSerial = Number(raw.startSerial);
    if (!isFinite(startSerial)) { return defaultView(); }
    // 表示開始は必ず「その日の午前」に揃える
    startSerial = serialFromDayIndex(dayIndexFromSerial(startSerial), AM);
    return { startSerial: startSerial, dayCount: clampDayCount(raw.dayCount) };
  }

  // localStorageが使えるか（file:// やプライベートモードでの例外を吸収する）
  function storage() {
    try {
      if (typeof localStorage === 'undefined') { return null; }
      return localStorage;
    } catch (e) {
      return null;
    }
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
   * 公開
   * ============================================================ */

  var Store = {
    AM: AM,
    PM: PM,
    VIEW_KEY: VIEW_KEY,
    MIN_DAY_COUNT: MIN_DAY_COUNT,
    MAX_DAY_COUNT: MAX_DAY_COUNT,
    DEFAULT_BACK_DAYS: DEFAULT_BACK_DAYS,
    DEFAULT_DAY_COUNT: DEFAULT_DAY_COUNT,

    dateFromDayIndex: dateFromDayIndex,
    dayIndexFromDate: dayIndexFromDate,
    dayIndexFromYmd: dayIndexFromYmd,
    serialFromDayIndex: serialFromDayIndex,
    dayIndexFromSerial: dayIndexFromSerial,
    halfFromSerial: halfFromSerial,
    serialFromYmd: serialFromYmd,
    dateFromSerial: dateFromSerial,
    ymdTextFromDayIndex: ymdTextFromDayIndex,
    ymdTextFromSerial: ymdTextFromSerial,
    dayIndexFromYmdText: dayIndexFromYmdText,
    serialFromYmdText: serialFromYmdText,
    todayDayIndex: todayDayIndex,
    todaySerial: todaySerial,

    clampDayCount: clampDayCount,
    defaultView: defaultView,
    normalizeView: normalizeView,
    loadView: loadView,
    saveView: saveView
  };

  global.Store = Store;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Store;
  }

}(typeof window !== 'undefined' ? window : globalThis));
