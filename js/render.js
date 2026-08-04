/*
 * render.js — グリッド・行・バーの描画（CLAUDE.md 7）
 *
 * V1-a時点では日付ヘッダ（CLAUDE.md 5.3）と列の色分けだけを描きます。
 * 案件行・バーの描画は V1-c で追加します。
 */
var Render = (function () {
  'use strict';

  var WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  // 1日ぶんの列情報をまとめる
  function dayInfo(dayIndex, todayIdx) {
    var date = Store.dateFromDayIndex(dayIndex);
    var ymd = Store.ymdTextFromDayIndex(dayIndex);
    var dow = date.getDay(); // 0=日曜 … 6=土曜
    var holidayName = SGANTT_HOLIDAYS[ymd] || null;
    return {
      dayIndex: dayIndex,
      date: date,
      ymd: ymd,
      dow: dow,
      month: date.getMonth() + 1,
      day: date.getDate(),
      holidayName: holidayName,
      isToday: dayIndex === todayIdx,
      // 日曜・祝日は赤系
      isOff: dow === 0 || holidayName !== null,
      // 土曜は水色系。ただし祝日と重なった日は祝日（赤）を優先する
      isSat: dow === 6 && holidayName === null
    };
  }

  // 表示中の全日ぶんの列情報を作る
  function buildDays(view) {
    var startIdx = Store.dayIndexFromSerial(view.startSerial);
    var todayIdx = Store.todayDayIndex();
    var days = [];
    for (var i = 0; i < view.dayCount; i++) {
      days.push(dayInfo(startIdx + i, todayIdx));
    }
    return days;
  }

  // 列に付けるCSSクラスを決める
  // 優先順位: 今日（黄）> 日曜・祝日（赤）> 土曜（水色）
  function cellClass(base, info) {
    var cls = base;
    if (info.isToday) {
      cls += ' is-today';
    } else if (info.isOff) {
      cls += ' is-off';
    } else if (info.isSat) {
      cls += ' is-sat';
    }
    return cls;
  }

  // 日付ヘッダ（CLAUDE.md 5.3）
  function buildCalendar(days) {
    var cal = document.createElement('div');
    cal.className = 'cal';

    days.forEach(function (info) {
      var cell = document.createElement('div');
      cell.className = cellClass('cal__cell', info);

      var date = document.createElement('div');
      date.className = 'cal__date';
      date.textContent = info.month + '/' + info.day;

      var dow = document.createElement('div');
      dow.className = 'cal__dow';
      dow.textContent = WEEKDAY_LABELS[info.dow];

      cell.appendChild(date);
      cell.appendChild(dow);

      // 祝日名はマウスを重ねたときだけ出す（列が狭く、常時表示すると読めないため）
      if (info.holidayName) {
        cell.title = info.ymd + ' ' + info.holidayName;
      } else {
        cell.title = info.ymd;
      }

      cal.appendChild(cell);
    });

    return cal;
  }

  // 本体側の列の背景（今日・土日祝の色を列全体に伸ばすための層）
  function buildStripes(days) {
    var stripes = document.createElement('div');
    stripes.className = 'stripes';

    days.forEach(function (info) {
      var cell = document.createElement('div');
      cell.className = cellClass('stripes__cell', info);
      stripes.appendChild(cell);
    });

    return stripes;
  }

  /*
   * 描画本体。
   * root: 描画先の要素 / view: { startSerial, dayCount }
   */
  function draw(root, view) {
    var days = buildDays(view);

    root.innerHTML = '';
    root.style.setProperty('--day-count', String(view.dayCount));

    // 左: 行ラベル列（案件行は V1-c で入ります）
    var labels = document.createElement('div');
    labels.className = 'gantt__labels';

    var labelHead = document.createElement('div');
    labelHead.className = 'gantt__label-head';
    labelHead.textContent = '担当者 / 案件';
    labels.appendChild(labelHead);

    var labelBody = document.createElement('div');
    labelBody.className = 'gantt__label-body';
    // V1-c で案件行に置き換わる仮の案内
    labelBody.innerHTML = '<p class="placeholder">案件行はV1-cで実装します。</p>';
    labels.appendChild(labelBody);

    // 右: 横スクロールする日付グリッド
    var scroll = document.createElement('div');
    scroll.className = 'gantt__scroll';

    var grid = document.createElement('div');
    grid.className = 'gantt__grid';
    grid.appendChild(buildCalendar(days));

    var rows = document.createElement('div');
    rows.className = 'gantt__rows';
    rows.appendChild(buildStripes(days));
    grid.appendChild(rows);

    scroll.appendChild(grid);

    root.appendChild(labels);
    root.appendChild(scroll);
  }

  return {
    draw: draw,
    buildDays: buildDays
  };
}());
