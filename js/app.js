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
   * JSONの書き出し・読み込み（CLAUDE.md 5.9）
   * ------------------------------------------------------------ */

  // sgantt-backup-YYYYMMDD-HHMM.json としてダウンロードする
  function exportData() {
    var blob = new Blob([Store.exportJson()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = Store.backupFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    // すぐ消すとダウンロードが始まらない場合があるので少し待つ
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /*
   * 読み込みの手順（CLAUDE.md 5.9）:
   *   ファイル選択 → migrate() → 「すべて置き換えます」確認 → 全置換
   * migrate で問題が見つかった場合はその場で止め、いまのデータは触りません。
   */
  function onImportFile(e) {
    var file = e.target.files && e.target.files[0];
    // 同じファイルをもう一度選べるように、選択状態は毎回空にする
    e.target.value = '';
    if (!file) { return; }

    var reader = new FileReader();

    reader.onerror = function () {
      window.alert('ファイルを読み取れませんでした。');
    };

    reader.onload = function () {
      var migrated;
      try {
        migrated = Store.migrate(reader.result);
      } catch (err) {
        window.alert('読み込めませんでした。\n\n' + err.message +
                     '\n\n現在のデータはそのまま残しています。');
        return;
      }
      // migrate が自動修正した内容は、置き換える前に控えておく
      var notes = Store.notes();

      var summary = '部署' + migrated.departments.length + '件 / 担当者' +
                    migrated.members.length + '件 / 案件' + migrated.projects.length + '件';
      if (!window.confirm('現在のデータをすべて置き換えます。よろしいですか？\n\n' +
                          '読み込むファイルの内容: ' + summary)) {
        return;
      }

      Store.setData(migrated);
      redraw();

      var message = '読み込みました（' + summary + '）。';
      if (notes.length > 0) {
        message += '\n\n次の点を自動で調整しました:\n・' + notes.join('\n・');
      }
      window.alert(message);
    };

    reader.readAsText(file);
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
    el.openSettings = document.getElementById('openSettings');
    el.exportData = document.getElementById('exportData');
    el.importData = document.getElementById('importData');
    el.importFile = document.getElementById('importFile');
    el.legend = document.getElementById('legend');
    el.gantt = document.getElementById('gantt');

    // 保存されているデータと表示状態を読み込む
    Store.loadData();
    view = Store.loadView();

    // 設定モーダルからデータが変わったら、ガント本体を描き直す
    Popup.init({ onChange: redraw });

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
    el.openSettings.addEventListener('click', Popup.openSettings);
    el.exportData.addEventListener('click', exportData);
    // ［読み込み］は隠したファイル選択を代わりに押す
    el.importData.addEventListener('click', function () { el.importFile.click(); });
    el.importFile.addEventListener('change', onImportFile);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
