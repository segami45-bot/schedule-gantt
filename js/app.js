/*
 * app.js — 初期化・イベント結線（CLAUDE.md 7）
 *
 * V1-a時点では期間コントロール（CLAUDE.md 5.2）だけを結線しています。
 */
(function () {
  'use strict';

  var view = null; // { startSerial, dayCount }
  var el = {};     // よく使うDOM要素の置き場

  /* ------------------------------------------------------------
   * 期間の計算
   * ------------------------------------------------------------ */

  // 表示終了日（最終日）の通算日数
  function endDayIndex(v) {
    return Store.dayIndexFromSerial(v.startSerial) + v.dayCount - 1;
  }

  // 入力欄に現在の期間を書き戻す
  function syncInputs() {
    el.start.value = Store.ymdTextFromSerial(view.startSerial);
    el.end.value = Store.ymdTextFromDayIndex(endDayIndex(view));
    el.summary.textContent = view.dayCount + '日間';
  }

  // 期間を確定して保存・再描画する
  function applyView(next) {
    view = Store.saveView(next); // 保存時に 1〜120日 へのクランプが掛かる
    syncInputs();
    Render.draw(el.gantt, view);
  }

  /* ------------------------------------------------------------
   * イベント
   * ------------------------------------------------------------ */

  // 開始日・終了日を直接編集したとき（CLAUDE.md 5.2 任意期間表示）
  function onRangeInput() {
    var startIdx = Store.dayIndexFromYmdText(el.start.value);
    var endIdx = Store.dayIndexFromYmdText(el.end.value);

    // 入力が空・不正なら現在の表示に戻す
    if (startIdx === null || endIdx === null) {
      syncInputs();
      return;
    }

    // 幅は両端を含む日数。終了日が開始日より前なら1日に丸められる
    var dayCount = Store.clampDayCount(endIdx - startIdx + 1);

    applyView({
      startSerial: Store.serialFromDayIndex(startIdx, Store.AM),
      dayCount: dayCount
    });
  }

  // ［7日］［30日］ボタン: 開始日 = 今日の7日前、幅 = 7 / 30（CLAUDE.md 5.2）
  function setPreset(dayCount) {
    applyView({
      startSerial: Store.serialFromDayIndex(
        Store.todayDayIndex() - Store.DEFAULT_BACK_DAYS,
        Store.AM
      ),
      dayCount: dayCount
    });
  }

  /* ------------------------------------------------------------
   * 起動
   * ------------------------------------------------------------ */

  function init() {
    el.start = document.getElementById('rangeStart');
    el.end = document.getElementById('rangeEnd');
    el.btn7 = document.getElementById('range7');
    el.btn30 = document.getElementById('range30');
    el.summary = document.getElementById('rangeSummary');
    el.gantt = document.getElementById('gantt');

    // 前回の表示状態を復元する。無ければ「今日の7日前から30日間」
    view = Store.loadView();
    syncInputs();
    Render.draw(el.gantt, view);

    el.start.addEventListener('change', onRangeInput);
    el.end.addEventListener('change', onRangeInput);
    el.btn7.addEventListener('click', function () { setPreset(7); });
    el.btn30.addEventListener('click', function () { setPreset(30); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
