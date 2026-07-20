'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// index.html の <script> ブロックを抽出
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptStart = htmlSrc.indexOf('<script>') + '<script>'.length;
const scriptEnd = htmlSrc.lastIndexOf('</script>');
const scriptSrc = htmlSrc.slice(scriptStart, scriptEnd);

// 対象関数のソースをブレース対応で抽出
function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('Function not found: ' + name);
  let depth = 0, i = start;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    i++;
  }
  throw new Error('Unterminated function: ' + name);
}

const fnSrc = ['getDuplicatePlanName', 'switchPlan', 'addPlan', 'duplicatePlan', 'renamePlan', 'deletePlan']
  .map(n => extractFunction(scriptSrc, n))
  .join('\n');

// テスト用のコンテキストを構築する
// saveStateOk    : 初段 saveState() の戻り値
// savePlansOk    : 後段 savePlansForCurrentRound() の戻り値
// initActivePlanId: テスト開始時の activePlanId
// initPlans      : readStoredData が持つプラン配列（null のとき 2 件のデフォルトを使用）
// promptResult   : prompt() の戻り値（null でキャンセル扱い）
// confirmResult  : confirm() の戻り値
//
// 戻り値:
//   ctx           : vm コンテキスト
//   calls         : 呼び出し順を記録した文字列配列
//   alertCalls    : alert() に渡されたメッセージの配列（忠実なalert計測）
//   savePlansArgs : savePlansForCurrentRound 呼び出し時点のスナップショット配列
//   renderTabsArgs: renderPlanTabs に渡された plans の配列スナップショット
//   applyPlanArgs : applyPlan に渡された { plan, data } のスナップショット配列
//
// 注記: PC幅・iPad幅での「保存失敗後の現在画面維持・再試行可能」確認は
// Node.js VM 環境では DOM が存在しないため未確認。
function buildCtx({
  saveStateOk = true,
  savePlansOk = true,
  initActivePlanId = 'plan-a',
  promptResult = '新プラン名',
  confirmResult = true,
  initPlans = null,
} = {}) {
  const calls = [];
  const alertCalls = [];
  const savePlansArgs = [];
  const renderTabsArgs = [];
  const applyPlanArgs = [];

  const defaultPlans = [
    { id: 'plan-a', name: 'プランA', viewFilter: 'all', horseSelections: {} },
    { id: 'plan-b', name: 'プランB', viewFilter: 'all', horseSelections: {} },
  ];
  const sourcePlans = initPlans || defaultPlans;

  const ctx = vm.createContext({
    // 検査対象のグローバル変数
    activePlanId: initActivePlanId,
    DEFAULT_PLAN_ID: 'default',

    // モック: 呼出しを記録して設定値を返す。失敗時は忠実に alert を呼ぶ
    saveState() {
      calls.push('saveState');
      if (!saveStateOk) { alertCalls.push('saveState error'); }
      return saveStateOk;
    },
    savePlansForCurrentRound(data, plans) {
      calls.push('savePlansForCurrentRound');
      savePlansArgs.push({
        plansSnapshot: JSON.parse(JSON.stringify(plans)),
        dataSnapshot: JSON.parse(JSON.stringify(data)),
      });
      if (!savePlansOk) { alertCalls.push('savePlansForCurrentRound error'); }
      return savePlansOk;
    },

    // モック: 固定データを返す依存（readStoredData は毎回新しいオブジェクトを返す）
    readStoredData() {
      return {
        schemaVersion: 4,
        activeRecruitmentRoundId: 'round-a',
        recruitmentRounds: {
          'round-a': {
            id: 'round-a',
            settings: { eventBudget: '', bulkRate: '0.9', voucherAmount: '' },
            activePlanId: initActivePlanId,
            plans: sourcePlans.map(p => Object.assign({}, p, { horseSelections: {} })),
          },
        },
      };
    },
    // 本番同様に r.plans 参照をそのまま返す（コピーしない）
    getPlans(data) {
      const r = data.recruitmentRounds['round-a'];
      return r ? r.plans : [];
    },
    getCurrentRecruitmentRound() { return { id: 'round-a' }; },
    createPlanFromLegacyData() {
      return { id: 'new', name: 'プラン1', viewFilter: 'all', horseSelections: {} };
    },

    // モック: 呼出しを記録しつつ引数スナップショットを保存するUI操作
    renderPlanTabs(plans) {
      calls.push('renderPlanTabs');
      renderTabsArgs.push(JSON.parse(JSON.stringify(plans)));
    },
    applyPlan(plan, data) {
      calls.push('applyPlan');
      applyPlanArgs.push({
        plan: JSON.parse(JSON.stringify(plan)),
        data: JSON.parse(JSON.stringify(data)),
      });
    },
    applyFilter() { calls.push('applyFilter'); },

    // モック: ブラウザダイアログ
    prompt(_msg, _cur) { calls.push('prompt'); return promptResult; },
    confirm(_msg) { calls.push('confirm'); return confirmResult; },
    alert(msg) { alertCalls.push(msg); },

    // 標準ランタイム
    Date: { now() { return 99999; } },
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    Object: { assign: Object.assign },
    Array: Array,
    String: String,
    Number: Number,
  });

  // テスト対象関数を vm コンテキスト内に定義
  vm.runInContext(fnSrc, ctx);

  return { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs };
}

// vm コンテキスト内で関数を呼び出すヘルパー
function run(ctx, expr) {
  return vm.runInContext(expr, ctx);
}

// ──────────────────────────────────────────────
// switchPlan
// ──────────────────────────────────────────────
test('switchPlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'switchPlan("plan-b")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  // 初段失敗: 後段保存・render/apply/filter = 0 かつ alert が 1 回だけ
  assert.equal(alertCalls.length, 1, '初段失敗で alert が 1 回だけ呼ばれる');
});

test('switchPlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls, alertCalls, savePlansArgs } = buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'switchPlan("plan-b")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  // 後段失敗: alert が 1 回だけ、savePlans 引数スナップショットが記録されている
  assert.equal(alertCalls.length, 1, '後段失敗で alert が 1 回だけ呼ばれる');
  assert.equal(savePlansArgs.length, 1);
  assert.equal(savePlansArgs[0].plansSnapshot.length, 2, '後段失敗時 plans は変更なし (表示不変)');
});

test('switchPlan: 成功 → 全工程を呼出し activePlanId を更新', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  run(ctx, 'switchPlan("plan-b")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.equal(ctx.activePlanId, 'plan-b');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlansForCurrentRound 引数: plans は 2 件のまま、plan-b が含まれる
  assert.equal(savePlansArgs.length, 1);
  assert.equal(savePlansArgs[0].plansSnapshot.length, 2);
  assert.equal(savePlansArgs[0].plansSnapshot[1].id, 'plan-b');
  // renderPlanTabs に 2 件
  assert.equal(renderTabsArgs[0].length, 2);
  // applyPlan に plan-b と viewFilter: 'all' が渡される（deepEqual 検証）
  assert.equal(applyPlanArgs[0].plan.id, 'plan-b');
  assert.equal(applyPlanArgs[0].plan.viewFilter, 'all');
  assert.deepEqual(applyPlanArgs[0].plan.horseSelections, {});
});

// ──────────────────────────────────────────────
// addPlan
// ──────────────────────────────────────────────
test('addPlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'addPlan()');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '初段失敗で alert が 1 回だけ呼ばれる');
});

test('addPlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'addPlan()');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '後段失敗で alert が 1 回だけ呼ばれる');
});

test('addPlan: 成功 → 全工程を呼出し activePlanId を新 ID に更新', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  run(ctx, 'addPlan()');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.notEqual(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlansForCurrentRound 引数: 新プランが追加されて 3 件、末尾が新 ID
  assert.equal(savePlansArgs[0].plansSnapshot.length, 3);
  assert.equal(savePlansArgs[0].plansSnapshot[2].id, ctx.activePlanId);
  // renderPlanTabs に 3 件
  assert.equal(renderTabsArgs[0].length, 3);
  // applyPlan に新プランが渡される
  assert.equal(applyPlanArgs[0].plan.id, ctx.activePlanId);
});

// ──────────────────────────────────────────────
// duplicatePlan
// ──────────────────────────────────────────────
test('duplicatePlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'duplicatePlan("plan-a")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '初段失敗で alert が 1 回だけ呼ばれる');
});

test('duplicatePlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'duplicatePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '後段失敗で alert が 1 回だけ呼ばれる');
});

test('duplicatePlan: 成功 → 全工程を呼出し activePlanId を複製先 ID に更新', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  run(ctx, 'duplicatePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.notEqual(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlansForCurrentRound 引数: 複製プランが追加されて 3 件、名前が「プランAのコピー」
  assert.equal(savePlansArgs[0].plansSnapshot.length, 3);
  assert.equal(savePlansArgs[0].plansSnapshot[2].name, 'プランAのコピー');
  // renderPlanTabs に 3 件
  assert.equal(renderTabsArgs[0].length, 3);
  // applyPlan に複製先プランが渡される
  assert.equal(applyPlanArgs[0].plan.id, ctx.activePlanId);
});

// ──────────────────────────────────────────────
// renamePlan
// ──────────────────────────────────────────────
test('renamePlan: 初段失敗 → saveState のみ呼出し、prompt を呼ばない', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: false });
  run(ctx, 'renamePlan("plan-a")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(alertCalls.length, 1, '初段失敗で alert が 1 回だけ呼ばれる');
});

test('renamePlan: キャンセル → saveState・prompt のみ呼出し、savePlansForCurrentRound を呼ばない', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: true, promptResult: null });
  run(ctx, 'renamePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'prompt']);
  assert.equal(alertCalls.length, 0, 'キャンセル時 alert なし');
});

test('renamePlan: 後段失敗 → saveState・prompt を呼出し、renderPlanTabs を呼ばない', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: true, savePlansOk: false, promptResult: '変更後名' });
  run(ctx, 'renamePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'prompt', 'savePlansForCurrentRound']);
  assert.equal(alertCalls.length, 1, '後段失敗で alert が 1 回だけ呼ばれる');
});

test('renamePlan: 成功 → saveState・prompt・savePlans・renderPlanTabs を呼出す', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: true, promptResult: '変更後名' });
  run(ctx, 'renamePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'prompt', 'savePlansForCurrentRound', 'renderPlanTabs']);
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlansForCurrentRound 引数: plan-a の名前が変更されている
  assert.equal(savePlansArgs[0].plansSnapshot.find(p => p.id === 'plan-a').name, '変更後名');
  // renderPlanTabs にも変更後の名前が反映されている（タブ表示 deepEqual 検証）
  assert.equal(renderTabsArgs[0].find(p => p.id === 'plan-a').name, '変更後名');
  assert.equal(renderTabsArgs[0].length, 2);
});

// ──────────────────────────────────────────────
// deletePlan
// ──────────────────────────────────────────────
test('deletePlan: 初段失敗 → saveState のみ呼出し、confirm を呼ばない', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '初段失敗で alert が 1 回だけ呼ばれる');
});

test('deletePlan: キャンセル → saveState・confirm のみ呼出し、savePlansForCurrentRound を呼ばない', () => {
  const { ctx, calls, alertCalls } = buildCtx({ saveStateOk: true, confirmResult: false, initActivePlanId: 'plan-a' });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'confirm']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, 'キャンセル時 alert なし');
});

test('deletePlan: 1 プランのみ → confirm を呼ばず終了（削除禁止）', () => {
  const { ctx, calls, alertCalls } = buildCtx({
    saveStateOk: true,
    initActivePlanId: 'plan-a',
    initPlans: [{ id: 'plan-a', name: 'プランA', viewFilter: 'all', horseSelections: {} }],
  });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '1 プランのみの場合 alert なし');
});

test('deletePlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls, alertCalls, savePlansArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, confirmResult: true, initActivePlanId: 'plan-a' });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'confirm', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '後段失敗で alert が 1 回だけ呼ばれる');
  // 後段失敗時の savePlans 引数: plan-a が除かれた 1 件（削除済み配列が渡されたが保存失敗）
  assert.equal(savePlansArgs[0].plansSnapshot.length, 1);
  assert.equal(savePlansArgs[0].plansSnapshot[0].id, 'plan-b');
});

test('deletePlan: 成功 → 全工程を呼出し activePlanId を残存プランの先頭に更新', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: true, confirmResult: true, initActivePlanId: 'plan-a' });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'confirm', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.equal(ctx.activePlanId, 'plan-b');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlansForCurrentRound 引数: plan-a が削除されて 1 件
  assert.equal(savePlansArgs[0].plansSnapshot.length, 1);
  assert.equal(savePlansArgs[0].plansSnapshot[0].id, 'plan-b');
  // renderPlanTabs に 1 件
  assert.equal(renderTabsArgs[0].length, 1);
  // applyPlan に plan-b と viewFilter: 'all' が渡される（deepEqual 検証）
  assert.equal(applyPlanArgs[0].plan.id, 'plan-b');
  assert.equal(applyPlanArgs[0].plan.viewFilter, 'all');
});
