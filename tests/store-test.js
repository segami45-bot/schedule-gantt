/*
 * store-test.js — データ層のテスト（CLAUDE.md 7 / 9-3）
 *
 * 実行方法:  node tests/store-test.js
 *
 * 検証対象: 日付変換・CRUD・migrate・担当者の付け替えと削除制約 ほか（CLAUDE.md 7）
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

// 「非表示を表示」トグルの状態（CLAUDE.md 5.4）
is(def.showHidden, false, '初期状態では非表示の案件を出さない');
is(Store.normalizeView({ startSerial: 0, dayCount: 7, showHidden: true }).showHidden, true,
   'showHidden が保存・復元できる');
is(Store.normalizeView({ startSerial: 0, dayCount: 7 }).showHidden, false,
   'showHidden の無い古い保存値はfalse扱い');
is(Store.normalizeView({ startSerial: 0, dayCount: 7, showHidden: 'yes' }).showHidden, false,
   'showHidden が真偽値でなければfalse扱い');

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
is(proj.assigneeId, miyachi.id, '追加した担当者に割り当てられる');
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
 * 10. 担当者の付け替え（CLAUDE.md 3・5.6）
 * ============================================================ */
group('担当者の付け替え');

is(Store.listProjects(miyachi.id).length, 1, '宮地さんの下に表示される');
is(Store.listProjects(sato.id).length, 0, '佐藤さんの下には出ない');

// 担当者を変えると、その担当者の下へ移る（複製ではなく移動）
Store.setAssignee(proj.id, sato.id);
is(Store.findProject(proj.id).assigneeId, sato.id, '担当者を付け替えられる');
is(Store.listProjects(sato.id).length, 1, '佐藤さんの下へ移る');
is(Store.listProjects(miyachi.id).length, 0, '宮地さんの下からは消える');
is(Store.getData().projects.length, 1, '案件が増えたりしない');

throws(function () { Store.setAssignee(proj.id, '無い'); }, '担当者が見つかりません', '無い担当者の指定は拒否');
is(Store.findProject(proj.id).assigneeId, sato.id, '拒否された後もデータは元のまま');

Store.setAssignee(proj.id, miyachi.id); // 以降のテストのため宮地さんへ戻す

/* ============================================================
 * 11. 担当者削除の制約（CLAUDE.md 5.8）
 * ============================================================ */
group('担当者削除の制約');

// 佐藤さんは担当案件が無いので削除できる
is(Store.assignedProjects(sato.id).length, 0, '佐藤さんの担当案件は0件');
Store.removeMember(sato.id);
is(Store.findMember(sato.id), null, '担当案件が無い担当者は削除できる');

// 宮地さんは案件を担当しているので削除できない
is(Store.assignedProjects(miyachi.id).length, 1, '宮地さんの担当案件は1件');
throws(function () { Store.removeMember(miyachi.id); }, '担当している案件', '担当案件がある担当者の削除は拒否');
throws(function () { Store.removeMember(miyachi.id); }, 'ABCフォーラム', '拒否メッセージに案件名が入る');
is(Store.findMember(miyachi.id) !== null, true, '拒否された後も担当者は残る');

/* ============================================================
 * 12. バーの CRUD（CLAUDE.md 5.5 / 5.6）
 * ============================================================ */
group('バーの追加・更新・削除');

var bar = Store.addBar(proj.id);
is(Store.findProject(proj.id).bars.length, 2, 'バーを追加できる');
is(bar.stage, 'ラフ', '追加したバーの初期工程はラフ');

Store.updateBar(proj.id, bar.id, { stage: '修正', stageNo: 3, status: '50',
                                   startYmd: '2026-07-29', endYmd: '2026-07-30' });
var updated = Store.findProject(proj.id).bars[1];
is(updated.start, 4802, '開始日がCLAUDE.md 4.2の例と同じ4802になる');
is(updated.end, 4805, '終了日がCLAUDE.md 4.2の例と同じ4805になる');
is(Store.barLabel(updated), '修正3', '修正は番号を連結したラベルになる');

Store.updateBar(proj.id, bar.id, { stage: '初校' });
is(Store.barLabel(Store.findProject(proj.id).bars[1]), '初校', '修正以外は番号を付けない');

/* ---- 工程の2つの性質（CLAUDE.md 3 / 5.5） ---- */
group('期間を持つ工程と、日付の性質を持つ工程');

is(Store.hasBar('初校'), true, '初校は色付きバーを持つ');
is(Store.hasBar('修正'), true, '修正は色付きバーを持つ');
is(Store.hasBar('ラフ'), true, 'ラフは色付きバーを持つ');
is(Store.hasBar('MT'), false, 'MTは文字ラベル工程');
is(Store.hasBar('入稿'), false, '入稿は文字ラベル工程');
is(Store.hasBar('納品'), false, '納品は文字ラベル工程');
is(Store.hasBar('TW'), false, 'TWは文字ラベル工程');
is(Store.hasBar('有休'), false, '有休は文字ラベル工程');
is(Store.STAGES.length, 8, '工程は8種');
is(Store.STAGES.join('/'), '初校/修正/ラフ/MT/入稿/納品/TW/有休', '工程の並び順が仕様どおり');
is(Store.STATUSES.length, 6, '状態は6種');
is(Store.STATUSES.join('/'), '未着手/制作中/校了/25/50/75', '状態の並び順が仕様どおり');

group('バーの追加・更新・削除（続き）');

// MT・入稿・納品は常に1日幅（CLAUDE.md 5.5）
Store.updateBar(proj.id, bar.id, { stage: '入稿', startYmd: '2026-08-03', endYmd: '2026-08-20' });
var nyuko = Store.findProject(proj.id).bars[1];
is(Store.barDayCount(nyuko), 1, '入稿は期間を指定しても1日幅になる');
is(nyuko.end, nyuko.start + 1, '入稿は end = start + 1');
is(Store.ymdTextFromSerial(nyuko.start), '2026-08-03', '入稿の日付は開始日が使われる');

Store.updateBar(proj.id, bar.id, { stage: '納品', startYmd: '2026-08-25' });
is(Store.barDayCount(Store.findProject(proj.id).bars[1]), 1, '納品も1日幅');

Store.updateBar(proj.id, bar.id, { stage: 'MT', startYmd: '2026-08-20', endYmd: '2026-08-28' });
var mt = Store.findProject(proj.id).bars[1];
is(Store.barDayCount(mt), 1, 'MTも期間を指定しても1日幅になる');
is(Store.ymdTextFromSerial(mt.start), '2026-08-20', 'MTの日付は開始日が使われる');
is(Store.barLabel(mt), 'MT', 'MTのラベルはそのまま');

/* ---- TW・有休（CLAUDE.md 3 / v2.8 で追加） ---- */
Store.updateBar(proj.id, bar.id, { stage: 'TW', startYmd: '2026-08-21', endYmd: '2026-08-25' });
var tw = Store.findProject(proj.id).bars[1];
is(Store.barDayCount(tw), 1, 'TWは期間を指定しても1日幅になる');
is(Store.ymdTextFromSerial(tw.start), '2026-08-21', 'TWの日付は開始日が使われる');
is(Store.barLabel(tw), 'TW', 'TWのラベルはそのまま（番号は付かない）');

Store.updateBar(proj.id, bar.id, { markColor: 'white' });
is(Store.findProject(proj.id).bars[1].markColor, 'white', 'TWでも文字色を白にできる');

Store.updateBar(proj.id, bar.id, { stage: '有休', startYmd: '2026-08-24' });
var yukyu = Store.findProject(proj.id).bars[1];
is(Store.barDayCount(yukyu), 1, '有休も1日幅');
is(Store.barLabel(yukyu), '有休', '有休のラベルはそのまま');
is(yukyu.markColor, 'white', '工程を変えても文字色は保たれる');
Store.updateBar(proj.id, bar.id, { markColor: 'default' });

// 期間ものに戻すと複数日にできる
Store.updateBar(proj.id, bar.id, { stage: 'ラフ', startYmd: '2026-08-03', endYmd: '2026-08-07' });
is(Store.barDayCount(Store.findProject(proj.id).bars[1]), 5, 'ラフは5日幅にできる');

// 終了日が開始日より前なら1日幅にそろえる
Store.updateBar(proj.id, bar.id, { startYmd: '2026-08-10', endYmd: '2026-08-01' });
is(Store.barDayCount(Store.findProject(proj.id).bars[1]), 1, '逆転した期間は1日幅にそろう');

/* ---- 囲い点線（CL&S確認中 / CLAUDE.md 5.5） ---- */
is(Store.findProject(proj.id).bars[1].clsCheck, false, '新しいバーの囲い点線は初期OFF');
Store.updateBar(proj.id, bar.id, { clsCheck: true });
is(Store.findProject(proj.id).bars[1].clsCheck, true, '囲い点線をONにできる');
Store.updateBar(proj.id, bar.id, { status: '校了' });
is(Store.findProject(proj.id).bars[1].clsCheck, true, '状態を変えても囲い点線は保たれる');
Store.updateBar(proj.id, bar.id, { clsCheck: false });
is(Store.findProject(proj.id).bars[1].clsCheck, false, '囲い点線をOFFにできる');
Store.updateBar(proj.id, bar.id, { clsCheck: 'yes' });
is(Store.findProject(proj.id).bars[1].clsCheck, false, '真偽値でない値はOFF扱い');

/* ---- MT・入稿・納品の文字色（CLAUDE.md 6.2） ---- */
Store.updateBar(proj.id, bar.id, { stage: '入稿', startYmd: '2026-08-12' });
is(Store.findProject(proj.id).bars[1].markColor, 'default', '新しいバーの文字色は既定色');
Store.updateBar(proj.id, bar.id, { markColor: 'white' });
is(Store.findProject(proj.id).bars[1].markColor, 'white', '文字色を白にできる');
Store.updateBar(proj.id, bar.id, { stage: '納品' });
is(Store.findProject(proj.id).bars[1].markColor, 'white', '工程を変えても文字色は保たれる');
Store.updateBar(proj.id, bar.id, { markColor: 'default' });
is(Store.findProject(proj.id).bars[1].markColor, 'default', '文字色を既定色に戻せる');
throws(function () { Store.updateBar(proj.id, bar.id, { markColor: '赤' }); },
       '文字色は', '一覧に無い文字色は拒否');

// 色付きバーに戻しても値は保持される（画面に出ないだけ / CLAUDE.md 4.3）
Store.updateBar(proj.id, bar.id, { markColor: 'white' });
Store.updateBar(proj.id, bar.id, { stage: 'ラフ', startYmd: '2026-08-10', endYmd: '2026-08-01' });
is(Store.findProject(proj.id).bars[1].markColor, 'white', '色付きバーでも文字色の値は保持される');

throws(function () { Store.updateBar(proj.id, bar.id, { stage: '再校' }); }, '工程は', '旧名称「再校」は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { status: '完了' }); }, '状態は', '旧名称「完了」は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { status: 'CL確認中' }); }, '状態は', '廃止した「CL確認中」は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { status: '進行中' }); }, '状態は', '一覧に無い状態は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { stageNo: 0 }); }, '修正の番号', '修正番号0は拒否');
throws(function () { Store.updateBar(proj.id, bar.id, { stageNo: 21 }); }, '修正の番号', '修正番号21は拒否');
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
is(parsed.dataVersion, 4, '書き出したJSONにdataVersionが入る');
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
    dataVersion: 4,
    departments: [{ id: deptId, name: '制作', order: 1 }],
    members: [{ id: memberId, deptId: deptId, name: '宮地 太郎', order: 1 }],
    projects: [{
      id: 'p1', title: 'テスト案件', assigneeId: memberId, hidden: false, order: 1,
      bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4802, end: 4805 }]
    }]
  };
  return Object.assign(base, overrides || {});
}

var m = Store.migrate(sample());
is(m.dataVersion, 4, 'dataVersionが4になる');
is(m.members[0].countText, '', '省略された自由項目は空文字で補われる');
is(m.members[0].emoji, '', 'emojiも空文字で補われる');
is(m.projects[0].bars[0].clsCheck, false, '省略された囲い点線はOFFで補われる');
is(m.projects[0].bars[0].markColor, 'default', '省略された文字色は既定色で補われる');

// dataVersion 省略は現行版として扱う
is(Store.migrate(sample({ dataVersion: undefined })).dataVersion, 4, 'dataVersion省略は現行版扱い');

// 一覧に無い文字色は既定色に直す
is(Store.migrate(sample({
  projects: [{ id: 'p1', title: 'x', assigneeId: memberId, hidden: false, order: 1,
    bars: [{ id: 'b1', stage: '入稿', stageNo: 1, status: '未着手', markColor: '青',
             start: 4802, end: 4803 }] }]
})).projects[0].bars[0].markColor, 'default', '不明な文字色は既定色に直す');

// バーの端の丸め
var mm = Store.migrate(sample({
  projects: [{ id: 'p1', title: 'ずれたバー', assigneeId: memberId, hidden: false, order: 1,
    bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4803, end: 4806 }] }]
}));
is(mm.projects[0].bars[0].start, 4802, '開始が午後だったら午前に丸める');
is(mm.projects[0].bars[0].end, 4807, '終了が午前だったら午後に丸める');
ok(Store.notes().length > 0, '自動修正した内容がnotesに残る');

// 入稿の1日幅化
var m1day = Store.migrate(sample({
  projects: [{ id: 'p1', title: '入稿', assigneeId: memberId, hidden: false, order: 1,
    bars: [{ id: 'b1', stage: '入稿', stageNo: 1, status: '未着手', start: 4802, end: 4811 }] }]
}));
is(m1day.projects[0].bars[0].end, 4803, '入稿は読み込み時に1日幅へそろえる');

// MTの1日幅化
var mMt = Store.migrate(sample({
  projects: [{ id: 'p1', title: 'MT', assigneeId: memberId, hidden: false, order: 1,
    bars: [{ id: 'b1', stage: 'MT', stageNo: 1, status: '未着手', start: 4802, end: 4821 }] }]
}));
is(mMt.projects[0].bars[0].end, 4803, 'MTも読み込み時に1日幅へそろえる');

// 修正番号の範囲外
var mNo = Store.migrate(sample({
  projects: [{ id: 'p1', title: '修正', assigneeId: memberId, hidden: false, order: 1,
    bars: [{ id: 'b1', stage: '修正', stageNo: 99, status: '50', start: 4802, end: 4805 }] }]
}));
is(mNo.projects[0].bars[0].stageNo, 1, '修正番号が範囲外なら1に補正');

// hidden 省略
var mHidden = Store.migrate(sample({
  projects: [{ id: 'p1', title: 'x', assigneeId: memberId, order: 1,
    bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4802, end: 4803 }] }]
}));
is(mHidden.projects[0].hidden, false, 'hidden省略はfalse扱い');

/* ============================================================
 * 15-b. dataVersion 1 → 2 の変換（CLAUDE.md 11 の v2.0）
 * ============================================================ */
group('migrate: 旧版（dataVersion 1）からの変換');

// 旧版のデータ。工程「再校」、状態「完了」「CL確認中」を含む
function sampleV1(bars) {
  return {
    dataVersion: 1,
    departments: [{ id: deptId, name: '制作', order: 1 }],
    members: [{ id: memberId, deptId: deptId, name: '宮地 太郎', order: 1 }],
    projects: [{
      id: 'p1', title: '旧データ', assigneeId: memberId, hidden: false, order: 1,
      bars: bars
    }]
  };
}

var v1 = Store.migrate(sampleV1([
  { id: 'b1', stage: '再校', stageNo: 3, status: '50', start: 4802, end: 4805 },
  { id: 'b2', stage: 'ラフ', stageNo: 1, status: '完了', start: 4800, end: 4801 },
  { id: 'b3', stage: '初校', stageNo: 1, status: 'CL確認中', start: 4806, end: 4809 },
  { id: 'b4', stage: '入稿', stageNo: 1, status: '未着手', start: 4810, end: 4811 }
]));
var v1bars = v1.projects[0].bars;

is(v1.dataVersion, 4, '読み込むとdataVersionが4になる');
is(v1bars[0].stage, '修正', '工程「再校」が「修正」になる');
is(v1bars[0].stageNo, 3, '再校の番号3が修正3として引き継がれる');
is(Store.barLabel(v1bars[0]), '修正3', 'ラベルが「修正3」になる');
is(v1bars[1].status, '校了', '状態「完了」が「校了」になる');
is(v1bars[2].status, '制作中', '状態「CL確認中」が「制作中」になる');
is(v1bars[2].clsCheck, true, '「CL確認中」だったバーは囲い点線がONになる');
is(v1bars[0].clsCheck, false, 'それ以外のバーの囲い点線はOFF');
is(v1bars[3].stage, '入稿', '入稿はそのまま残る');
is(v1bars[0].start, 4802, '日付は変換の影響を受けない');
is(v1bars[0].end, 4805, '終了日も変換の影響を受けない');
ok(Store.notes().length >= 3, '変換した内容がnotesに残る');

// 変換されたデータをもう一度読み込んでも変わらないこと
var again = Store.migrate(JSON.stringify(v1));
is(again.projects[0].bars[0].stage, '修正', '変換後のデータを再度読み込んでも変わらない');
is(again.projects[0].bars[2].clsCheck, true, '囲い点線も保たれる');
is(Store.notes().length, 0, '2度目の読み込みでは自動修正が起きない');

// 旧版に無かった MT は、旧データには出てこない
is(Store.migrate(sampleV1([
  { id: 'b1', stage: '納品', stageNo: 1, status: '完了', start: 4802, end: 4803 }
])).projects[0].bars[0].status, '校了', '納品の「完了」も「校了」になる');

is(v1bars[0].markColor, 'default', '旧版のバーには既定の文字色が入る');

/* ---- dataVersion 2 → 3（markColor の追加） ---- */
group('migrate: dataVersion 2 からの変換');

var v2 = Store.migrate({
  dataVersion: 2,
  departments: [{ id: deptId, name: '制作', order: 1 }],
  members: [{ id: memberId, deptId: deptId, name: '宮地 太郎', order: 1 }],
  projects: [{
    id: 'p1', title: 'v2の案件', assigneeIds: [memberId], hidden: false, order: 1,
    bars: [
      { id: 'b1', stage: '修正', stageNo: 2, status: '制作中', clsCheck: true,
        start: 4802, end: 4805 },
      { id: 'b2', stage: '入稿', stageNo: 1, status: '未着手', clsCheck: false,
        start: 4810, end: 4811 }
    ]
  }]
});
is(v2.dataVersion, 4, 'dataVersion 2 のデータは4になる');
is(v2.projects[0].bars[0].markColor, 'default', 'markColorが無ければ既定色が入る');
is(v2.projects[0].bars[1].markColor, 'default', '入稿にも既定色が入る');
is(v2.projects[0].bars[0].clsCheck, true, 'v2で付けた囲い点線はそのまま残る');
is(v2.projects[0].bars[0].stageNo, 2, 'v2の番号もそのまま残る');
is(v2.projects[0].assigneeId, memberId, 'assigneeIdsがassigneeIdに変換される');

/* ============================================================
 * 15-c. dataVersion 3 → 4 の変換（担当者の単一化 / CLAUDE.md 11 の v2.7）
 * ============================================================ */
group('migrate: dataVersion 3 からの変換（担当者の単一化）');

var deptB = 'd2';
var mA = 'mA', mB = 'mB', mC = 'mC';

function sampleV3(projects, members) {
  return {
    dataVersion: 3,
    departments: [{ id: deptId, name: '制作', order: 1 }, { id: deptB, name: '企画', order: 2 }],
    members: members || [
      { id: mA, deptId: deptId, name: '宮地 太郎', order: 1 },
      { id: mB, deptId: deptId, name: '佐藤 花子', order: 2 },
      { id: mC, deptId: deptB, name: '田中 一郎', order: 3 }
    ],
    projects: projects
  };
}

/* ---- ① 担当1名の案件はそのまま引き継がれる ---- */
var single = Store.migrate(sampleV3([{
  id: 'p1', title: '単独担当の案件', assigneeIds: [mA], hidden: true, order: 3,
  bars: [{ id: 'b1', stage: '修正', stageNo: 4, status: '制作中', clsCheck: true,
           markColor: 'white', start: 4802, end: 4809 }]
}]));

is(single.dataVersion, 4, 'dataVersionが4になる');
is(single.projects.length, 1, '担当1名の案件は1件のまま');
is(single.projects[0].id, 'p1', '案件IDはそのまま引き継がれる');
is(single.projects[0].assigneeId, mA, 'assigneeIdに担当者が入る');
is(single.projects[0].assigneeIds, undefined, '古いassigneeIdsは残らない');
is(single.projects[0].title, '単独担当の案件', 'タイトルはそのまま');
is(single.projects[0].hidden, true, 'hiddenはそのまま');
is(single.projects[0].order, 3, 'orderはそのまま');
is(single.projects[0].bars.length, 1, 'バーの本数はそのまま');
is(single.projects[0].bars[0].id, 'b1', 'バーIDもそのまま引き継がれる');
is(single.projects[0].bars[0].stageNo, 4, '修正番号はそのまま');
is(single.projects[0].bars[0].clsCheck, true, '囲い点線はそのまま');
is(single.projects[0].bars[0].markColor, 'white', '文字色はそのまま');
is(single.projects[0].bars[0].start, 4802, '開始日はそのまま');

/* ---- ② 担当2名の案件は2件に分割され、互いに独立する ---- */
var split = Store.migrate(sampleV3([{
  id: 'p2', title: '共同担当の案件', assigneeIds: [mA, mB], hidden: false, order: 1,
  bars: [
    { id: 'b1', stage: 'ラフ', stageNo: 1, status: '25', start: 4802, end: 4805 },
    { id: 'b2', stage: '入稿', stageNo: 1, status: '未着手', start: 4810, end: 4811 }
  ]
}]));

is(split.projects.length, 2, '担当2名の案件は2件に分割される');
is(split.projects[0].assigneeId, mA, '1件目は1人目の担当者');
is(split.projects[1].assigneeId, mB, '2件目は2人目の担当者');
is(split.projects[0].title, '共同担当の案件', '1件目のタイトルが複製される');
is(split.projects[1].title, '共同担当の案件', '2件目のタイトルも同じ');
is(split.projects[0].bars.length, 2, '1件目にバーが複製される');
is(split.projects[1].bars.length, 2, '2件目にもバーが複製される');
ok(split.projects[0].id !== split.projects[1].id, '2件の案件IDは別');
ok(split.projects[0].bars[0].id !== split.projects[1].bars[0].id, 'バーIDも別');
ok(split.projects[0].bars[1].id !== split.projects[1].bars[1].id, '2本目のバーIDも別');
ok(Store.notes().length > 0, '分割したことがnotesに残る');

// 片方のバーを編集しても、もう片方に影響しないこと（互いに独立）
Store.setData(split);
var pA = Store.getData().projects[0];
var pB = Store.getData().projects[1];
Store.updateBar(pA.id, pA.bars[0].id, { status: '75', startYmd: '2026-09-01', endYmd: '2026-09-03' });
is(Store.findProject(pA.id).bars[0].status, '75', '1件目のバーの状態が変わる');
is(Store.findProject(pB.id).bars[0].status, '25', '2件目のバーの状態は変わらない');
is(Store.ymdTextFromSerial(Store.findProject(pB.id).bars[0].start), '2026-07-29',
   '2件目のバーの日付も変わらない');

// 片方の案件を消しても、もう片方は残る
Store.removeProject(pA.id);
is(Store.getData().projects.length, 1, '1件消すともう1件だけ残る');
is(Store.findProject(pB.id) !== null, true, '残った案件は無事');

/* ---- 担当3名なら3件に分かれる ---- */
var split3 = Store.migrate(sampleV3([{
  id: 'p3', title: '3名の案件', assigneeIds: [mA, mB, mC], hidden: false, order: 1,
  bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4802, end: 4803 }]
}]));
is(split3.projects.length, 3, '担当3名の案件は3件に分割される');
is(split3.projects.map(function (p) { return p.assigneeId; }).join(','), mA + ',' + mB + ',' + mC,
   '3件がそれぞれの担当者に割り当てられる');

/* ---- ③ 想定外の担当0名は先頭の担当者に割り当てて保全する ---- */
var rescued = Store.migrate(sampleV3([{
  id: 'p4', title: '担当0名の案件', assigneeIds: [], hidden: false, order: 1,
  bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '未着手', start: 4802, end: 4803 }]
}]));
is(rescued.projects.length, 1, '担当0名でも案件は捨てられない');
is(rescued.projects[0].assigneeId, mA, '先頭の担当者に割り当てられる');
is(rescued.projects[0].title, '担当0名の案件', 'タイトルは保たれる');
is(rescued.projects[0].bars.length, 1, 'バーも保たれる');
ok(Store.notes().join('').indexOf('宮地 太郎') >= 0, '割り当て先がnotesに残る');

// 担当者が1人もいなければ、さすがに割り当てられないので拒否する
throws(function () {
  Store.migrate({
    dataVersion: 3,
    departments: [{ id: deptId, name: '制作', order: 1 }],
    members: [],
    projects: [{ id: 'p5', title: 'x', assigneeIds: [], order: 1, bars: [] }]
  });
}, '割り当てられる担当者もいません', '担当者が0人なら拒否する');

// 変換後のデータをもう一度読み込んでも変わらないこと
var again4 = Store.migrate(JSON.stringify(split));
is(again4.projects.length, 2, '変換後のデータを再度読み込んでも件数は変わらない');
is(again4.projects[0].assigneeId, mA, '担当者も変わらない');
is(Store.notes().length, 0, '2度目の読み込みでは分割の通知が出ない');

Store.setData(Store.createEmptyData());

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
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeId: '無い担当', order: 1, bars: [] }] }));
}, '存在しない担当者', '存在しない担当者を指す案件は拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', order: 1, bars: [] }] }));
}, '担当者がありません', '担当者の指定が無い案件は拒否');

// 旧版（dataVersion 3）でも、存在しない担当者は拒否する
throws(function () {
  Store.migrate({
    dataVersion: 3,
    departments: [{ id: deptId, name: '制作', order: 1 }],
    members: [{ id: memberId, deptId: deptId, name: '宮地 太郎', order: 1 }],
    projects: [{ id: 'p1', title: 'x', assigneeIds: ['無い担当'], order: 1, bars: [] }]
  });
}, '存在しない担当者', '旧版でも存在しない担当者は拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeId: memberId, order: 1,
    bars: [{ id: 'b1', stage: '責了', stageNo: 1, status: '未着手', start: 4802, end: 4803 }] }] }));
}, '不明な工程', '一覧に無い工程は拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeId: memberId, order: 1,
    bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '進行中', start: 4802, end: 4803 }] }] }));
}, '不明な状態', '一覧に無い状態は拒否');

// 名称の読み替えは dataVersion 1 のときだけ。2 のデータに旧名称があれば誤りとして拒否する
throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeId: memberId, order: 1,
    bars: [{ id: 'b1', stage: '再校', stageNo: 1, status: '未着手', start: 4802, end: 4803 }] }] }));
}, '不明な工程', 'dataVersion 2 のデータに「再校」があれば拒否');

throws(function () {
  Store.migrate(sample({ projects: [{ id: 'p1', title: 'x', assigneeId: memberId, order: 1,
    bars: [{ id: 'b1', stage: 'ラフ', stageNo: 1, status: '完了', start: 4802, end: 4803 }] }] }));
}, '不明な状態', 'dataVersion 2 のデータに「完了」があれば拒否');

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
