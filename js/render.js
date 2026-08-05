/*
 * render.js — グリッド・行・バーの描画（CLAUDE.md 7）
 *
 * 左の行ラベル列と右の日付グリッドは、同じ順番・同じ高さの行を並べることで
 * 横の位置をそろえています（行の高さは css/style.css で決めています）。
 */
var Render = (function () {
  'use strict';

  var WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  // 状態（CLAUDE.md 4.3）→ CSSクラス名。色は css/style.css 側で持ちます（CLAUDE.md 6.1）
  var STATUS_KEYS = {
    '未着手': 'todo',
    '制作中': 'wip',
    '校了': 'ok',
    '25': 'p25',
    '50': 'p50',
    '75': 'p75'
  };

  // バーを持たない工程（CLAUDE.md 3）→ CSSクラス名。文字色は工程で固定（CLAUDE.md 6.2）
  var MARK_KEYS = {
    'MT': 'mt',
    '入稿': 'nyuko',
    '納品': 'nohin'
  };

  /*
   * 画面に出す状態名。
   * データ上は "25" ですが、表示は CLAUDE.md 3・6 にあわせて "25%" とします。
   */
  var STATUS_LABELS = {
    '25': '25%',
    '50': '50%',
    '75': '75%'
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  /* ============================================================
   * 小道具
   * ============================================================ */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  /* ============================================================
   * 日付ヘッダと列の色分け（CLAUDE.md 5.3）
   * ============================================================ */

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

  function buildDays(view) {
    var startIdx = Store.dayIndexFromSerial(view.startSerial);
    var todayIdx = Store.todayDayIndex();
    var days = [];
    for (var i = 0; i < view.dayCount; i++) {
      days.push(dayInfo(startIdx + i, todayIdx));
    }
    return days;
  }

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

  function buildCalendar(days) {
    var cal = el('div', 'cal');
    days.forEach(function (info) {
      var cell = el('div', cellClass('cal__cell', info));
      cell.appendChild(el('div', 'cal__date', info.month + '/' + info.day));
      cell.appendChild(el('div', 'cal__dow', WEEKDAY_LABELS[info.dow]));
      cal.appendChild(cell);
    });
    return cal;
  }

  // 今日・土日祝の色を列全体に伸ばすための背景層
  function buildStripes(days) {
    var stripes = el('div', 'stripes');
    days.forEach(function (info) {
      stripes.appendChild(el('div', cellClass('stripes__cell', info)));
    });
    return stripes;
  }

  /* ============================================================
   * バー（CLAUDE.md 5.5）
   * ============================================================ */

  /*
   * バーの位置と幅を、表示期間に対する割合（%）で求めます。
   * 列幅が画面に応じて伸び縮みするため、pxではなく%で置いています。
   * 表示期間から完全に外れているバーは null を返します。
   */
  function barGeometry(bar, viewStartDay, dayCount) {
    var startDay = Store.dayIndexFromSerial(bar.start);
    var endDay = Store.dayIndexFromSerial(bar.end);
    var viewEndDay = viewStartDay + dayCount - 1;

    // 表示範囲ではみ出した部分を切り取る
    var from = Math.max(startDay, viewStartDay);
    var to = Math.min(endDay, viewEndDay);
    if (to < from) { return null; }

    return {
      left: (from - viewStartDay) / dayCount * 100,
      width: (to - from + 1) / dayCount * 100
    };
  }

  function buildBar(bar, viewStartDay, dayCount) {
    var geo = barGeometry(bar, viewStartDay, dayCount);
    if (!geo) { return null; }

    var node;
    if (Store.hasBar(bar.stage)) {
      // 文字ラベル = 工程 / 背景色 = 状態 の二軸（CLAUDE.md 5.5）
      var statusKey = STATUS_KEYS[bar.status] || 'todo';
      node = el('div', 'bar bar--' + statusKey, Store.barLabel(bar));
      // 囲い点線 = CL&S確認中（CLAUDE.md 5.5）
      if (bar.clsCheck) { node.className += ' is-cls'; }
    } else {
      // MT・入稿・納品はバーを描かず文字ラベルのみ（CLAUDE.md 5.5）
      node = el('div', 'bar bar--mark mark--' + MARK_KEYS[bar.stage], Store.barLabel(bar));
    }

    node.style.left = geo.left + '%';
    node.style.width = geo.width + '%';
    return node;
  }

  /* ============================================================
   * 行（CLAUDE.md 5.4）
   *
   * 左右で同じ行を並べるため、行の作成を1か所にまとめています。
   * rows には { kind, project } を積み、左右それぞれが同じ順で描きます。
   * ============================================================ */

  /*
   * 表示する行の並びを組み立てます。
   * 部署 > 担当者 > 案件 の3階層。複数担当の案件は各担当者の下に同じ内容で並びます。
   */
  function buildRowList(showHidden) {
    var rows = [];
    Store.listDepartments().forEach(function (dept) {
      rows.push({ kind: 'dept', dept: dept });
      Store.listMembers(dept.id).forEach(function (member) {
        rows.push({ kind: 'member', member: member });
        Store.listProjects(member.id, showHidden).forEach(function (project) {
          rows.push({ kind: 'project', project: project, member: member });
        });
      });
    });
    return rows;
  }

  // 行に共通で付けるクラス（hidden の案件は半透明にする / CLAUDE.md 5.4）
  function rowClass(row) {
    var cls = 'row row--' + row.kind;
    if (row.kind === 'project' && row.project.hidden) { cls += ' is-hidden-row'; }
    return cls;
  }

  // 左側: 部署名・担当者・案件タイトル
  function buildLabelRow(row, handlers) {
    var node = el('div', rowClass(row));

    if (row.kind === 'dept') {
      node.appendChild(el('span', 'dept__name', row.dept.name));
      return node;
    }

    if (row.kind === 'member') {
      var m = row.member;
      // 名前（countText）emoji comment を横並び（CLAUDE.md 5.4）
      node.appendChild(el('span', 'member__name', m.name));
      if (m.countText) { node.appendChild(el('span', 'member__count', '（' + m.countText + '）')); }
      if (m.emoji) { node.appendChild(el('span', 'member__emoji', m.emoji)); }
      if (m.comment) { node.appendChild(el('span', 'member__comment', m.comment)); }

      // 行末に新規案件追加の「＋」ボタン（CLAUDE.md 5.4 / 5.7）
      if (handlers.onAddProject) {
        var add = el('button', 'member__add', '＋');
        add.type = 'button';
        add.title = m.name + 'さんに案件を追加';
        add.addEventListener('click', function (e) {
          e.stopPropagation();
          handlers.onAddProject(m.id);
        });
        node.appendChild(add);
      }
      return node;
    }

    // 案件行。表示するのはタイトルのみ（内部IDは出さない / CLAUDE.md 4.3）
    var title = row.project.title || '(無題)';
    var titleNode = el('span', 'project__title', title);
    if (!row.project.title) { titleNode.className += ' is-untitled'; }
    node.appendChild(titleNode);
    return node;
  }

  // 右側: 案件行にはバーを置き、部署・担当者の行は空にする
  function buildGridRow(row, viewStartDay, dayCount) {
    var node = el('div', rowClass(row));
    if (row.kind !== 'project') { return node; }

    // 開始日順に描き、重なった部分は後のバーが前面になる（CLAUDE.md 5.5）
    var bars = row.project.bars.slice().sort(function (a, b) { return a.start - b.start; });
    bars.forEach(function (bar) {
      var barNode = buildBar(bar, viewStartDay, dayCount);
      if (barNode) { node.appendChild(barNode); }
    });
    return node;
  }

  /* ============================================================
   * 描画本体
   *
   * root: 描画先の要素
   * view: { startSerial, dayCount }
   * options:
   *   showHidden     … 非表示の案件も出すか（CLAUDE.md 5.4）
   *   onOpenProject  … 案件行・バーがクリックされたとき（CLAUDE.md 5.6）
   *   onAddProject   … 担当者ヘッダの「＋」が押されたとき（CLAUDE.md 5.7）
   * ============================================================ */
  function draw(root, view, options) {
    var opts = options || {};
    var showHidden = opts.showHidden === true;
    var days = buildDays(view);
    var viewStartDay = Store.dayIndexFromSerial(view.startSerial);
    var rows = buildRowList(showHidden);

    // 案件行・バーのクリックで編集ポップアップを開く（CLAUDE.md 5.6）
    function makeClickable(node, project) {
      if (!opts.onOpenProject) { return; }
      node.classList.add('is-clickable');
      node.addEventListener('click', function () { opts.onOpenProject(project.id); });
    }

    root.innerHTML = '';
    root.style.setProperty('--day-count', String(view.dayCount));

    /* ---- 左: 行ラベル列 ---- */
    var labels = el('div', 'gantt__labels');
    labels.appendChild(el('div', 'gantt__label-head', '担当者 / 案件'));

    var labelBody = el('div', 'gantt__label-body');
    if (rows.length === 0) {
      labelBody.appendChild(el('p', 'placeholder',
        '部署と担当者がまだ登録されていません。右上の［設定］から登録してください。'));
    } else {
      rows.forEach(function (row) {
        var node = buildLabelRow(row, opts);
        if (row.kind === 'project') { makeClickable(node, row.project); }
        labelBody.appendChild(node);
      });
    }
    labels.appendChild(labelBody);

    /* ---- 右: 横スクロールする日付グリッド ---- */
    var scroll = el('div', 'gantt__scroll');
    var grid = el('div', 'gantt__grid');
    grid.appendChild(buildCalendar(days));

    var body = el('div', 'gantt__rows');
    body.appendChild(buildStripes(days)); // 列の色（背面）

    var rowsNode = el('div', 'rows');       // 行とバー（前面）
    rows.forEach(function (row) {
      var node = buildGridRow(row, viewStartDay, view.dayCount);
      if (row.kind === 'project') { makeClickable(node, row.project); }
      rowsNode.appendChild(node);
    });
    body.appendChild(rowsNode);

    grid.appendChild(body);
    scroll.appendChild(grid);

    root.appendChild(labels);
    root.appendChild(scroll);
  }

  /* ============================================================
   * 凡例（CLAUDE.md 5.1 / 6）
   * 状態の一覧は Store から取るため、状態が増減しても自動で追随します。
   * 末尾に囲い点線（CL&S確認中）の見本を並べます。
   * ============================================================ */
  function drawLegend(root) {
    root.innerHTML = '';
    root.appendChild(el('span', 'legend__title', '状態'));

    Store.STATUSES.forEach(function (status) {
      var item = el('span', 'legend__item');
      // 色見本はバーと同じクラスを使うので、色を直せば凡例も一緒に変わります
      item.appendChild(el('span', 'legend__swatch bar--' + STATUS_KEYS[status]));
      item.appendChild(el('span', 'legend__label', statusLabel(status)));
      root.appendChild(item);
    });

    /*
     * 囲い点線の見本（色の軸とは別なので区切りを入れる）。
     * 実際のバーでは点線の色が状態ごとに変わるため、見本は特定の色に寄せず
     * 塗りなし・グレーの点線にしています。
     */
    var cls = el('span', 'legend__item legend__item--sep');
    cls.appendChild(el('span', 'legend__swatch legend__swatch--cls'));
    cls.appendChild(el('span', 'legend__label', 'CL&S確認中'));
    root.appendChild(cls);
  }

  return {
    draw: draw,
    drawLegend: drawLegend,
    buildDays: buildDays,
    buildRowList: buildRowList,
    barGeometry: barGeometry,
    statusLabel: statusLabel,
    STATUS_KEYS: STATUS_KEYS
  };
}());
