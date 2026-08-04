/*
 * store-test.js — データ層のテスト（CLAUDE.md 7 / 9-3）
 *
 * 実行方法:  node tests/store-test.js
 *
 * V1-a時点では日付変換と表示状態のテストだけです。
 * CRUD・migrate・担当0名拒否のテストは V1-b で追加します。
 */
'use strict';

var Store = require('../js/store.js');

var passed = 0;
var failed = 0;

// 期待値と実際の値を比べる
function is(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log('  NG ' + name + '\n     期待: ' + expected + ' / 実際: ' + actual);
  }
}

function ok(cond, name) {
  is(cond ? true : false, true, name);
}

function group(name) {
  console.log('\n■ ' + name);
}

/* ============================================================
 * 1. 半日シリアル値（CLAUDE.md 4.1 の例をそのまま検証）
 * ============================================================ */
group('半日シリアル値の基本');

is(Store.serialFromYmd(2020, 1, 1, Store.AM), 0, '2020-01-01午前 = 0');
is(Store.serialFromYmd(2020, 1, 1, Store.PM), 1, '2020-01-01午後 = 1');
is(Store.serialFromYmd(2020, 1, 2, Store.AM), 2, '2020-01-02午前 = 2');
is(Store.serialFromYmd(2020, 1, 3, Store.AM), 4, '2020-01-03午前 = 4');

is(Store.dayIndexFromSerial(4802), 2401, '4802 → 通算2401日');
is(Store.halfFromSerial(4802), Store.AM, '4802 は午前');
is(Store.halfFromSerial(4805), Store.PM, '4805 は午後');

// CLAUDE.md 4.2 のJSON例にある bars の start/end
is(Store.ymdTextFromSerial(4802), '2026-07-29', '4802 = 2026-07-29');
is(Store.ymdTextFromSerial(4805), '2026-07-30', '4805 = 2026-07-30');

// 1日幅のバーは end = start + 1（CLAUDE.md 4.1）
var oneDayStart = Store.serialFromYmd(2026, 8, 4, Store.AM);
is(Store.ymdTextFromSerial(oneDayStart + 1), '2026-08-04', '1日幅バーの終端は同じ日');

/* ============================================================
 * 2. 文字列変換
 * ============================================================ */
group('YYYY-MM-DD との相互変換');

is(Store.ymdTextFromSerial(0), '2020-01-01', 'シリアル0 → 2020-01-01');
is(Store.serialFromYmdText('2020-01-01', Store.AM), 0, '2020-01-01 → シリアル0');
is(Store.ymdTextFromDayIndex(Store.dayIndexFromYmd(2026, 12, 31)), '2026-12-31', '年末の往復');
is(Store.ymdTextFromDayIndex(Store.dayIndexFromYmd(2024, 2, 29)), '2024-02-29', 'うるう日の往復');

is(Store.dayIndexFromYmdText('2026-02-31'), null, '存在しない日付はnull');
is(Store.dayIndexFromYmdText('2026-2-3'), null, '桁が足りない形式はnull');
is(Store.dayIndexFromYmdText(''), null, '空文字はnull');
is(Store.dayIndexFromYmdText(null), null, 'null入力はnull');

/* ============================================================
 * 3. 連続する日付の往復（夏時間のある環境でもずれないこと）
 * ============================================================ */
group('連続1200日の往復チェック');

var roundTripNg = 0;
var startIdx = Store.dayIndexFromYmd(2025, 1, 1);
for (var i = 0; i < 1200; i++) {
  var idx = startIdx + i;
  var text = Store.ymdTextFromDayIndex(idx);
  if (Store.dayIndexFromYmdText(text) !== idx) { roundTripNg++; }
}
is(roundTripNg, 0, '1200日ぶんすべて 通算日数 → 文字列 → 通算日数 が一致');

// 連続する通算日数が必ず1日ずつ進むこと
var stepNg = 0;
for (var j = 0; j < 1200; j++) {
  var d1 = Store.dateFromDayIndex(startIdx + j);
  var d2 = Store.dateFromDayIndex(startIdx + j + 1);
  var diff = Math.round((d2 - d1) / 86400000);
  if (diff !== 1) { stepNg++; }
}
is(stepNg, 0, '1200日ぶんすべて隣の日との差が1日');

/* ============================================================
 * 4. 今日
 * ============================================================ */
group('今日の扱い');

var today = new Date();
is(Store.ymdTextFromSerial(Store.todaySerial()),
   today.getFullYear() + '-' +
   ('0' + (today.getMonth() + 1)).slice(-2) + '-' +
   ('0' + today.getDate()).slice(-2),
   'todaySerial は今日の日付を指す');
is(Store.halfFromSerial(Store.todaySerial()), Store.AM, 'todaySerial は午前（偶数）');

/* ============================================================
 * 5. 表示期間のクランプ（CLAUDE.md 5.2 / 1〜120日）
 * ============================================================ */
group('表示期間のクランプ');

is(Store.clampDayCount(30), 30, '30日はそのまま');
is(Store.clampDayCount(1), 1, '1日はそのまま');
is(Store.clampDayCount(120), 120, '120日はそのまま');
is(Store.clampDayCount(0), 1, '0日 → 1日に補正');
is(Store.clampDayCount(-5), 1, 'マイナス → 1日に補正');
is(Store.clampDayCount(121), 120, '121日 → 120日に補正');
is(Store.clampDayCount(9999), 120, '極端な値 → 120日に補正');
is(Store.clampDayCount('abc'), 30, '数値でない値 → 既定の30日');

/* ============================================================
 * 6. 表示状態
 * ============================================================ */
group('表示状態の既定値と正規化');

var def = Store.defaultView();
is(def.dayCount, 30, '初期表示は30日間');
is(Store.dayIndexFromSerial(def.startSerial), Store.todayDayIndex() - 7,
   '初期表示の開始日は今日の7日前');
is(Store.halfFromSerial(def.startSerial), Store.AM, '開始日は午前');

var n1 = Store.normalizeView({ startSerial: 4803, dayCount: 999 });
is(n1.startSerial, 4802, '開始が午後でも午前に揃える');
is(n1.dayCount, 120, '正規化でもクランプが効く');

var n2 = Store.normalizeView(null);
is(n2.dayCount, 30, '壊れた値は既定値に戻す');
var n3 = Store.normalizeView({ startSerial: 'x', dayCount: 10 });
is(n3.dayCount, 30, '開始日が不正なら丸ごと既定値に戻す');

// localStorage の無い Node 上でも例外を出さずに動くこと（CLAUDE.md 2-3 / file:// 対応）
group('localStorageが無い環境での動作');
ok(Store.loadView().dayCount >= 1, 'loadView が落ちずに値を返す');
ok(Store.saveView({ startSerial: 0, dayCount: 5 }).dayCount === 5, 'saveView が落ちずに値を返す');

/* ============================================================
 * 結果
 * ============================================================ */
console.log('\n----------------------------------------');
console.log('成功 ' + passed + ' 件 / 失敗 ' + failed + ' 件');

if (failed > 0) {
  console.log('テストに失敗しました。');
  process.exit(1);
}
console.log('すべて通りました。');
