/*
 * popup.js — 編集ポップアップ・設定モーダル（CLAUDE.md 7）
 *
 * 現在は設定モーダル（CLAUDE.md 5.8）のみを実装しています。
 * 案件の編集ポップアップ（5.6）と新規案件追加（5.7）は次の段階で追加します。
 *
 * 変更は即時反映＋自動保存です（保存ボタンは置かず、閉じるボタンのみ）。
 */
var Popup = (function () {
  'use strict';

  var onChange = null;   // 画面を描き直してもらうための連絡先（app.jsが渡す）
  var dialog = null;     // 設定モーダルの <dialog> 要素
  var parts = {};        // モーダル内のよく使う要素

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
  function showMessage(text, isError) {
    parts.message.textContent = text;
    parts.message.className = 'modal__message' + (isError ? ' is-error' : ' is-info');
    parts.message.hidden = false;
  }

  function clearMessage() {
    parts.message.hidden = true;
    parts.message.textContent = '';
  }

  /*
   * データを変える操作をまとめて包みます。
   * 失敗したらモーダル上部に日本語のメッセージを出し、画面は変えません。
   * 成功したら必要に応じて一覧を作り直し、ガント本体も描き直します。
   */
  function run(action, rebuild) {
    try {
      action();
      clearMessage();
      if (rebuild) { renderLists(); }
      if (onChange) { onChange(); }
      return true;
    } catch (e) {
      showMessage(e.message, true);
      return false;
    }
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

  return {
    init: init,
    openSettings: openSettings
  };
}());
