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

    var emojiInput = input('settings__input settings__input--narrow', member.emoji, '絵文字');
    bind(emojiInput, 'emoji');
    row.appendChild(emojiInput);

    var commentInput = input('settings__input settings__input--grow', member.comment, '一言コメント');
    bind(commentInput, 'comment');
    row.appendChild(commentInput);

    var del = el('button', 'settings__delete', '削除');
    del.type = 'button';
    del.addEventListener('click', function () {
      // 唯一の担当になっている案件があれば Store 側が理由付きで拒否します
      var sole = Store.soleAssignedProjects(member.id);
      if (sole.length === 0) {
        var others = Store.listProjects(member.id, true).length;
        var extra = others > 0 ? '\n（' + others + '件の案件から担当を外します）' : '';
        if (!window.confirm('「' + member.name + '」さんを削除します。よろしいですか？' + extra)) {
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

  // このポップアップ用の実行ラッパ。失敗理由はポップアップ上部に出す
  function prun(action, rebuild) {
    return runOn(action, pparts.message, rebuild ? renderProject : null);
  }

  function currentProject() {
    return currentProjectId ? Store.findProject(currentProjectId) : null;
  }

  /* ---- 担当者のチェックボックス（最低1名 / CLAUDE.md 4.3・5.6） ---- */

  function buildAssignees(project) {
    var box = pparts.assignees;
    box.innerHTML = '';

    Store.listDepartments().forEach(function (dept) {
      var members = Store.listMembers(dept.id);
      if (members.length === 0) { return; }

      var group = el('div', 'assignee__group');
      group.appendChild(el('span', 'assignee__dept', dept.name));

      members.forEach(function (member) {
        var label = el('label', 'assignee');
        var check = el('input');
        check.type = 'checkbox';
        check.checked = project.assigneeIds.indexOf(member.id) >= 0;

        check.addEventListener('change', function () {
          var ids = [];
          box.querySelectorAll('input[type="checkbox"]').forEach(function (node) {
            if (node.checked) { ids.push(node.dataset.memberId); }
          });
          // 0名にする操作は Store 側が拒否します
          if (!prun(function () { Store.setAssignees(currentProjectId, ids); })) {
            check.checked = !check.checked; // 拒否されたらチェックを戻す
          }
        });

        check.dataset.memberId = member.id;
        label.appendChild(check);
        label.appendChild(el('span', null, member.name));
        group.appendChild(label);
      });

      box.appendChild(group);
    });
  }

  /* ---- バー1本ぶんの行（CLAUDE.md 5.6） ---- */

  function buildBarRow(bar) {
    var row = el('div', 'barrow');
    var isOneDay = Store.ONE_DAY_STAGES.indexOf(bar.stage) >= 0;

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
      prun(function () {
        Store.updateBar(currentProjectId, bar.id, { stage: stage.value });
      }, true);
    });
    row.appendChild(stage);

    // 番号セレクトは「再校」のときだけ出す（CLAUDE.md 5.6）
    if (bar.stage === Store.NUMBERED_STAGE) {
      var no = el('select', 'barrow__no');
      for (var i = Store.MIN_STAGE_NO; i <= Store.MAX_STAGE_NO; i++) {
        var opt = el('option', null, String(i));
        opt.value = String(i);
        if (i === bar.stageNo) { opt.selected = true; }
        no.appendChild(opt);
      }
      no.addEventListener('change', function () {
        prun(function () {
          Store.updateBar(currentProjectId, bar.id, { stageNo: no.value });
        });
      });
      row.appendChild(no);
    }

    // 状態パレット（7色ボタン）
    var palette = el('div', 'palette');
    Store.STATUSES.forEach(function (status) {
      var swatch = el('button', 'palette__button bar--' + Render.STATUS_KEYS[status]);
      swatch.type = 'button';
      swatch.title = Render.statusLabel(status);
      swatch.setAttribute('aria-label', Render.statusLabel(status));
      if (status === bar.status) { swatch.classList.add('is-selected'); }
      swatch.addEventListener('click', function () {
        if (prun(function () { Store.updateBar(currentProjectId, bar.id, { status: status }); })) {
          palette.querySelectorAll('.palette__button').forEach(function (node) {
            node.classList.remove('is-selected');
          });
          swatch.classList.add('is-selected');
        }
      });
      palette.appendChild(swatch);
    });
    row.appendChild(palette);

    // 開始日・終了日（ネイティブのカレンダーピッカーを使う / CLAUDE.md 5.6）
    var startInput = el('input', 'barrow__date');
    startInput.type = 'date';
    startInput.value = Store.ymdTextFromSerial(bar.start);

    var endInput = el('input', 'barrow__date');
    endInput.type = 'date';
    endInput.value = Store.ymdTextFromSerial(bar.end);
    if (isOneDay) {
      // 入稿・納品は常に1日幅なので終了日は触れないようにする（CLAUDE.md 5.5）
      endInput.disabled = true;
      endInput.title = bar.stage + 'は1日だけの予定です';
    }

    // 変更後は保存された値を読み直して入力欄に書き戻す（1日幅への補正が入るため）
    function syncDates() {
      var fresh = null;
      var project = currentProject();
      if (project) {
        project.bars.forEach(function (b) { if (b.id === bar.id) { fresh = b; } });
      }
      if (!fresh) { return; }
      startInput.value = Store.ymdTextFromSerial(fresh.start);
      endInput.value = Store.ymdTextFromSerial(fresh.end);
    }

    startInput.addEventListener('change', function () {
      prun(function () {
        Store.updateBar(currentProjectId, bar.id, { startYmd: startInput.value });
      });
      syncDates();
    });
    endInput.addEventListener('change', function () {
      prun(function () {
        Store.updateBar(currentProjectId, bar.id, { endYmd: endInput.value });
      });
      syncDates();
    });

    row.appendChild(startInput);
    row.appendChild(el('span', 'barrow__tilde', '〜'));
    row.appendChild(endInput);

    // バー削除
    var del = el('button', 'settings__delete', '削除');
    del.type = 'button';
    del.addEventListener('click', function () {
      prun(function () { Store.removeBar(currentProjectId, bar.id); }, true);
    });
    row.appendChild(del);

    return row;
  }

  /* ---- ポップアップの中身を作り直す ---- */

  function renderProject() {
    var project = currentProject();
    if (!project) { return; }

    pparts.title.value = project.title;
    buildAssignees(project);

    // バー一覧（開始日順に並べる）
    pparts.bars.innerHTML = '';
    var bars = project.bars.slice().sort(function (a, b) { return a.start - b.start; });
    if (bars.length === 0) {
      pparts.bars.appendChild(el('p', 'settings__empty', 'バーがありません。'));
    } else {
      bars.forEach(function (bar) { pparts.bars.appendChild(buildBarRow(bar)); });
    }

    // 完了・非表示トグルの状態
    pparts.hidden.setAttribute('aria-pressed', project.hidden ? 'true' : 'false');
    pparts.hidden.classList.toggle('is-on', project.hidden === true);
  }

  function buildProjectDialog() {
    projectDialog = el('dialog', 'modal modal--project');

    var head = el('div', 'modal__head');
    head.appendChild(el('h2', 'modal__title', '案件の編集'));
    var close = el('button', 'modal__close', '閉じる');
    close.type = 'button';
    close.addEventListener('click', function () { projectDialog.close(); });
    head.appendChild(close);
    projectDialog.appendChild(head);

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

    // ---- 担当者 ----
    var assigneeSection = section('担当者');
    assigneeSection.appendChild(el('p', 'settings__hint', '最低1名必要です。'));
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
      prun(function () { Store.addBar(currentProjectId); }, true);
    });
    barAdd.appendChild(addButton);
    barSection.appendChild(barAdd);
    body.appendChild(barSection);

    // ---- 下部のボタン ----
    var foot = el('div', 'modal__foot');

    pparts.hidden = el('button', 'modal__foot-button', '完了・非表示');
    pparts.hidden.type = 'button';
    pparts.hidden.setAttribute('aria-pressed', 'false');
    pparts.hidden.addEventListener('click', function () {
      prun(function () { Store.toggleHidden(currentProjectId); }, true);
    });
    foot.appendChild(pparts.hidden);

    var removeButton = el('button', 'modal__foot-button settings__delete', '案件を削除');
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

    body.appendChild(foot);
    projectDialog.appendChild(body);
    document.body.appendChild(projectDialog);
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
    renderProject();
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
    addProject: addProject
  };
}());
