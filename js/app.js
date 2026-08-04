/*
 * app.js — 初期化・イベント結線（CLAUDE.md 7）
 *
 * V1-c時点では期間コントロール（CLAUDE.md 5.2）と
 * 「非表示を表示」トグル（CLAUDE.md 5.4）を結線しています。
 * 編集ポップアップ・設定モーダルの結線は V1-d で追加します。
 */
(function () {
  'use strict';

  var view = null;         // { startSerial, dayCount, showHidden }
  var el = {};             // よく使うDOM要素の置き場

  /* ------------------------------------------------------------
   * 期間の計算
   * ------------------------------------------------------------ */

  // 表示終了日（最終日）の通算日数
  function endDayIndex(v) {
    return Store.dayIndexFromSerial(v.startSerial) + v.dayCount - 1;
  }

  // 入力欄・ボタンに現在の表示状態を書き戻す
  function syncControls() {
    el.start.value = Store.ymdTextFromSerial(view.startSerial);
    el.end.value = Store.ymdTextFromDayIndex(endDayIndex(view));
    el.toggleHidden.setAttribute('aria-pressed', view.showHidden ? 'true' : 'false');
    el.toggleHidden.classList.toggle('is-on', view.showHidden === true);
  }

  // 表示を描き直す
  function redraw() {
    Render.draw(el.gantt, view, view.showHidden);
  }

  // 表示状態を確定して保存・再描画する
  function applyView(next) {
    view = Store.saveView(next); // 保存時に 1〜120日 へのクランプが掛かる
    syncControls();
    redraw();
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
      syncControls();
      return;
    }

    // 幅は両端を含む日数。終了日が開始日より前なら1日に丸められる
    var dayCount = Store.clampDayCount(endIdx - startIdx + 1);

    applyView({
      startSerial: Store.serialFromDayIndex(startIdx, Store.AM),
      dayCount: dayCount,
      showHidden: view.showHidden
    });
  }

  // 期間をプリセットにそろえる
  // backDays: 開始日を今日から何日前にするか / dayCount: 表示幅
  function setPreset(backDays, dayCount) {
    applyView({
      startSerial: Store.serialFromDayIndex(Store.todayDayIndex() - backDays, Store.AM),
      dayCount: dayCount,
      showHidden: view.showHidden
    });
  }

  // 「非表示を表示」トグル（CLAUDE.md 5.4）
  function toggleHidden() {
    applyView({
      startSerial: view.startSerial,
      dayCount: view.dayCount,
      showHidden: !view.showHidden
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
    el.toggleHidden = document.getElementById('toggleHidden');
    el.legend = document.getElementById('legend');
    el.gantt = document.getElementById('gantt');

    // 保存されているデータと表示状態を読み込む
    Store.loadData();
    view = Store.loadView();

    // 凡例は内容が変わらないので最初に一度だけ描く
    Render.drawLegend(el.legend);

    syncControls();
    redraw();

    el.start.addEventListener('change', onRangeInput);
    el.end.addEventListener('change', onRangeInput);
    // ［7日］: 今日を先頭に7日間 / ［30日］: 今日の7日前から30日間（CLAUDE.md 5.2）
    el.btn7.addEventListener('click', function () { setPreset(0, 7); });
    el.btn30.addEventListener('click', function () { setPreset(Store.DEFAULT_BACK_DAYS, 30); });
    el.toggleHidden.addEventListener('click', toggleHidden);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
