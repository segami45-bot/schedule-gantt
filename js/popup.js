/*
 * popup.js — 編集ポップアップ・設定モーダル（CLAUDE.md 7）
 *
 * 設定モーダル（CLAUDE.md 5.8）と、案件の編集ポップアップ（5.6）を持ちます。
 * どちらも変更は即時反映＋自動保存です（保存ボタンは置かず、閉じるボタンのみ）。
 */
var Popup = (function () {
  'use strict';

  var onChange = null;   // 画面を描き直してもらうための連絡先（app.jsが渡す）
  var dialog = null;     // 設定モーダルの <dialog> 要素
  var parts = {};        // 設定モーダル内のよく使う要素

  var projectDialog = null; // 編集ポップアップの <dialog> 要素
  var pparts = {};          // 編集ポップアップ内のよく使う要素
  var currentProjectId = null;

  /*
   * 担当者の絵文字（CLAUDE.md 5.8）。自由入力ではなく、この18種から選ぶ。
   * 並び順はesが決めた並びのまま。
   */
  var EMOJI_CHOICES = ['😀', '😁', '😅', '🙂', '😐', '😴', '🫩', '🤢', '😵', '🤠', '😮', '🥹', '😢', '😱', '🥱',
                       '😷', '😭', '😤'];

  /* ------------------------------------------------------------
   * 小道具
   * ------------------------------------------------------------ */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  function input(className, value, placeholder) {
    var node = el('input', className);
    node.type = 'text';
    node.value = value || '';
    if (placeholder) { node.placeholder = placeholder; }
    return node;
  }

  /*
   * ポップアップを上部の見出し帯でドラッグ移動できるようにする（CLAUDE.md 5.6）。
   * ボタンなど操作可能な要素の上ではドラッグを始めません。
   * 画面外へ出ないよう、移動範囲は常に画面内に収まるよう制限します。
   * 閉じて再度開いたときは中央表示に戻すため、位置は保存しません（呼び出し側で resetDialogPosition を呼ぶ）。
   */
  function makeDraggable(target, handle) {
    var dragging = false;
    var offsetX = 0;
    var offsetY = 0;

    function isInteractive(node) {
      return !!node.closest('button, input, select, textarea, a, label');
    }

    function onPointerMove(e) {
      if (!dragging) { return; }
      var rect = target.getBoundingClientRect();
      var maxLeft = Math.max(0, window.innerWidth - rect.width);
      var maxTop = Math.max(0, window.innerHeight - rect.height);
      var left = Math.min(Math.max(e.clientX - offsetX, 0), maxLeft);
      var top = Math.min(Math.max(e.clientY - offsetY, 0), maxTop);
      target.style.left = left + 'px';
      target.style.top = top + 'px';
    }

    function onPointerUp() {
      dragging = false;
      document.body.classList.remove('is-dragging-modal');
    }

    handle.addEventListener('mousedown', function (e) {
      if (isInteractive(e.target)) { return; }
      var rect = target.getBoundingClientRect();
      // 現在の見た目の位置に固定してから動かす（中央寄せの margin:auto を解除する）
      target.style.margin = '0';
      target.style.left = rect.left + 'px';
      target.style.top = rect.top + 'px';
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      dragging = true;
      document.body.classList.add('is-dragging-modal');
      e.preventDefault();
    });

    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
  }

  // 次に開いたとき中央表示に戻す（CLAUDE.md 5.6: 位置は記憶しない）
  function resetDialogPosition(target) {
    target.style.left = '';
    target.style.top = '';
    target.style.margin = '';
  }

  // モーダル上部にメッセージを出す（削除できないときの理由など）
  function setMessage(node, text, isError) {
    node.textContent = text;
    node.className = 'modal__message' + (isError ? ' is-error' : ' is-info');
    node.hidden = false;
  }

  function hideMessage(node) {
    node.hidden = true;
    node.textContent = '';
  }

  function showMessage(text, isError) { setMessage(parts.message, text, isError); }
  function clearMessage() { hideMessage(parts.message); }

  /*
   * データを変える操作をまとめて包みます。
   * 失敗したらモーダル上部に日本語のメッセージを出し、画面は変えません。
   * 成功したら必要に応じて一覧を作り直し、ガント本体も描き直します。
   *
   * messageNode / rebuildFn を渡すと、そのモーダル用に振る舞いを差し替えます。
   */
  function runOn(action, messageNode, rebuildFn) {
    try {
      action();
      hideMessage(messageNode);
      if (rebuildFn) { rebuildFn(); }
      if (onChange) { onChange(); }
      return true;
    } catch (e) {
      setMessage(messageNode, e.message, true);
      return false;
    }
  }

  function run(action, rebuild) {
    return runOn(action, parts.message, rebuild ? renderLists : null);
  }

  /* ------------------------------------------------------------
   * 部署の一覧（CLAUDE.md 5.8）
   * ------------------------------------------------------------ */

  function buildDeptRow(dept) {
    var row = el('div', 'settings__row');

    // 改名: 入力から外れた時点で保存する
    var nameInput = input('settings__input settings__input--grow', dept.name, '部署名');
    nameInput.addEventListener('change', function () {
      if (!run(function () { Store.renameDepartment(dept.id, nameInput.value); })) {
        nameInput.value = dept.name; // 拒否されたら元に戻す
      }
    });
    row.appendChild(nameInput);

    row.appendChild(el('span', 'settings__note', Store.listMembers(dept.id).length + '人'));

    var del = el('button', 'settings__delete', '削除');
    del.type = 'button';
    del.addEventListener('click', function () {
      // 人数は押した時点で数え直す（異動などで変わっているため）
      if (Store.listMembers(dept.id).length > 0) {
        // 所属担当者が0でなければ Store 側が理由付きで拒否します
        run(function () { Store.removeDepartment(dept.id); });
        return;
      }
      if (!window.confirm('部署「' + dept.name + '」を削除します。よろしいですか？')) { return; }
      run(function () { Store.removeDepartment(dept.id); }, true);
    });
    row.appendChild(del);

    return row;
  }

  /* ------------------------------------------------------------
   * 担当者の一覧（CLAUDE.md 5.8）
   * ------------------------------------------------------------ */

  /*
   * 絵文字を選ぶセレクト（CLAUDE.md 5.8）。15種＋「（なし）」。
   * すでに一覧に無い値が入っていた場合（旧データなど）は、勝手に上書きしないよう
   * その値のための選択肢を先頭に足しておく（ユーザーが選び直すまで元の値のまま）。
   */
  function buildEmojiSelect(currentValue) {
    var select = el('select', 'settings__input settings__input--emoji');

    var none = el('option', null, '（なし）');
    none.value = '';
    select.appendChild(none);

    var matched = currentValue === '';
    EMOJI_CHOICES.forEach(function (emoji) {
      var option = el('option', null, emoji);
      option.value = emoji;
      if (emoji === currentValue) { option.selected = true; matched = true; }
      select.appendChild(option);
    });

    if (!matched && currentValue) {
      var extra = el('option', null, currentValue);
      extra.value = currentValue;
      extra.selected = true;
      select.insertBefore(extra, select.firstChild);
    }

    return select;
  }

  // 所属部署を選ぶセレクト
  function buildDeptSelect(selectedId) {
    var select = el('select', 'settings__input settings__input--dept');
    Store.listDepartments().forEach(function (dept) {
      var option = el('option', null, dept.name);
      option.value = dept.id;
      if (dept.id === selectedId) { option.selected = true; }
      select.appendChild(option);
    });
    return select;
  }

  /*
   * 担当者1人ぶんの行。
   * 名前・所属部署・案件数テキスト・絵文字・一言コメントを、その場で編集できます。
   * 案件数・絵文字・コメントは手動入力の自由項目で、空でも構いません（CLAUDE.md 4.3）。
   */
  function buildMemberRow(member) {
    var row = el('div', 'settings__row');

    /*
     * 変更したその場で保存する共通処理。
     * 所属部署を変えたときは各部署の人数表示が変わるため、一覧を作り直します。
     */
    function bind(node, key) {
      var rebuild = key === 'deptId';
      node.addEventListener('change', function () {
        var patch = {};
        patch[key] = node.value;
        if (!run(function () { Store.updateMember(member.id, patch); }, rebuild)) {
          node.value = member[key]; // 拒否されたら元に戻す
        }
      });
    }

    var nameInput = input('settings__input settings__input--grow', member.name, '担当者名');
    bind(nameInput, 'name');
    row.appendChild(nameInput);

    var deptSelect = buildDeptSelect(member.deptId);
    bind(deptSelect, 'deptId');
    row.appendChild(deptSelect);

    var countInput = input('settings__input settings__input--narrow', member.countText, '件数');
    bind(countInput, 'countText');
    row.appendChild(countInput);

    var emojiSelect = buildEmojiSelect(member.emoji);
    bind(emojiSelect, 'emoji');
    row.appendChild(emojiSelect);

    var commentInput = input('settings__input settings__input--grow', member.comment, '一言コメント');
    bind(commentInput, 'comment');
    row.appendChild(commentInput);

    var del = el('button', 'settings__delete', '削除');
    del.type = 'button';
    del.addEventListener('click', function () {
      // 担当している案件があれば Store 側が理由付きで拒否します（CLAUDE.md 5.8）
      if (Store.assignedProjects(member.id).length === 0) {
        if (!window.confirm('「' + member.name + '」さんを削除します。よろしいですか？')) {
          return;
        }
      }
      run(function () { Store.removeMember(member.id); }, true);
    });
    row.appendChild(del);

    return row;
  }

  /* ------------------------------------------------------------
   * 一覧の組み立て
   * ------------------------------------------------------------ */

  function renderLists() {
    var departments = Store.listDepartments();

    // ---- 部署 ----
    parts.deptList.innerHTML = '';
    if (departments.length === 0) {
      parts.deptList.appendChild(el('p', 'settings__empty', 'まだ部署がありません。'));
    } else {
      departments.forEach(function (dept) {
        parts.deptList.appendChild(buildDeptRow(dept));
      });
    }

    // ---- 担当者 ----
    parts.memberList.innerHTML = '';
    var members = Store.listMembers();
    if (departments.length === 0) {
      parts.memberList.appendChild(el('p', 'settings__empty', '先に部署を追加してください。'));
    } else if (members.length === 0) {
      parts.memberList.appendChild(el('p', 'settings__empty', 'まだ担当者がいません。'));
    } else {
      // 部署ごとにまとめず、登録順に並べます（並び替えUIはV2）
      members.forEach(function (member) {
        parts.memberList.appendChild(buildMemberRow(member));
      });
    }

    // 部署が無いあいだは担当者を追加できない
    var noDept = departments.length === 0;
    parts.memberName.disabled = noDept;
    parts.memberDeptWrap.innerHTML = '';
    if (!noDept) {
      parts.memberDeptSelect = buildDeptSelect(departments[0].id);
      parts.memberDeptWrap.appendChild(parts.memberDeptSelect);
    } else {
      parts.memberDeptSelect = null;
    }
    parts.memberAdd.disabled = noDept;
  }

  /* ------------------------------------------------------------
   * モーダルの組み立て（最初の1回だけ）
   * ------------------------------------------------------------ */

  function section(title) {
    var node = el('section', 'settings__section');
    node.appendChild(el('h3', 'settings__heading', title));
    return node;
  }

  function build() {
    dialog = el('dialog', 'modal');

    // ---- 見出し ----
    var head = el('div', 'modal__head');
    head.appendChild(el('h2', 'modal__title', '設定'));
    var close = el('button', 'modal__close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', function () { dialog.close(); });
    head.appendChild(close);
    dialog.appendChild(head);

    // ---- メッセージ欄 ----
    parts.message = el('p', 'modal__message');
    parts.message.hidden = true;
    dialog.appendChild(parts.message);

    var body = el('div', 'modal__body');

    // ---- 部署 ----
    var deptSection = section('部署');
    parts.deptList = el('div', 'settings__list');
    deptSection.appendChild(parts.deptList);

    var deptAddRow = el('div', 'settings__add');
    parts.deptName = input('settings__input settings__input--grow', '', '部署名');
    parts.deptAdd = el('button', 'settings__add-button', '部署を追加');
    parts.deptAdd.type = 'button';

    function addDept() {
      var ok = run(function () { Store.addDepartment(parts.deptName.value); }, true);
      if (ok) { parts.deptName.value = ''; }
    }
    parts.deptAdd.addEventListener('click', addDept);
    // Enterでも追加できるようにする
    parts.deptName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addDept(); }
    });

    deptAddRow.appendChild(parts.deptName);
    deptAddRow.appendChild(parts.deptAdd);
    deptSection.appendChild(deptAddRow);
    body.appendChild(deptSection);

    // ---- 担当者 ----
    var memberSection = section('担当者');
    memberSection.appendChild(el('p', 'settings__hint',
      '案件数・絵文字・一言コメントは手動入力です。空のままでも構いません。'));
    parts.memberList = el('div', 'settings__list');
    memberSection.appendChild(parts.memberList);

    var memberAddRow = el('div', 'settings__add');
    parts.memberName = input('settings__input settings__input--grow', '', '担当者名');
    parts.memberDeptWrap = el('span', 'settings__add-dept');
    parts.memberAdd = el('button', 'settings__add-button', '担当者を追加');
    parts.memberAdd.type = 'button';

    function addMember() {
      if (!parts.memberDeptSelect) { return; }
      var deptId = parts.memberDeptSelect.value;
      var name = parts.memberName.value;
      var ok = run(function () { Store.addMember(deptId, name); }, true);
      if (ok) { parts.memberName.value = ''; }
    }
    parts.memberAdd.addEventListener('click', addMember);
    parts.memberName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addMember(); }
    });

    memberAddRow.appendChild(parts.memberName);
    memberAddRow.appendChild(parts.memberDeptWrap);
    memberAddRow.appendChild(parts.memberAdd);
    memberSection.appendChild(memberAddRow);
    body.appendChild(memberSection);

    dialog.appendChild(body);
    document.body.appendChild(dialog);
  }

  /* ============================================================
   * 編集ポップアップ（CLAUDE.md 5.6）
   * ============================================================ */

  /*
   * ［バーを追加］で増えたバーの目印（CLAUDE.md 5.6）。
   * データには何も記録せず、ポップアップを閉じるまで画面上で強調表示するだけです。
   * scrollTarget は、作り直した直後にスクロールしたい行（描画のたびに拾い直す）。
   */
  var newBarIds = [];
  var lastAddedBarId = null;
  var scrollTarget = null;

  function clearNewBarMarks() {
    newBarIds = [];
    lastAddedBarId = null;
    scrollTarget = null;
  }

  // このポップアップ用の実行ラッパ。失敗理由はポップアップ上部に出す
  function prun(action, rebuild) {
    return runOn(action, pparts.message, rebuild ? renderProject : null);
  }

  function currentProject() {
    return currentProjectId ? Store.findProject(currentProjectId) : null;
  }

  /*
   * 担当者のプルダウン（1名 / CLAUDE.md 5.6）。
   * 案件は必ず1名の担当者に属するため、外すことはできず付け替えのみです。
   * 変更するとその担当者の下へ案件行が移ります。
   */
  function buildAssignees(project) {
    var box = pparts.assignees;
    box.innerHTML = '';

    var select = el('select', 'settings__input settings__input--grow');

    // 部署ごとにまとめて、担当者が増えても探しやすくする
    Store.listDepartments().forEach(function (dept) {
      var members = Store.listMembers(dept.id);
      if (members.length === 0) { return; }

      var group = el('optgroup');
      group.label = dept.name;
      members.forEach(function (member) {
        var option = el('option', null, member.name);
        option.value = member.id;
        if (member.id === project.assigneeId) { option.selected = true; }
        group.appendChild(option);
      });
      select.appendChild(group);
    });

    select.addEventListener('change', function () {
      // 担当者を変えると行の位置が変わるため、ガント側を描き直す
      if (!prun(function () { Store.setAssignee(currentProjectId, select.value); })) {
        select.value = project.assigneeId; // 拒否されたら元に戻す
      }
    });

    box.appendChild(select);
  }

  /* ---- バー1本ぶんの行（CLAUDE.md 5.6） ---- */

  /*
   * バー1本の読み書きの窓口。ふつうはデータのバーをそのまま更新し、そのつど保存します。
   */
  function storeBarAccess(projectId, barId) {
    return {
      read: function () {
        var project = Store.findProject(projectId);
        if (!project) { return null; }
        var found = null;
        project.bars.forEach(function (b) { if (b.id === barId) { found = b; } });
        return found;
      },
      update: function (patch) { Store.updateBar(projectId, barId, patch); },
      remove: function () { Store.removeBar(projectId, barId); }
    };
  }

  /*
   * 新規作成モードの窓口（CLAUDE.md 5.11）。
   * まだデータに無い「下書き」のバーを書き換えるだけで、保存もグリッドへの描画もしません。
   * 値の正規化（1日幅にそろえる・日付の検証）は Store と同じ処理を使います。
   * 消すものが無いので remove は持ちません（破棄は［閉じる］/ Esc）。
   */
  function draftBarAccess(target) {
    return {
      read: function () { return target.bar; },
      update: function (patch) { Store.applyBarPatch(target.bar, patch); },
      remove: null
    };
  }

  /*
   * バー1本ぶんの編集行。案件ポップアップ（5.6）と
   * 工程バー個別ポップアップ（5.11）の両方で使います。
   * ctx = { projectId, run, access, isNew }
   *   run(action, rebuild) … 各ポップアップの実行ラッパ
   *   access               … バーの読み書きの窓口（省略時はデータのバーを直接更新）
   */
  function buildBarRow(bar, ctx) {
    var row = el('div', 'barrow');
    // ［バーを追加］で増えた行は、閉じるまで強調表示する（CLAUDE.md 5.6）
    if (ctx.isNew) { row.className += ' is-new'; }
    var projectId = ctx.projectId;
    var run = ctx.run;
    var access = ctx.access || storeBarAccess(projectId, bar.id);
    // 文字ラベル工程は色を持たず、常に1日（CLAUDE.md 5.5 / 5.6）
    var hasBar = Store.hasBar(bar.stage);
    // MT はセル背景で表すので、文字色の2択も出しません（CLAUDE.md 5.6 / 5.12）
    var isMt = bar.stage === Store.MT_STAGE;

    // 工程セレクト
    var stage = el('select', 'barrow__stage');
    Store.STAGES.forEach(function (name) {
      var option = el('option', null, name);
      option.value = name;
      if (name === bar.stage) { option.selected = true; }
      stage.appendChild(option);
    });
    // 工程が変わると番号セレクトの出し入れや1日幅化が起きるため作り直す
    stage.addEventListener('change', function () {
      run(function () {
        access.update({ stage: stage.value });
      }, true);
    });
    row.appendChild(stage);

    // 番号セレクトは「修正」のときだけ出す（CLAUDE.md 5.6）
    if (bar.stage === Store.NUMBERED_STAGE) {
      var no = el('select', 'barrow__no');
      for (var i = Store.MIN_STAGE_NO; i <= Store.MAX_STAGE_NO; i++) {
        var opt = el('option', null, String(i));
        opt.value = String(i);
        if (i === bar.stageNo) { opt.selected = true; }
        no.appendChild(opt);
      }
      no.addEventListener('change', function () {
        run(function () {
          access.update({ stageNo: no.value });
        });
      });
      row.appendChild(no);
    }

    /*
     * 状態パレット（6色ボタン）と囲い点線のチェック。
     * MT・入稿・納品は色を持たないため、どちらも出しません（値は保持されます）。
     */
    if (hasBar) {
      var palette = el('div', 'palette');
      Store.STATUSES.forEach(function (status) {
        var swatch = el('button', 'palette__button bar--' + Render.STATUS_KEYS[status]);
        swatch.type = 'button';
        swatch.title = Render.statusLabel(status);
        swatch.setAttribute('aria-label', Render.statusLabel(status));
        if (status === bar.status) { swatch.classList.add('is-selected'); }
        swatch.addEventListener('click', function () {
          if (run(function () { access.update({ status: status }); })) {
            palette.querySelectorAll('.palette__button').forEach(function (node) {
              node.classList.remove('is-selected');
            });
            swatch.classList.add('is-selected');
          }
        });
        palette.appendChild(swatch);
      });
      row.appendChild(palette);

      // 囲い点線 = CL&S確認中（CLAUDE.md 5.6）
      var clsLabel = el('label', 'barrow__cls');
      var clsCheck = el('input');
      clsCheck.type = 'checkbox';
      clsCheck.checked = bar.clsCheck === true;
      clsCheck.title = 'クライアントおよび営業の確認待ち';
      clsCheck.addEventListener('change', function () {
        if (!run(function () {
          access.update({ clsCheck: clsCheck.checked });
        })) {
          clsCheck.checked = !clsCheck.checked;
        }
      });
      clsLabel.appendChild(clsCheck);
      clsLabel.appendChild(el('span', null, '確認中'));
      row.appendChild(clsLabel);
    } else if (isMt) {
      // MT は文字も色も持たず、セル背景だけで表します（CLAUDE.md 5.12）
      row.appendChild(el('span', 'barrow__note', 'セル背景・1日'));
    } else {
      /*
       * 入稿・納品・TW・有休は文字だけの表示。
       * 色付きバーに重なったときに読めるよう、既定色と白から選べます（CLAUDE.md 6.2）。
       */
      row.appendChild(el('span', 'barrow__note', '文字のみ・1日'));

      var markPalette = el('div', 'palette');
      [
        { value: 'default', label: '既定の色', css: 'mark-sw--' + Render.MARK_KEYS[bar.stage] },
        { value: 'white', label: '白', css: 'mark-sw--white' }
      ].forEach(function (choice) {
        var swatch = el('button', 'palette__button ' + choice.css);
        swatch.type = 'button';
        swatch.title = choice.label;
        swatch.setAttribute('aria-label', choice.label);
        if ((bar.markColor || 'default') === choice.value) { swatch.classList.add('is-selected'); }
        swatch.addEventListener('click', function () {
          if (run(function () {
            access.update({ markColor: choice.value });
          })) {
            markPalette.querySelectorAll('.palette__button').forEach(function (node) {
              node.classList.remove('is-selected');
            });
            swatch.classList.add('is-selected');
          }
        });
        markPalette.appendChild(swatch);
      });
      row.appendChild(markPalette);
    }

    // 開始日・終了日（ネイティブのカレンダーピッカーを使う / CLAUDE.md 5.6）
    var startInput = el('input', 'barrow__date');
    startInput.type = 'date';
    startInput.value = Store.ymdTextFromSerial(bar.start);

    var endInput = el('input', 'barrow__date');
    endInput.type = 'date';
    endInput.value = Store.ymdTextFromSerial(bar.end);
    if (!hasBar) {
      // MT・入稿・納品は常に1日なので終了日は触れないようにする（CLAUDE.md 5.5）
      endInput.disabled = true;
      endInput.title = bar.stage + 'は1日だけの予定です';
    }

    // 変更後の値を読み直して入力欄に書き戻す（1日幅への補正が入るため）
    function syncDates() {
      var fresh = access.read();
      if (!fresh) { return; }
      startInput.value = Store.ymdTextFromSerial(fresh.start);
      endInput.value = Store.ymdTextFromSerial(fresh.end);
    }

    startInput.addEventListener('change', function () {
      run(function () {
        access.update({ startYmd: startInput.value });
      });
      syncDates();
    });
    endInput.addEventListener('change', function () {
      run(function () {
        access.update({ endYmd: endInput.value });
      });
      syncDates();
    });

    row.appendChild(startInput);
    row.appendChild(el('span', 'barrow__tilde', '〜'));
    row.appendChild(endInput);

    /*
     * バー削除。新規作成モードの下書きには消すものが無いので出しません
     * （破棄は［閉じる］か Esc / CLAUDE.md 5.11）。
     */
    if (access.remove) {
      var del = el('button', 'settings__delete', '削除');
      del.type = 'button';
      del.addEventListener('click', function () {
        run(function () { access.remove(); }, true);
      });
      row.appendChild(del);
    }

    return row;
  }

  /* ---- ポップアップの中身を作り直す ---- */

  function renderProject() {
    var project = currentProject();
    if (!project) { return; }

    pparts.title.value = project.title;
    pparts.note.value = project.note || '';
    buildAssignees(project);

    // バー一覧（開始日順に並べる）
    pparts.bars.innerHTML = '';
    var bars = project.bars.slice().sort(function (a, b) { return a.start - b.start; });
    if (bars.length === 0) {
      pparts.bars.appendChild(el('p', 'settings__empty', 'バーがありません。'));
    } else {
      bars.forEach(function (bar) {
        var isNew = newBarIds.indexOf(bar.id) >= 0;
        var node = buildBarRow(bar, { projectId: currentProjectId, run: prun, isNew: isNew });
        pparts.bars.appendChild(node);
        // 追加した行が画面の外にあるときは、そこまでスクロールする（CLAUDE.md 5.6）
        if (isNew && bar.id === lastAddedBarId) { scrollTarget = node; }
      });
    }

    // 完了・非表示トグルの状態
    pparts.hidden.setAttribute('aria-pressed', project.hidden ? 'true' : 'false');
    pparts.hidden.classList.toggle('is-on', project.hidden === true);
  }

  function buildProjectDialog() {
    projectDialog = el('dialog', 'modal modal--project');

    // ドラッグ移動できることが分かるよう専用クラスを付ける（CLAUDE.md 5.6）
    var head = el('div', 'modal__head modal__head--draggable');
    head.appendChild(el('h2', 'modal__title', '案件の編集'));

    // ボタンはすべて下部に置くため、見出し帯には何も入れない（CLAUDE.md 5.6）
    projectDialog.appendChild(head);
    makeDraggable(projectDialog, head);

    pparts.message = el('p', 'modal__message');
    pparts.message.hidden = true;
    projectDialog.appendChild(pparts.message);

    var body = el('div', 'modal__body');

    // ---- タイトル ----
    var titleField = el('div', 'field');
    titleField.appendChild(el('label', 'field__label', 'タイトル'));
    pparts.title = input('settings__input settings__input--grow', '', '案件名');
    pparts.title.addEventListener('change', function () {
      prun(function () {
        Store.updateProject(currentProjectId, { title: pparts.title.value });
      });
    });
    titleField.appendChild(pparts.title);
    body.appendChild(titleField);

    /* ---- 制作メモ（CLAUDE.md 5.6） ----
     * 自由記入の1行入力。この画面だけに出し、ガントや 5.11 には出しません。
     */
    var noteField = el('div', 'field');
    noteField.appendChild(el('label', 'field__label', '制作メモ'));
    pparts.note = input('settings__input settings__input--grow', '',
                        'ボリューム・サイズ・印刷会社など');
    pparts.note.addEventListener('change', function () {
      prun(function () {
        Store.updateProject(currentProjectId, { note: pparts.note.value });
      });
    });
    noteField.appendChild(pparts.note);
    body.appendChild(noteField);

    // ---- 担当者 ----
    var assigneeSection = section('担当者');
    assigneeSection.appendChild(el('p', 'settings__hint',
      '案件は1名の担当者に属します。変更するとその担当者の下へ移ります。'));
    pparts.assignees = el('div', 'assignee__list');
    assigneeSection.appendChild(pparts.assignees);
    body.appendChild(assigneeSection);

    // ---- バー ----
    var barSection = section('バー');
    pparts.bars = el('div', 'settings__list');
    barSection.appendChild(pparts.bars);

    var barAdd = el('div', 'settings__add');
    var addButton = el('button', 'settings__add-button', 'バーを追加');
    addButton.type = 'button';
    addButton.addEventListener('click', function () {
      // 初期値は 工程「ラフ」・状態「未着手」・今日1日（CLAUDE.md 5.6）
      scrollTarget = null;
      prun(function () {
        var created = Store.addBar(currentProjectId);
        // 作り直しの前に印を付けておく（renderProject が強調表示に使う）
        newBarIds.push(created.id);
        lastAddedBarId = created.id;
      }, true);
      // 追加した行が下にあって見えない場合はそこまでスクロールする（CLAUDE.md 5.6）
      if (scrollTarget) { scrollTarget.scrollIntoView({ block: 'nearest' }); }
    });
    barAdd.appendChild(addButton);
    barSection.appendChild(barAdd);
    body.appendChild(barSection);

    /* ---- 下部のボタン（CLAUDE.md 5.6） ----
     * 左から［完了・非表示］［案件を削除］、右端に［閉じる］。
     * ［案件を削除］は赤系の危険色にし、誤操作を防ぐため
     * ［完了・非表示］との間に間隔を空けます。
     */
    var foot = el('div', 'modal__foot');

    pparts.hidden = el('button', 'modal__foot-button', '完了・非表示');
    pparts.hidden.type = 'button';
    pparts.hidden.setAttribute('aria-pressed', 'false');
    pparts.hidden.addEventListener('click', function () {
      prun(function () { Store.toggleHidden(currentProjectId); }, true);
    });
    foot.appendChild(pparts.hidden);

    var removeButton = el('button', 'modal__foot-button modal__foot-button--danger', '案件を削除');
    removeButton.type = 'button';
    removeButton.addEventListener('click', function () {
      var project = currentProject();
      if (!project) { return; }
      var name = project.title || '(無題)';
      // 確認ダイアログ必須（CLAUDE.md 5.6）
      if (!window.confirm('案件「' + name + '」を削除します。元に戻せません。よろしいですか？')) {
        return;
      }
      if (prun(function () { Store.removeProject(currentProjectId); })) {
        projectDialog.close();
      }
    });
    foot.appendChild(removeButton);

    var close = el('button', 'modal__foot-button modal__foot-button--close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', function () { projectDialog.close(); });
    foot.appendChild(close);

    body.appendChild(foot);
    projectDialog.appendChild(body);

    // 閉じたら新規バーの強調表示を解除する（CLAUDE.md 5.6）
    projectDialog.addEventListener('close', clearNewBarMarks);

    document.body.appendChild(projectDialog);
  }

  /* ============================================================
   * 工程バー個別ポップアップ（CLAUDE.md 5.11）
   *
   * バーのクリックで、そのバー1本だけを編集する小型ポップアップ。
   * 中身のバー行は 5.6 と同じ buildBarRow を使い回します。
   * ============================================================ */

  var barDialog = null;
  var bparts = {};
  var currentBar = { projectId: null, barId: null };

  /*
   * 新規作成モードの下書き（CLAUDE.md 5.11）。
   * 案件行の空白セルのクリックで作られ、
   * ［このバーを追加］を押すまでデータには何も作らず、グリッドにも描きません。
   * 形は { projectId, bar }。編集モードでは null。
   */
  var draft = null;

  function brun(action, rebuild) {
    return runOn(action, bparts.message, rebuild ? renderBar : null);
  }

  // いま開いているのがどの案件のバーか（下書き・編集モードのどちらでも使える）
  function barProjectId() {
    return draft ? draft.projectId : currentBar.projectId;
  }

  // いま開いているバーの読み書きの窓口
  function barAccess() {
    return draft ? draftBarAccess(draft) : storeBarAccess(currentBar.projectId, currentBar.barId);
  }

  function findCurrentBar() {
    return barAccess().read();
  }

  function renderBar() {
    var access = barAccess();
    var bar = access.read();
    if (!bar) { barDialog.close(); return; }

    bparts.body.innerHTML = '';
    bparts.body.appendChild(buildBarRow(bar, {
      projectId: barProjectId(), run: brun, access: access
    }));

    /*
     * 見出しは、編集モードならどの案件のバーかを示す案件名、
     * 新規作成モードなら「新規バー」（CLAUDE.md 5.11）。
     */
    if (draft) {
      bparts.title.textContent = '新規バー';
    } else {
      var project = Store.findProject(currentBar.projectId);
      bparts.title.textContent = project ? (project.title || '(無題)') : '';
    }

    // フッターは［このバーを削除］と［このバーを追加］を入れ替える（CLAUDE.md 5.11）
    bparts.addBar.hidden = !draft;
    bparts.removeBar.hidden = !!draft;
  }

  /*
   * ［このバーを追加］（CLAUDE.md 5.11）。
   * ここで初めてバーを作成・保存し、ポップアップを閉じます。
   * 作成そのものは通常の追加処理（Store.addBar）を使い、下書きの内容を当て直します。
   */
  function commitDraft() {
    if (!draft) { return; }
    var target = draft;
    var ok = brun(function () {
      var created = Store.addBar(target.projectId, Store.dayIndexFromSerial(target.bar.start));
      Store.updateBar(target.projectId, created.id, {
        stage: target.bar.stage,
        stageNo: target.bar.stageNo,
        status: target.bar.status,
        clsCheck: target.bar.clsCheck,
        markColor: target.bar.markColor,
        startYmd: Store.ymdTextFromSerial(target.bar.start),
        endYmd: Store.ymdTextFromSerial(target.bar.end)
      });
    });
    if (ok) { barDialog.close(); }
  }

  function buildBarDialog() {
    barDialog = el('dialog', 'modal modal--bar');

    var head = el('div', 'modal__head modal__head--draggable');
    bparts.title = el('h2', 'modal__title', '');
    head.appendChild(bparts.title);
    barDialog.appendChild(head);
    makeDraggable(barDialog, head);

    bparts.message = el('p', 'modal__message');
    bparts.message.hidden = true;
    barDialog.appendChild(bparts.message);

    var body = el('div', 'modal__body');
    bparts.body = el('div', 'settings__list');
    body.appendChild(bparts.body);

    /* ---- 下部のボタン（5.6 と同じ並び方） ---- */
    var foot = el('div', 'modal__foot');

    var toProject = el('button', 'modal__foot-button', '案件全体を編集…');
    toProject.type = 'button';
    toProject.addEventListener('click', function () {
      // 5.11 を閉じ、5.6 を通常どおり中央に表示する（CLAUDE.md 5.11）
      // 新規作成モードのときは下書きを破棄する（閉じたときに draft が消えます）
      var projectId = barProjectId();
      barDialog.close();
      openProject(projectId);
    });
    foot.appendChild(toProject);

    /*
     * 新規作成モードのときだけ出すボタン（CLAUDE.md 5.11）。
     * ここを押すまでバーは作られません。
     */
    bparts.addBar = el('button', 'modal__foot-button modal__foot-button--primary', 'このバーを追加');
    bparts.addBar.type = 'button';
    bparts.addBar.hidden = true;
    bparts.addBar.addEventListener('click', commitDraft);
    foot.appendChild(bparts.addBar);

    bparts.removeBar = el('button', 'modal__foot-button modal__foot-button--danger', 'このバーを削除');
    bparts.removeBar.type = 'button';
    bparts.removeBar.addEventListener('click', function () {
      var bar = findCurrentBar();
      if (!bar) { return; }
      // 確認ダイアログ必須（CLAUDE.md 5.11）
      if (!window.confirm('「' + Store.barLabel(bar) + '」のバーを削除します。よろしいですか？')) {
        return;
      }
      if (brun(function () { Store.removeBar(currentBar.projectId, currentBar.barId); })) {
        barDialog.close();
      }
    });
    foot.appendChild(bparts.removeBar);

    var close = el('button', 'modal__foot-button modal__foot-button--close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', function () { barDialog.close(); });
    foot.appendChild(close);

    body.appendChild(foot);
    barDialog.appendChild(body);

    /*
     * 閉じたら下書きを捨てる（CLAUDE.md 5.11）。
     * ［閉じる］・Esc・［案件全体を編集…］のどれでもここを通ります。
     */
    barDialog.addEventListener('close', function () { draft = null; });

    document.body.appendChild(barDialog);
  }

  /*
   * クリックしたバーの近くに置きます（画面内に収まるよう調整 / CLAUDE.md 5.11）。
   * anchor はクリックされたバーの要素。
   */
  function placeNearBar(anchor) {
    resetDialogPosition(barDialog);
    if (!anchor) { return; }

    var rect = barDialog.getBoundingClientRect();
    /*
     * anchor はクリックされたバーの要素、または
     * 空白セルのクリック時に render.js が渡す位置（同じ形のオブジェクト / CLAUDE.md 5.5）。
     */
    var from = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
    var gap = 8;

    // まずバーの下、入らなければ上に置く
    var top = from.bottom + gap;
    if (top + rect.height > window.innerHeight) { top = from.top - gap - rect.height; }
    var left = from.left;

    barDialog.style.margin = '0';
    barDialog.style.left = Math.min(Math.max(left, 0), Math.max(0, window.innerWidth - rect.width)) + 'px';
    barDialog.style.top = Math.min(Math.max(top, 0), Math.max(0, window.innerHeight - rect.height)) + 'px';
  }

  /*
   * 案件行の空白セルのクリックから呼ばれる（CLAUDE.md 5.5 / 5.11）。
   * 5.11 を新規作成モード（下書き）で開きます。
   * 初期値は［バーを追加］と同じ（ラフ・未着手・囲いなし）で、日付はクリックしたセルの1日。
   * この時点ではデータには何も作らず、［このバーを追加］を押して初めて作られます。
   */
  function addBarAt(projectId, dayIndex, anchor) {
    if (!Store.findProject(projectId)) { return; }
    if (!barDialog) { buildBarDialog(); }

    draft = { projectId: projectId, bar: Store.createBar(dayIndex) };
    currentBar = { projectId: projectId, barId: null };

    hideMessage(bparts.message);
    renderBar();
    resetDialogPosition(barDialog);
    barDialog.showModal();
    placeNearBar(anchor);
  }

  // バーのクリックから呼ばれる（CLAUDE.md 5.11）
  function openBar(projectId, barId, anchor) {
    var project = Store.findProject(projectId);
    if (!project) { return; }
    if (!barDialog) { buildBarDialog(); }

    draft = null; // 編集モードで開く（下書きは持ち越さない）
    currentBar = { projectId: projectId, barId: barId };
    if (!findCurrentBar()) { return; }

    hideMessage(bparts.message);
    renderBar();
    resetDialogPosition(barDialog);
    barDialog.showModal();
    placeNearBar(anchor);
  }

  /* ============================================================
   * 担当者ヘッダの直接編集（CLAUDE.md 5.13）
   *
   * 案件数・一言コメントはその場で入力欄に変わり、
   * 絵文字は直下に選択パネルを出します。
   * 名前・追加削除・所属変更は設定モーダル（5.8）のままです。
   * ============================================================ */

  var openEditor = null; // 開いている編集を閉じる関数（同時に1つだけ）

  function closeEditor() {
    if (openEditor) {
      var fn = openEditor;
      openEditor = null;
      fn();
    }
  }

  // 値を保存して画面を描き直す。拒否されたら理由を出して元に戻す
  function saveMemberField(member, key, value) {
    var patch = {};
    patch[key] = value;
    try {
      Store.updateMember(member.id, patch);
    } catch (e) {
      window.alert(e.message);
      return false;
    }
    if (onChange) { onChange(); }
    return true;
  }

  /* ---- 案件数・一言コメント: その場で入力欄に変える ---- */

  function editTextField(member, key, node) {
    var input = el('input', 'member__input');
    input.type = 'text';
    input.value = member[key] || '';
    // 表示位置のまま置き換え、レイアウトが大きく動かないようにする（CLAUDE.md 5.13）
    input.style.width = Math.max(node.getBoundingClientRect().width, 40) + 'px';

    var done = false;

    function finish(save) {
      if (done) { return; }
      done = true;
      openEditor = null;
      document.removeEventListener('mousedown', onOutside, true);
      if (save) {
        // 保存すると行が作り直されるので、入力欄は置き換えなくてよい
        if (saveMemberField(member, key, input.value)) { return; }
      }
      if (input.parentNode) { input.parentNode.replaceChild(node, input); }
    }

    function onOutside(e) {
      if (e.target !== input) { finish(true); } // 欄外クリックで確定
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });

    node.parentNode.replaceChild(input, node);
    input.focus();
    input.select();

    openEditor = function () { finish(false); };
    // 直後の同じクリックで閉じないよう、次の処理から監視する
    setTimeout(function () {
      if (!done) { document.addEventListener('mousedown', onOutside, true); }
    }, 0);
  }

  /* ---- 絵文字: 直下に選択パネルを出す ---- */

  function editEmojiField(member, node) {
    var panel = el('div', 'emojipick');

    function choose(value) {
      close();
      saveMemberField(member, 'emoji', value);
    }

    var none = el('button', 'emojipick__button emojipick__none', 'なし');
    none.type = 'button';
    none.addEventListener('click', function (e) { e.stopPropagation(); choose(''); });
    panel.appendChild(none);

    EMOJI_CHOICES.forEach(function (emoji) {
      var button = el('button', 'emojipick__button', emoji);
      button.type = 'button';
      if (emoji === member.emoji) { button.className += ' is-selected'; }
      button.addEventListener('click', function (e) { e.stopPropagation(); choose(emoji); });
      panel.appendChild(button);
    });

    function close() {
      openEditor = null;
      document.removeEventListener('mousedown', onOutside, true);
      if (panel.parentNode) { panel.parentNode.removeChild(panel); }
    }

    // パネル外クリックで取り消し（CLAUDE.md 5.13）
    function onOutside(e) {
      if (!panel.contains(e.target)) { close(); }
    }

    document.body.appendChild(panel);

    // クリックした項目の直下に置き、画面からはみ出さないようにする
    var from = node.getBoundingClientRect();
    var size = panel.getBoundingClientRect();
    var left = Math.min(from.left, Math.max(0, window.innerWidth - size.width - 4));
    var top = from.bottom + 4;
    if (top + size.height > window.innerHeight) { top = Math.max(0, from.top - 4 - size.height); }
    panel.style.left = Math.max(left, 4) + 'px';
    panel.style.top = top + 'px';

    openEditor = close;
    setTimeout(function () { document.addEventListener('mousedown', onOutside, true); }, 0);
  }

  /*
   * 担当者ヘッダの項目がクリックされたときの入口（render.js から呼ばれる）。
   * key は 'countText' / 'emoji' / 'comment' のいずれか。
   */
  function editMemberField(member, key, node) {
    closeEditor(); // 同時に開くのは1つだけ
    if (key === 'emoji') { editEmojiField(member, node); }
    else { editTextField(member, key, node); }
  }

  /* ------------------------------------------------------------
   * 公開
   * ------------------------------------------------------------ */

  function init(options) {
    onChange = (options || {}).onChange || null;
  }

  function openSettings() {
    if (!dialog) { build(); }
    clearMessage();
    renderLists();
    dialog.showModal();
  }

  // 案件行・バーのクリックから呼ばれる（CLAUDE.md 5.6）
  function openProject(projectId) {
    if (!Store.findProject(projectId)) { return; }
    if (!projectDialog) { buildProjectDialog(); }
    currentProjectId = projectId;
    hideMessage(pparts.message);
    clearNewBarMarks(); // 前回開いたときの強調表示は持ち越さない（CLAUDE.md 5.6）
    renderProject();
    resetDialogPosition(projectDialog); // 前回ドラッグした位置を消し、中央表示に戻す
    projectDialog.showModal();
    pparts.title.focus();
  }

  /*
   * 担当者ヘッダの「＋」から呼ばれる（CLAUDE.md 5.7）。
   * その担当者に割当済み・タイトル空・バー1本の案件を作って、そのまま開きます。
   */
  function addProject(memberId) {
    var project = null;
    try {
      project = Store.addProject(memberId);
    } catch (e) {
      window.alert(e.message);
      return;
    }
    if (onChange) { onChange(); }
    openProject(project.id);
  }

  return {
    init: init,
    openSettings: openSettings,
    openProject: openProject,
    openBar: openBar,
    addBarAt: addBarAt,
    editMemberField: editMemberField,
    addProject: addProject
  };
}());
