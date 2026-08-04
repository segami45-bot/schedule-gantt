/*
 * store-test.js — データ層のテスト（CLAUDE.md 7 / 9-3）
 *
 * 実行方法:  node tests/store-test.js
 *
 * 検証対象: 日付変換・CRUD・migrate・担当0名拒否 ほか（CLAUDE.md 7）
 */
'use strict';

var Store = require('../js/store.js');

var passed = 0;
var failed = 0;

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

// 例外が出ること（＝拒否されること）を確かめる。メッセージの一部も見る
function throws(fn, expectedPart, name) {
  try {
    fn();
    failed++;
    console.log('  NG ' + name + '\n     期待: 拒否される / 実際: 通ってしまった');
  } catch (e) {
    if (expectedPart && e.message.indexOf(expectedPart) < 0) {
      failed++;
      console.log('  NG ' + name + '\n     期待メッセージに「' + expectedPart +
                  '」を含む / 実際: ' + e.message);
    } else {
      passed++;
    }
  }
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
is(Store.barDayCount({ start: 4802, end: 4805 }), 2, '4802〜4805 は2日幅');

// 1日幅のバーは end = start + 1（CLAUDE.md 4.1）
var oneDay = Store.rangeFromDays(Store.dayIndexFromYmd(2026, 8, 4), Store.dayIndexFromYmd(2026, 8, 4));
is(oneDay.end, oneDay.start + 1, '1日幅は end = start + 1');
is(Store.barDayCount(oneDay), 1, '1日幅の日数は1');

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
  if (Store.dayIndexFromYmdText(Store.ymdTextFromDayIndex(idx)) !== idx) { roundTripNg++; }
}
is(roundTripNg, 0, '1200日ぶんすべて 通算日数 → 文字列 → 通算日数 が一致');

var stepNg = 0;
for (var j = 0; j < 1200; j++) {
  var d1 = Store.dateFromDayIndex(startIdx + j);
  var d2 = Store.dateFromDayIndex(startIdx + j + 1);
  if (Math.round((d2 - d1) / 86400000) !== 1) { stepNg++; }
}
is(stepNg, 0, '1200日ぶんすべて隣の日との差が1日');

/*
 * 夏時間（サマータイム）のある地域での確認。
 * 日本には夏時間が無いため、日本時間のままでは時計がずれる日を再現できません。
 * ここでは一時的にニューヨーク時間に切り替えて、切り替え日をまたいでも
 * 日付が1日ずれないことを確かめます（CLAUDE.md 4.1）。
 */
group('夏時間のある地域でも日付がずれないこと');

var savedTz = process.env.TZ;
process.env.TZ = 'America/New_York';

// 冬と夏で時差が変わっていれば、夏時間が効いている＝検証として意味がある
var winterOffset = new Date(2026, 0, 15).getTimezoneOffset();
var summerOffset = new Date(2026, 6, 15).getTimezoneOffset();
ok(winterOffset !== summerOffset, '検証用にニューヨーク時間へ切り替えられた');

// 2026年の米国夏時間は 3/8 開始・11/1 終了。その前後をまたいで調べる
var dstNg = 0;
[[2026, 3, 1], [2026, 10, 25]].forEach(function (ymd) {
  var from = Store.dayIndexFromYmd(ymd[0], ymd[1], ymd[2]);
  for (var k = 0; k < 20; k++) {
    var at = from + k;
    if (Store.dayIndexFromYmdText(Store.ymdTextFromDayIndex(at)) !== at) { dstNg++; }
  }
});
is(dstNg, 0, '夏時間の切り替え日をまたいでも日付が一致する');

// 切り替え日そのものの往復
is(Store.ymdTextFromDayIndex(Store.dayIndexFromYmd(2026, 3, 8)), '2026-03-08', '夏時間開始日の往復');
is(Store.ymdTextFromDayIndex(Store.dayIndexFromYmd(2026, 11, 1)), '2026-11-01', '夏時間終了日の往復');

if (savedTz === undefined) {
  delete process.env.TZ;
} else {
  process.env.TZ = savedTz;
}

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
is(Store.normalizeView(null).dayCount, 30, '壊れた値は既定値に戻す');
is(Store.normalizeView({ startSerial: 'x', dayCount: 10 }).dayCount, 30,
   '開始日が不正なら丸ごと既定値に戻す');

group('localStorageが無い環境での動作');
ok(Store.loadView().dayCount >= 1, 'loadView が落ちずに値を返す');
is(Store.saveView({ startSerial: 0, dayCount: 5 }).dayCount, 5, 'saveView が落ちずに値を返す');
is(Store.loadData().projects.length, 0, 'loadData が落ちずに空データを返す');

/* ============================================================
 * 7. 部署の CRUD（CLAUDE.md 5.8）
 * ============================================================ */
group('部署の追加・改名・削除');

Store.setData(Store.createEmptyData());

var dept = Store.addDepartment('制作');
is(Store.listDepartments().length, 1, '部署が1件追加される');
is(dept.name, '制作', '部署名が入る');
is(dept.order, 1, 'orderが1から採番される');
ok(/^[0-9a-f-]{36}$/.test(dept.id), 'idがUUID形式で自動生成される');

var dept2 = Store.addDepartment('営業');
is(dept2.order, 2, '2件目のorderは2');

Store.renameDepartment(dept.id, '制作部');
is(Store.findDepartment(dept.id).name, '制作部', '改名できる');

throws(function () { Store.addDepartment('  '); }, '部署名', '空の部署名は拒否');
throws(function () { Store.renameDepartment(dept.id, ''); }, '部署名', '空への改名は拒否');
throws(function () { Store.renameDepartment('無い', 'x'); }, '部署が見つかりません', '無い部署の改名は拒否');

Store.removeDepartment(dept2.id);
is(Store.listDepartments().length, 1, '担当者0人の部署は削除できる');

/* ============================================================
 * 8. 担当者の CRUD（CLAUDE.md 5.8）
 * ============================================================ */
group('担当者の追加・更新・削除');

var miyachi = Store.addMember(dept.id, '宮地 太郎', { countText: '9', emoji: '😊', comment: '手すきです' });
is(Store.listMembers(dept.id).length, 1, '担当者が追加される');
is(miyachi.countText, '9', 'countTextが入る');
is(miyachi.emoji, '😊', 'emojiが入る');
is(miyachi.comment, '手すきです', 'commentが入る');

var sato = Store.addMember(dept.id, '佐藤 花子');
is(sato.countText, '', '自由項目は省略すると空文字');
is(sato.comment, '', 'commentも空文字でよい');

Store.updateMember(sato.id, { emoji: '🌸', comment: '' });
is(Store.findMember(sato.id).emoji, '🌸', '絵文字を更新できる');
is(Store.findMember(sato.id).comment, '', 'コメントを空にできる');

throws(function () { Store.addMember('無い部署', 'x'); }, '部署が見つかりません', '無い部署への追加は拒否');
throws(function () { Store.addMember(dept.id, ' '); }, '担当者名', '空の担当者名は拒否');
throws(function () { Store.updateMember(sato.id, { name: '' }); }, '担当者名', '空への改名は拒否');
throws(function () { Store.updateMember(sato.id, { deptId: '無い' }); }, '部署が見つかりません', '無い部署への異動は拒否');

// 所属担当者がいる部署は削除できない（CLAUDE.md 5.8）
throws(function () { Store.removeDepartment(dept.id); }, '担当者が2人います', '担当者のいる部署の削除は拒否');

/* ============================================================
 * 9. 案件の CRUD（CLAUDE.md 5.7）
 * ============================================================ */
group('案件の新規追加');

var proj = Store.addProject(miyachi.id);
is(proj.title, '', 'タイトルは空で作られる');
is(proj.assigneeIds.length, 1, '担当者1名が割り当てられる');
is(proj.assigneeIds[0], miyachi.id, '追加した担当者に割り当てられる');
is(proj.hidden, false, '初期状態は非表示ではない');
is(proj.bars.length, 1, 'バーが1本作られる');
is(proj.bars[0].stage, 'ラフ', 'バーの初期工程はラフ');
is(proj.bars[0].status, '未着手', 'バーの初期状態は未着手');
is(Store.barDayCount(proj.bars[0]), 1, 'バーの初期期間は今日1日');
is(Store.dayIndexFromSerial(proj.bars[0].start), Store.todayDayIndex(), 'バーの開始日は今日');

throws(function () { Store.addProject('無い'); }, '担当者が見つかりません', '無い担当者への案件追加は拒否');

Store.updateProject(proj.id, { title: 'B88865_ABCフォーラムテキスト' });
is(Store.findProject(proj.id).title, 'B88865_ABCフォーラムテキスト', 'タイトルを更新できる');

/* ============================================================
 * 10. 担当0名の拒否（CLAUDE.md 4.3・7）
 * ============================================================ */
group('担当者0名の拒否');

throws(function () { Store.setAssignees(proj.id, []); }, '最低1名', '空配列での割当は拒否');
throws(function () { Store.setAssignees(proj.id, null); }, '担当者の指定', '配列でない指定は拒否');
throws(function () { Store.setAssignees(proj.id, ['無い']); }, '担当者が見つかりません', '無い担当者の指定は拒否');
is(Store.findProject(proj.id).assigneeIds.length, 1, '拒否された後もデータは元のまま');

// 多対多（同じ案件が複数担当者の下に出る / CLAUDE.md 3）
Store.setAssignees(proj.id, [miyachi.id, sato.id]);
is(Store.findProject(proj.id).assigneeIds.length, 2, '複数担当を設定できる');
is(Store.listProjects(miyachi.id).length, 1, '宮地さんの下に表示される');
is(Store.listProjects(sato.id).length, 1, '佐藤さんの下にも表示される');

Store.setAssignees(proj.id, [miyachi.id, miyachi.id, sato.id]);
is(Store.findProject(proj.id).assigneeIds.length, 2, '重複した指定は1つにまとめられる');

/* ============================================================
 * 11. 担当者削除の制約（CLAUDE.md 5.8）
 * ============================================================ */
group('担当者削除の制約');

// いまは2名担当なので、片方は外せる
is(Store.soleAssignedProjects(sato.id).length, 0, '佐藤さんが唯一の担当の案件は0件');
Store.removeMember(sato.id);
is(Store.findMember(sato.id), null, '複数担当の案件しか無い担当者は削除できる');
is(Store.findProject(proj.id).assigneeIds.length, 1, '削除された担当者は案件から外れる');

// 宮地さんは唯一の担当なので削除できない
is(Store.soleAssignedProjects(miyachi.id).length, 1, '宮地さんが唯一の担当の案件は1件');
throws(function () { Store.removeMember(miyachi.id); }, '唯一の担当', '唯一の担当者の削除は拒否');
throws(function () { Store.removeMember(miyachi.id); }, 'ABCフォーラム', '拒否メッセージに案件名が入る');
is(Store.findMember(miyachi.id) !== null, true, '拒否された後も担当者は残る');

/* ============================================================
 * 12. バーの CRUD（CLAUDE.md 5.5 / 5.6）
 * ============================================================ */
group('バーの追加・更新・削除');

var bar = Store.addBar(proj.id);
is(Store.findProject(proj.id).bars.length, 2, 'バーを追加できる');
is(bar.stage, 'ラフ', '追加したバーの初期工程はラフ');

Store.updateBar(proj.id, bar.id, { stage: '再校', stageNo: 3, status: '50',
                                   startYmd: '2026-07-29', endYmd: '2026-07-30' });
var updated = Store.findProject(proj.id).bars[1];
is(updated.start, 4802, '開始日がCLAUDE.md 4.2の例と同じ4802になる');
is(updated.end, 4805, '終了日がCLAUDE.md 4.2の例と同じ4805になる');
is(Store.barLabel(updated), '再校3', '再校は番号を連結したラベルになる');

Store.updateBar(proj.id, bar.id, { stage: '初校' });
is(Store.barLabel(Store.findProject(proj.id).bars[1]), '初校', '再校以外は番号を付けない');

// 入稿・納品は常に1日幅（CLAUDE.md 5.5）
Store.updateBar(proj.id, bar.id, { stage: '入稿', startYmd: '2026-08-03', endYmd: '2026-08-20' });
var nyuko = Store.findProject(proj.id).bars[1];
is(Store.barDayCount(nyuko), 1, '入稿は期間を指定しても1日幅になる');
is(nyuko.end, nyuko.start + 1, '入稿は end = start + 1');
is(Store.ymdTextFromSerial(nyuko.start), '2026-08-03', '入稿の日付は開始日が使われる');

Store.updateBar(proj.id, bar.id, { stage: '納品', startYmd: '2026-08-25' });
is(Store.barDayCount(Store.findProject(proj.id).bars[1]), 1, '納品も1日幅');

// 期間ものに戻すと複数日にできる
Store.updateBar(proj.id, bar.id, { stage: 'ラフ', startYmd: '2026-08-03', endYmd: '2026-08-07' });
is(Store.barDayCount(Store.findProject(proj.id).bars[1]), 5, 'ラフは5日幅にできる');

// 終了日が開始日より前なら1日幅にそろえる
Store.updateBar(proj.id, bar.id, { startYmd: '2026-08-10', endYmd: '2026-08-01' });
is(Store.barDayCount(Store.findProject(proj.id).bars[1]), 1, '逆転した期間は1日幅にそろう');

throws(function () { Store.updateBar(proj.id, bar.id, { stage: '校了' }); }, '工程は', '一覧に無い工程は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { status: '進行中' }); }, '状態は', '一覧に無い状態は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { stageNo: 0 }); }, '再校の番号', '再校番号0は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { stageNo: 21 }); }, '再校の番号', '再校番号21は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { startYmd: '2026/08/01' }); }, '開始日の形式', '不正な日付形式は拒否');
throws(function () { Store.updateBar(proj.id, 'barが無い', {}); }, 'バーが見つかりません', '無いバーの更新は拒否');

Store.removeBar(proj.id, bar.id);
is(Store.findProject(proj.id).bars.length, 1, 'バーを削除できる');

/* ============================================================
 * 13. 非表示（CLAUDE.md 5.4 / 5.6）
 * ============================================================ */
group('完了・非表示の切り替え');

Store.toggleHidden(proj.id);
is(Store.findProject(proj.id).hidden, true, '非表示にできる');
is(Store.listProjects(miyachi.id).length, 0, '通常の一覧には出ない');
is(Store.listProjects(miyachi.id, true).length, 1, '「非表示を表示」では出る');
Store.toggleHidden(proj.id);
is(Store.findProject(proj.id).hidden, false, '非表示を解除できる');

/* ============================================================
 * 14. JSONの書き出し・読み込み（CLAUDE.md 5.9）
 * ============================================================ */
group('JSONの書き出し・読み込み');

var json = Store.exportJson();
var parsed = JSON.parse(json);
is(parsed.dataVersion, 1, '書き出したJSONにdataVersionが入る');
is(parsed.departments.length, 1, '部署が書き出される');
is(parsed.members.length, 1, '担当者が書き出される');
is(parsed.projects.length, 1, '案件が書き出される');

is(Store.backupFileName(new Date(2026, 7, 4, 9, 5)), 'sgantt-backup-20260804-0905.json',
   'バックアップのファイル名が仕様どおり');
is(Store.backupFileName(new Date(2026, 11, 31, 23, 59)), 'sgantt-backup-20261231-2359.json',
   '年末・深夜でもファイル名が正しい');

// 全置換して戻せること
Store.setData(Store.createEmptyData());
is(Store.getData().projects.length, 0, 'いったん空にできる');
Store.importJson(json);
is(Store.getData().projects.length, 1, '書き出したJSONを読み込める');
is(Store.getData().projects[0].title, 'B88865_ABCフォーラムテキスト', 'タイトルが復元される');
is(Store.getData().members[0].emoji, '😊', '絵文字が復元される');

/* ============================================================
 * 15. migrate（CLAUDE.md 4.3）
 * ============================================================ */
group('migrate: 受け付ける入力の補正');

var deptId = 'd1';
var memberId = 'm1';

function sample(overrides) {
  var base = {
    dataVersion: 1,
    departments: [{ id: deptId, name: '制作', order: 1 }],
    members: [{ id: memberId, deptId: deptId, name: '宮地 太郎', order: 1 }],
    projects: [{
      id: 'p1', title: 'テスト案件', assigneeIds: [memberId], hidden: false, order: 1,
      bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4802, end: 4805 }]
    }]
  };
  return Object.assign(base, overrides || {});
}

var m = Store.migrate(sample());
is(m.dataVersion, 1, 'dataVersionが1になる');
is(m.members[0].countText, '', '省略された自由項目は空文字で補われる');
is(m.members[0].emoji, '', 'emojiも空文字で補われる');

// dataVersion 省略は現行版として扱う
is(Store.migrate(sample({ dataVersion: undefined })).dataVersion, 1, 'dataVersion省略は現行版扱い');

// バーの端の丸め
var mm = Store.migrate(sample({
  projects: [{ id: 'p1', title: 'ずれたバー', assigneeIds: [memberId], hidden: false, order: 1,
    bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4803, end: 4806 }] }]
}));
is(mm.projects[0].bars[0].start, 4802, '開始が午後だったら午前に丸める');
is(mm.projects[0].bars[0].end, 4807, '終了が午前だったら午後に丸める');
ok(Store.notes().length > 0, '自動修正した内容がnotesに残る');

// 入稿の1日幅化
var m1day = Store.migrate(sample({
  projects: [{ id: 'p1', title: '入稿', assigneeIds: [memberId], hidden: false, order: 1,
    bars: [{ id: 'b1', stage: '入稿', stageNo: 1, status: '未着手', start: 4802, end: 4811 }] }]
}));
is(m1day.projects[0].bars[0].end, 4803, '入稿は読み込み時に1日幅へそろえる');

// 再校番号の範囲外
var mNo = Store.migrate(sample({
  projects: [{ id: 'p1', title: '再校', assigneeIds: [memberId], hidden: false, order: 1,
    bars: [{ id: 'b1', stage: '再校', stageNo: 99, status: '50', start: 4802, end: 4805 }] }]
}));
is(mNo.projects[0].bars[0].stageNo, 1, '再校番号が範囲外なら1に補正');

// hidden 省略
var mHidden = Store.migrate(sample({
  projects: [{ id: 'p1', title: 'x', assigneeIds: [memberId], order: 1,
    bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4802, end: 4803 }] }]
}));
is(mHidden.projects[0].hidden, false, 'hidden省略はfalse扱い');

group('migrate: 拒否する入力');

throws(function () { Store.migrate('{壊れた'); }, 'JSONとして読み取れません', '壊れたJSON文字列は拒否');
throws(function () { Store.migrate(null); }, 'オブジェクトではありません', 'nullは拒否');
throws(function () { Store.migrate([1, 2]); }, 'オブジェクトではありません', '配列は拒否');
throws(function () { Store.migrate({ dataVersion: 1 }); }, 'departments', '必要な配列が無ければ拒否');
throws(function () { Store.migrate(sample({ dataVersion: 99 })); }, '新しい版', '未来のdataVersionは拒否');

throws(function () {
  Store.migrate(sample({ members: [{ id: 'm1', deptId: '無い部署', name: '宮地 太郎', order: 1 }] }));
}, '存在しない部署', '存在しない部署を指す担当者は拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeIds: ['無い担当'], order: 1, bars: [] }] }));
}, '存在しない担当者', '存在しない担当者を指す案件は拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeIds: [], order: 1, bars: [] }] }));
}, '担当者が1人もいません', '担当0名の案件は拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeIds: [memberId], order: 1,
    bars: [{ id: 'b1', stage: '校了', stageNo: 1, status: '未着手', start: 4802, end: 4803 }] }] }));
}, '不明な工程', '一覧に無い工程は拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeIds: [memberId], order: 1,
    bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '進行中', start: 4802, end: 4803 }] }] }));
}, '不明な状態', '一覧に無い状態は拒否');

// 読み込みに失敗しても現在のデータが残ること（CLAUDE.md 9.6）
group('読み込み失敗時に既存データを壊さない');

Store.importJson(json);
var before = Store.getData().projects.length;
throws(function () { Store.importJson('{壊れた'); }, 'JSONとして読み取れません', '壊れたファイルの読み込みは拒否');
is(Store.getData().projects.length, before, '拒否された後も既存データが残っている');

/* ============================================================
 * 16. 並び順（CLAUDE.md 4.3）
 * ============================================================ */
group('並び順');

Store.setData(Store.createEmptyData());
var dA = Store.addDepartment('A');
var dB = Store.addDepartment('B');
is(Store.listDepartments()[0].name, 'A', '登録順に並ぶ');
is(Store.listDepartments()[1].name, 'B', '2件目が後ろ');

var mA = Store.addMember(dA.id, '甲');
var mB = Store.addMember(dB.id, '乙');
is(Store.listMembers(dA.id).length, 1, '部署で担当者を絞り込める');
is(Store.listMembers().length, 2, '部署を指定しなければ全員返る');
is(Store.listMembers()[0].name, '甲', '担当者も登録順');

Store.addProject(mA.id);
Store.addProject(mA.id);
is(Store.listProjects(mA.id).length, 2, '同じ担当者に複数案件を持てる');
is(Store.listProjects(mB.id).length, 0, '別の担当者には出ない');

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
