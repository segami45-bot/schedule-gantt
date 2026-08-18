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

  /*
   * 文字ラベル工程（CLAUDE.md 3）→ CSSクラス名。既定の文字色は工程ごとに固定（CLAUDE.md 6.2）。
   * MT は文字ラベルを描かずセル背景で表すため、ここには入れません（CLAUDE.md 5.12）。
   */
  var MARK_KEYS = {
    '入稿': 'nyuko',
    '納品': 'nohin',
    'TW': 'tw',
    '有休': 'yukyu'
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
      isSat: dow === 6 && holidayName === null,
      // 社休日（会社の休業日 / CLAUDE.md 5.3）。日付ヘッダには出さない
      isCompanyOff: Store.isCompanyHoliday(dayIndex)
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

  /*
   * 日付ヘッダのセルに付けるクラス（CLAUDE.md 5.3）。
   * 優先順位: 今日（黄）> 日曜・祝日（赤）> 土曜（水色）。
   * 社休日はここに含めません。暦の上では平日だと分かるようにするためです。
   */
  function calCellClass(info) {
    var cls = 'cal__cell';
    if (info.isToday) {
      cls += ' is-today';
    } else if (info.isOff) {
      cls += ' is-off';
    } else if (info.isSat) {
      cls += ' is-sat';
    }
    return cls;
  }

  /*
   * 列の色（日付ヘッダを除く列全体）に付けるクラス（CLAUDE.md 5.3）。
   * 社休日は日曜・祝日と同じ赤系にし、土曜と重なった日は赤系を優先します。
   */
  function stripeCellClass(info) {
    var cls = 'stripes__cell';
    if (info.isToday) {
      cls += ' is-today';
    } else if (info.isOff || info.isCompanyOff) {
      cls += ' is-off';
    } else if (info.isSat) {
      cls += ' is-sat';
    }
    return cls;
  }

  function buildCalendar(days) {
    var cal = el('div', 'cal');
    days.forEach(function (info) {
      var cell = el('div', calCellClass(info));
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
      stripes.appendChild(el('div', stripeCellClass(info)));
    });
    return stripes;
  }

  /* ============================================================
   * バー（CLAUDE.md 5.5）
   * ============================================================ */

  /*
   * 開始日・終了日（通算日数）から、表示期間に対する位置と幅を割合（%）で求めます。
   * 列幅が画面に応じて伸び縮みするため、pxではなく%で置いています。
   * 表示期間から完全に外れている場合は null を返します。
   */
  function geometryFromDays(startDay, endDay, viewStartDay, dayCount) {
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

  /*
   * 案件行のどのセル（日）がクリックされたかを求めます（CLAUDE.md 5.5 の空白セルのクリック）。
   * 5.11 のポップアップをそのセルの近くに出すため、画面上の位置もあわせて返します。
   * 列幅は画面に応じて伸び縮みするので、そのつど実測します。
   */
  function cellFromClick(rowNode, clientX, viewStartDay, dayCount) {
    var rect = rowNode.getBoundingClientRect();
    if (rect.width <= 0 || dayCount <= 0) { return null; }

    var colWidth = rect.width / dayCount;
    var col = Math.floor((clientX - rect.left) / colWidth);
    if (col < 0) { col = 0; }
    if (col > dayCount - 1) { col = dayCount - 1; }

    var left = rect.left + col * colWidth;
    return {
      dayIndex: viewStartDay + col,
      // getBoundingClientRect() と同じ形にしておき、ポップアップ側で同じように扱えるようにする
      rect: {
        left: left,
        right: left + colWidth,
        top: rect.top,
        bottom: rect.bottom,
        width: colWidth,
        height: rect.height
      }
    };
  }

  /*
   * その案件行のその日に、バーが1本でも描かれているか（CLAUDE.md 5.5 の「空白セル」の定義）。
   * 1本でもあればそのセルは空白ではないので、新規バーは作りません。
   */
  function hasBarOnDay(project, dayIndex) {
    return project.bars.some(function (bar) {
      return Store.dayIndexFromSerial(bar.start) <= dayIndex &&
             dayIndex <= Store.dayIndexFromSerial(bar.end);
    });
  }

  function barGeometry(bar, viewStartDay, dayCount) {
    return geometryFromDays(
      Store.dayIndexFromSerial(bar.start),
      Store.dayIndexFromSerial(bar.end),
      viewStartDay,
      dayCount
    );
  }

  function buildBar(bar, viewStartDay, dayCount, project) {
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
      /*
       * MT は文字ラベルを描かず、その案件行の該当日セルに背景色を敷く（CLAUDE.md 5.12）。
       * バーとしての当たり判定（クリック＝5.11 / ドラッグ移動）はそのまま残すため、
       * 中身のない1日幅のバーとして置き、CSSでセル全体を塗ります。
       * 文字が無いので、何の日かはホバー時のツールチップで補います（CLAUDE.md 5.12）。
       */
      node = el('div', 'bar bar--mtcell');
      node.title = 'MT（打ち合わせ）';
    }

    node.style.left = geo.left + '%';
    node.style.width = geo.width + '%';

    // ドラッグ移動（CLAUDE.md 5.10 / ロードマップV2-a）
    attachBarDrag(node, bar, project);
    return node;
  }

  /*
   * 文字ラベル工程（MT以外）を2つの要素に分けて作ります（CLAUDE.md 5.11）。
   *   hit   … 1日ぶんの透明な当たり判定。色付きバーより後ろに置く
   *   label … 文字ラベル。色付きバーより前に置き、重なっても読めるようにする
   *
   * こう分けるのは「見えているものが押せる」ようにするためです。
   * 色付きバーが重なっている部分は色付きバーが押され、
   * 何も描かれていない部分と文字の上は文字ラベル工程が押されます。
   * どちらを掴んでも同じバーが動くよう、2つをまとめてドラッグ対象にします。
   */
  function buildMarkBar(bar, viewStartDay, dayCount, project) {
    var geo = barGeometry(bar, viewStartDay, dayCount);
    if (!geo) { return null; }

    var hit = el('div', 'bar bar--markhit');

    // 文字色は工程ごとの既定色か白（CLAUDE.md 6.2）
    var markKey = bar.markColor === 'white' ? 'white' : MARK_KEYS[bar.stage];
    var label = el('div', 'bar bar--mark mark--' + markKey);
    label.appendChild(el('span', 'bar__hit', Store.barLabel(bar)));

    var nodes = [hit, label];
    nodes.forEach(function (node) {
      node.style.left = geo.left + '%';
      node.style.width = geo.width + '%';
      // 2要素を1本のバーとして動かす（CLAUDE.md 5.10）
      attachBarDrag(node, bar, project, nodes);
    });

    return { hit: hit, label: label };
  }

  /* ============================================================
   * バーのドラッグ操作（CLAUDE.md 5.10 / ロードマップV2-a・V2-b）
   *
   * バー本体を掴めば移動、色付きバーの左右端を掴めば伸縮します。
   * ============================================================ */

  // pointerdown からこの距離以上動いたらドラッグ、未満はクリック（CLAUDE.md 5.10）
  var DRAG_THRESHOLD_PX = 4;

  // 伸縮の掴みしろ（CLAUDE.md 5.10）
  var HANDLE_PX = 6;        // 通常の掴みしろ幅
  var HANDLE_NARROW = 24;   // これ未満のバーは掴みしろを 1/4 に縮める
  var HANDLE_NONE = 12;     // これ未満のバーは掴みしろを置かない（伸縮不可）

  /*
   * バーの描画幅に応じた掴みしろ幅（px）を返します（CLAUDE.md 5.10 掴みしろの縮退）。
   * 列幅が狭いときに掴みしろがバー本体を覆い尽くすのを防ぎます。
   */
  function handleWidth(barWidthPx) {
    if (barWidthPx < HANDLE_NONE) { return 0; }
    if (barWidthPx < HANDLE_NARROW) { return barWidthPx / 4; }
    return HANDLE_PX;
  }

  /*
   * ポインタがバーのどこを掴んだかを返します。
   *   'start' … 左端（開始日を変える） / 'end' … 右端（終了日を変える） / null … 本体（移動）
   * 伸縮できるのは色付きバーだけ。MT・入稿・納品は常に1日幅なので移動のみです。
   */
  function resizeZone(node, bar, clientX) {
    if (!Store.hasBar(bar.stage)) { return null; }
    var rect = node.getBoundingClientRect();
    var handle = handleWidth(rect.width);
    if (handle <= 0) { return null; }
    if (clientX - rect.left <= handle) { return 'start'; }
    if (rect.right - clientX <= handle) { return 'end'; }
    return null;
  }

  // draw のたびに更新する、ドラッグ計算に必要な描画条件
  var dragCtx = { viewStartDay: 0, dayCount: 0, onBarChange: null, onOpenBar: null };

  var dragState = null;      // ドラッグ中だけ値が入る
  var swallowNextClick = false; // ドラッグ直後のクリックでポップアップを開かないための印

  /*
   * 動かせる日数の範囲を求めます（CLAUDE.md 5.10「表示期間の外へはドラッグできない」）。
   *
   * すでに表示期間からはみ出しているバーを、いきなり期間内へ引き込むと
   * 「少し動かしたつもりが大きく動いた」ことになるため、はみ出している向きへ
   * さらに動かすことだけを禁じ、期間内へ戻す向きには動かせるようにしています。
   * 表示期間より長いバーは動かせません（下限=上限=0）。
   */
  function dragLimits(startDay, endDay, viewStartDay, dayCount) {
    var viewEndDay = viewStartDay + dayCount - 1;
    return {
      lower: Math.min(viewStartDay - startDay, 0),
      upper: Math.max(viewEndDay - endDay, 0)
    };
  }

  /*
   * 掴んだ場所ごとに、動かせる日数の範囲を求めます。
   *   'move'  … バー全体（移動）
   *   'start' … 左端。最小幅1日を保つため、終了日を越えては動かせない
   *   'end'   … 右端。最小幅1日を保つため、開始日より前へは動かせない
   * どの場合も、表示期間の外へは出せません（CLAUDE.md 5.10）。
   */
  function edgeLimits(mode, startDay, endDay, viewStartDay, dayCount) {
    if (mode === 'start') {
      var s = dragLimits(startDay, startDay, viewStartDay, dayCount);
      // 開始と終了が交差する操作は1日幅でクランプ（CLAUDE.md 5.10）
      return { lower: s.lower, upper: Math.min(s.upper, endDay - startDay) };
    }
    if (mode === 'end') {
      var e = dragLimits(endDay, endDay, viewStartDay, dayCount);
      return { lower: Math.max(e.lower, startDay - endDay), upper: e.upper };
    }
    return dragLimits(startDay, endDay, viewStartDay, dayCount);
  }

  // 1日ぶんの列幅（px）。列は画面に応じて伸縮するので実測する
  function dayWidthPx(node) {
    var row = node.parentNode;
    if (!row || dragCtx.dayCount <= 0) { return 0; }
    return row.getBoundingClientRect().width / dragCtx.dayCount;
  }

  /*
   * ドラッグ中の見た目を、仮の位置に合わせて動かす。
   * nodes は1本のバーを構成する要素の一覧（文字ラベル工程は当たり判定と文字の2つ）。
   */
  function applyDragVisual(nodes, startDay, endDay) {
    var geo = geometryFromDays(startDay, endDay, dragCtx.viewStartDay, dragCtx.dayCount);
    if (!geo) { return; }
    nodes.forEach(function (node) {
      node.style.left = geo.left + '%';
      node.style.width = geo.width + '%';
    });
  }

  // 掴んだ場所と動かした日数から、仮の開始日・終了日を求める
  function previewDays(s) {
    if (s.mode === 'start') { return { start: s.startDay + s.delta, end: s.endDay }; }
    if (s.mode === 'end') { return { start: s.startDay, end: s.endDay + s.delta }; }
    return { start: s.startDay + s.delta, end: s.endDay + s.delta };
  }

  function endDrag() {
    if (!dragState) { return; }
    if (dragState.moved) {
      dragState.nodes.forEach(function (node) { node.classList.remove('is-dragging'); });
      document.body.classList.remove('is-dragging-bar');
      document.body.classList.remove('is-resizing-bar');
    }
    try {
      dragState.node.releasePointerCapture(dragState.pointerId);
    } catch (e) { /* すでに解放済みなら何もしない */ }
    document.removeEventListener('keydown', onDragKeyDown, true);
    dragState = null;
  }

  // Escキーで取り消し、元の位置に戻す（CLAUDE.md 5.10）
  function onDragKeyDown(e) {
    if (!dragState || e.key !== 'Escape') { return; }
    var s = dragState;
    applyDragVisual(s.nodes, s.startDay, s.endDay);
    if (s.moved) { swallowNextClick = true; }
    endDrag();
    e.preventDefault();
    e.stopPropagation();
  }

  function onDragPointerMove(e) {
    if (!dragState) { return; }
    var s = dragState;
    var dx = e.clientX - s.originX;

    if (!s.moved) {
      var dy = e.clientY - s.originY;
      // 縦揺れも「動いた」に数え、意図しないポップアップ表示を防ぐ
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) { return; }
      s.moved = true;
      s.nodes.forEach(function (node) { node.classList.add('is-dragging'); });
      document.body.classList.add(s.mode === 'move' ? 'is-dragging-bar' : 'is-resizing-bar');
    }

    // 日単位スナップ。行をまたぐ縦移動はしない（CLAUDE.md 5.10）
    var width = dayWidthPx(s.node);
    var days = width > 0 ? Math.round(dx / width) : 0;
    days = Math.min(Math.max(days, s.limits.lower), s.limits.upper);

    if (days !== s.delta) {
      s.delta = days;
      var next = previewDays(s);
      applyDragVisual(s.nodes, next.start, next.end);
    }
  }

  function onDragPointerUp() {
    if (!dragState) { return; }
    var s = dragState;
    var moved = s.moved;
    var delta = s.delta;
    var next = previewDays(s);
    endDrag();

    if (!moved) { return; } // クリック扱い。click イベント側でポップアップが開く

    swallowNextClick = true;

    if (delta === 0) {
      // 位置も長さも変わっていないので保存しない（見た目も元のまま）
      return;
    }

    // pointerup で確定・自動保存（CLAUDE.md 5.10）
    try {
      Store.updateBar(s.projectId, s.bar.id, {
        startYmd: Store.ymdTextFromDayIndex(next.start),
        endYmd: Store.ymdTextFromDayIndex(next.end)
      });
    } catch (err) {
      window.alert(err.message);
    }
    // 同じ案件が複数の担当者の下に出ている場合もそろえるため、全体を描き直す
    if (dragCtx.onBarChange) { dragCtx.onBarChange(); }
  }

  /*
   * バーにドラッグ操作を付けます。
   * nodes は1本のバーを構成する要素の一覧（省略時は node 自身だけ）。
   * 文字ラベル工程は「当たり判定」と「文字」の2要素なので、両方をまとめて渡します。
   */
  function attachBarDrag(node, bar, project, nodes) {
    if (!project) { return; }
    var group = nodes || [node];

    node.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || dragState) { return; } // 左ボタンのみ
      var startDay = Store.dayIndexFromSerial(bar.start);
      var endDay = Store.dayIndexFromSerial(bar.end);
      // 左右端を掴んだら伸縮、それ以外は移動（CLAUDE.md 5.10）
      var mode = resizeZone(node, bar, e.clientX) || 'move';

      dragState = {
        node: node,
        nodes: group,
        bar: bar,
        projectId: project.id,
        pointerId: e.pointerId,
        mode: mode,
        originX: e.clientX,
        originY: e.clientY,
        startDay: startDay,
        endDay: endDay,
        limits: edgeLimits(mode, startDay, endDay, dragCtx.viewStartDay, dragCtx.dayCount),
        delta: 0,
        moved: false
      };

      swallowNextClick = false;
      node.setPointerCapture(e.pointerId);
      document.addEventListener('keydown', onDragKeyDown, true);
      e.preventDefault(); // 文字選択を防ぐ
    });

    // 端に乗せたら左右矢印カーソルにする（CLAUDE.md 5.10）
    node.addEventListener('pointermove', function (e) {
      if (dragState) { return; } // ドラッグ中は onDragPointerMove が担当
      node.style.cursor = resizeZone(node, bar, e.clientX) ? 'ew-resize' : '';
    });

    node.addEventListener('pointerleave', function () {
      if (!dragState) { node.style.cursor = ''; }
    });

    node.addEventListener('pointermove', onDragPointerMove);
    node.addEventListener('pointerup', onDragPointerUp);
    node.addEventListener('pointercancel', function () {
      if (!dragState) { return; }
      var s = dragState;
      applyDragVisual(s.nodes, s.startDay, s.endDay);
      endDrag();
      node.style.cursor = '';
    });

    /*
     * バーのクリックは工程バー個別ポップアップを開く（CLAUDE.md 5.11）。
     * ドラッグしたときは開かない。行のクリック（＝案件ポップアップ）にも伝えない。
     */
    node.addEventListener('click', function (e) {
      e.stopPropagation(); // 行のクリックは起こさない（CLAUDE.md 5.11）
      if (swallowNextClick) {
        swallowNextClick = false;
        e.preventDefault();
        return;
      }
      if (dragCtx.onOpenBar) { dragCtx.onOpenBar(project.id, bar.id, node); }
    });
  }

  /* ============================================================
   * 行（CLAUDE.md 5.4）
   *
   * 左右で同じ行を並べるため、行の作成を1か所にまとめています。
   * rows には { kind, project } を積み、左右それぞれが同じ順で描きます。
   * ============================================================ */

  /*
   * 表示する行の並びを組み立てます。
   * 部署 > 担当者 > 案件 の3階層。案件は必ず1名の担当者に属します（CLAUDE.md 3）。
   */
  function buildRowList(showHidden) {
    var rows = [];
    Store.listDepartments().forEach(function (dept) {
      rows.push({ kind: 'dept', dept: dept });
      Store.listMembers(dept.id).forEach(function (member) {
        rows.push({ kind: 'member', member: member });
        // index / total は案件の▲▼の有効・無効に使う（CLAUDE.md 5.14）
        var projects = Store.listProjects(member.id, showHidden);
        projects.forEach(function (project, i) {
          rows.push({
            kind: 'project', project: project, member: member,
            index: i, total: projects.length
          });
        });
      });
    });
    return rows;
  }

  /* ============================================================
   * TW・有休の日ハイライト（CLAUDE.md 5.12）
   *
   * 担当者ごとに、その人の案件に置かれた TW / 有休 のバーから
   * 「その日は在宅／休み」という日の集合を作ります。
   * 専用のデータは持たず、毎回バーから導出するので、
   * バーの追加・移動・削除に自動で追従します。
   * ============================================================ */

  var TW_STAGE = 'TW';
  var YUKYU_STAGE = '有休';

  /*
   * 担当者ID → { tw: {通算日数: true}, yukyu: {…} } を作ります。
   * showHidden が false のときは、非表示の案件に置かれたバーを数えません。
   */
  function buildDayMarks(showHidden) {
    var marks = {};

    Store.listMembers().forEach(function (member) {
      var tw = {};
      var yukyu = {};

      Store.listProjects(member.id, showHidden).forEach(function (project) {
        project.bars.forEach(function (bar) {
          if (bar.stage !== TW_STAGE && bar.stage !== YUKYU_STAGE) { return; }
          // TW・有休は常に1日幅だが、念のため期間ぶんを塗る
          var from = Store.dayIndexFromSerial(bar.start);
          var to = Store.dayIndexFromSerial(bar.end);
          for (var day = from; day <= to; day++) {
            if (bar.stage === YUKYU_STAGE) { yukyu[day] = true; } else { tw[day] = true; }
          }
        });
      });

      marks[member.id] = { tw: tw, yukyu: yukyu };
    });

    return marks;
  }

  /*
   * 案件行に敷くセル背景の層を作ります。
   * 色は1色のみ（重ね塗りしない）。優先順位は 有休 ＞ TW ＞ 今日 ＞ 土日祝（CLAUDE.md 5.12）。
   * この層は列色（.stripes）より前面にあるので、塗った日は今日の黄色や土日祝の色を隠します。
   * 塗る日が1日も無ければ null を返し、余分な要素を作りません。
   */
  function buildDayFill(days, mark) {
    if (!mark) { return null; }

    var layer = el('div', 'dayfill');
    var painted = false;

    days.forEach(function (info) {
      var cell = el('div', 'dayfill__cell');
      // 同じ日にTWと有休が重なったら有休を優先（CLAUDE.md 5.12）
      if (mark.yukyu[info.dayIndex]) {
        cell.className += ' is-yukyu';
        painted = true;
      } else if (mark.tw[info.dayIndex]) {
        cell.className += ' is-tw';
        painted = true;
      }
      layer.appendChild(cell);
    });

    return painted ? layer : null;
  }

  // 行に共通で付けるクラス（hidden の案件は半透明にする / CLAUDE.md 5.4）
  function rowClass(row) {
    var cls = 'row row--' + row.kind;
    if (row.kind === 'project' && row.project.hidden) { cls += ' is-hidden-row'; }
    return cls;
  }

  /*
   * 並び替えの▲▼ボタン（CLAUDE.md 5.14）。
   * 端（いちばん上の▲・いちばん下の▼）は押せない見た目にします。
   * クリックは行のクリック（5.6）に伝えません。
   */
  function buildMoveButtons(canUp, canDown, onMove) {
    var box = el('span', 'movebtns movebtns--row');
    [
      { label: '▲', delta: -1, enabled: canUp, title: '1つ上へ' },
      { label: '▼', delta: 1, enabled: canDown, title: '1つ下へ' }
    ].forEach(function (spec) {
      var button = el('button', 'movebtn', spec.label);
      button.type = 'button';
      button.title = spec.title;
      button.setAttribute('aria-label', spec.title);
      button.disabled = !spec.enabled;
      button.addEventListener('click', function (e) {
        e.stopPropagation();
        onMove(spec.delta);
      });
      box.appendChild(button);
    });
    return box;
  }

  /*
   * 担当者ヘッダの編集できる項目を1つ作ります（CLAUDE.md 5.13）。
   * 値が空のときは薄いプレースホルダーを出し、クリックできる幅を確保します。
   * クリックすると popup.js の編集処理を呼びます。
   */
  function buildMemberField(member, key, className, placeholder) {
    var value = member[key] || '';
    var node = el('span', className + ' member__field', value || placeholder);
    if (!value) { node.className += ' is-placeholder'; }
    // 案件数は「（9）」のように括弧付きで見せる
    if (key === 'countText' && value) { node.textContent = '（' + value + '）'; }

    node.title = member.name + 'さんの' + placeholder + 'を変更';
    node.addEventListener('click', function (e) {
      e.stopPropagation();
      if (memberEditor) { memberEditor(member, key, node); }
    });
    return node;
  }

  // 担当者ヘッダ項目の編集を担当する関数（app.js が popup.js のものを渡す）
  var memberEditor = null;

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

      /*
       * 案件数・絵文字・一言コメントはその場で編集できる（CLAUDE.md 5.13）。
       * 空でもクリックできるよう、薄いプレースホルダーを常時出します。
       * 編集の中身は popup.js（絵文字の一覧を持つ側）に任せます。
       */
      node.appendChild(buildMemberField(m, 'countText', 'member__count', '数'));
      node.appendChild(buildMemberField(m, 'emoji', 'member__emoji', '◯'));
      node.appendChild(buildMemberField(m, 'comment', 'member__comment', '一言'));

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
    // タイトルの前に絵文字「📝」を常に付ける（CLAUDE.md 5.4）
    node.appendChild(el('span', 'project__icon', '📝'));
    var title = row.project.title || '(無題)';
    var titleNode = el('span', 'project__title', title);
    if (!row.project.title) { titleNode.className += ' is-untitled'; }
    node.appendChild(titleNode);

    /*
     * 並び替えの▲▼（CLAUDE.md 5.14）。
     * 行にポインタが乗っている間だけ、ラベルの右端に出します（表示の制御はCSS）。
     * 押しても案件ポップアップ（5.6）は開きません。
     */
    if (handlers.onMoveProject) {
      node.appendChild(buildMoveButtons(
        row.index > 0,
        row.index < row.total - 1,
        function (delta) { handlers.onMoveProject(row.project.id, delta); }
      ));
    }
    return node;
  }

  /*
   * 右側: 案件行にはバーを置き、部署・担当者の行は空にする。
   * 案件行にはさらに TW・有休の日ハイライトを敷く（CLAUDE.md 5.12）。
   * 塗るのは案件行だけで、担当者ヘッダ行・部署見出し行は塗らない。
   */
  function buildGridRow(row, days, viewStartDay, dayCount, marks) {
    var node = el('div', rowClass(row));
    if (row.kind !== 'project') { return node; }

    // 背景（バーより先に入れて後ろに置く）
    var fill = buildDayFill(days, marks[row.member.id]);
    if (fill) { node.appendChild(fill); }

    // 開始日順に描き、重なった部分は後のバーが前面になる（CLAUDE.md 5.5）
    var bars = row.project.bars.slice().sort(function (a, b) { return a.start - b.start; });

    /*
     * 重なりの前後関係（CLAUDE.md 5.11「見えているものが押せる」）。
     * 後ろから順に3つの層に分けて並べます。
     *   back   … MT のセル背景と、文字ラベル工程の1日ぶんの当たり判定
     *   middle … 色付きバー
     *   front  … 文字ラベル工程の文字（色付きバーに重なっても読める・押せる）
     */
    var back = [];
    var middle = [];
    var front = [];

    bars.forEach(function (bar) {
      if (Store.hasBar(bar.stage) || bar.stage === Store.MT_STAGE) {
        var barNode = buildBar(bar, viewStartDay, dayCount, row.project);
        if (!barNode) { return; }
        if (bar.stage === Store.MT_STAGE) { back.push(barNode); } else { middle.push(barNode); }
        return;
      }
      var pair = buildMarkBar(bar, viewStartDay, dayCount, row.project);
      if (!pair) { return; }
      back.push(pair.hit);
      front.push(pair.label);
    });

    back.concat(middle, front).forEach(function (barNode) { node.appendChild(barNode); });
    return node;
  }

  /* ============================================================
   * 描画本体
   *
   * root: 描画先の要素
   * view: { startSerial, dayCount }
   * options:
   *   showHidden     … 非表示の案件も出すか（CLAUDE.md 5.4）
   *   onOpenProject  … 行ラベルがクリックされたとき（CLAUDE.md 5.6）
   *   onOpenBar      … バーがクリックされたとき（CLAUDE.md 5.11）
   *   onCreateBarAt  … 案件行の空白セルがクリックされたとき（CLAUDE.md 5.5）
   *   onAddProject   … 担当者ヘッダの「＋」が押されたとき（CLAUDE.md 5.7）
   *   onMoveProject  … 案件行の▲▼が押されたとき（CLAUDE.md 5.14）
   *   onBarChange    … バーのドラッグ移動が確定したとき（CLAUDE.md 5.10）
   * ============================================================ */
  function draw(root, view, options) {
    var opts = options || {};
    var showHidden = opts.showHidden === true;
    var days = buildDays(view);
    var viewStartDay = Store.dayIndexFromSerial(view.startSerial);
    var rows = buildRowList(showHidden);
    // TW・有休の日ハイライト用（CLAUDE.md 5.12）
    var dayMarks = buildDayMarks(showHidden);

    // ドラッグ計算に使う描画条件を控えておく（CLAUDE.md 5.10）
    dragCtx.viewStartDay = viewStartDay;
    dragCtx.dayCount = view.dayCount;
    dragCtx.onBarChange = opts.onBarChange || null;
    // バーのクリックは工程バー個別ポップアップへ（CLAUDE.md 5.11）
    dragCtx.onOpenBar = opts.onOpenBar || null;
    // 担当者ヘッダ項目の直接編集（CLAUDE.md 5.13）
    memberEditor = opts.onEditMemberField || null;

    // 行ラベル（📝タイトル部分）のクリックで案件ポップアップを開く（CLAUDE.md 5.6）
    function makeLabelClickable(node, project) {
      if (!opts.onOpenProject) { return; }
      node.classList.add('is-clickable');
      node.addEventListener('click', function () { opts.onOpenProject(project.id); });
    }

    /*
     * 案件行（グリッド側）の空白セルのクリックで、
     * そのセルの日付を開始日とする新規バーを作り 5.11 を開く（CLAUDE.md 5.5）。
     * バーの上のクリックはバー側で止めているので、ふつうはここには届きません。
     * それでも、バーの上下のわずかな余白などから届くことがあるため、
     * 「その日にバーが1本も無い」ことを念のため確かめます（CLAUDE.md 5.5 の空白セルの定義）。
     */
    function makeCellClickable(node, project) {
      if (!opts.onCreateBarAt) { return; }
      node.classList.add('is-clickable');
      node.addEventListener('click', function (e) {
        var hit = cellFromClick(node, e.clientX, viewStartDay, view.dayCount);
        if (!hit || hasBarOnDay(project, hit.dayIndex)) { return; }
        opts.onCreateBarAt(project.id, hit.dayIndex, hit.rect);
      });
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
        if (row.kind === 'project') { makeLabelClickable(node, row.project); }
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
      var node = buildGridRow(row, days, viewStartDay, view.dayCount, dayMarks);
      if (row.kind === 'project') { makeCellClickable(node, row.project); }
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

    /*
     * MT の見本（CLAUDE.md 5.1 / 6.4）。
     * MT は文字を持たずセル背景だけで表すため、凡例では色が分かるよう枠線を付けます。
     */
    var mt = el('span', 'legend__item legend__item--sep');
    mt.appendChild(el('span', 'legend__swatch legend__swatch--mt'));
    mt.appendChild(el('span', 'legend__label', 'MT'));
    root.appendChild(mt);
  }

  return {
    draw: draw,
    drawLegend: drawLegend,
    buildDays: buildDays,
    buildRowList: buildRowList,
    barGeometry: barGeometry,
    geometryFromDays: geometryFromDays,
    dragLimits: dragLimits,
    edgeLimits: edgeLimits,
    handleWidth: handleWidth,
    statusLabel: statusLabel,
    WEEKDAY_LABELS: WEEKDAY_LABELS,
    STATUS_KEYS: STATUS_KEYS,
    MARK_KEYS: MARK_KEYS
  };
}());
