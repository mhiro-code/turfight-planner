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
// saveStateOk: 初段 saveState() の戻り値
// savePlansOk: 後段 savePlansForCurrentRound() の戻り値
// initActivePlanId: テスト開始時の activePlanId
// initPlans: getPlans が返すプラン配列
// promptResult: prompt() の戻り値（null でキャンセル扱い）
// confirmResult: confirm() の戻り値
function buildCtx({
  saveStateOk = true,
  savePlansOk = true,
  initActivePlanId = 'plan-a',
  promptResult = '新プラン名',
  confirmResult = true,
} = {}) {
  const calls = [];
  const basePlans = [
    { id: 'plan-a', name: 'プランA', viewFilter: 'all', horseSelections: {} },
    { id: 'plan-b', name: 'プランB', viewFilter: 'all', horseSelections: {} },
  ];

  const ctx = vm.createContext({
    // 検査対象のグローバル変数
    activePlanId: initActivePlanId,
    DEFAULT_PLAN_ID: 'default',

    // モック: 呼出しを記録して設定値を返す
    saveState() { calls.push('saveState'); return saveStateOk; },
    savePlansForCurrentRound(_data, _plans) { calls.push('savePlansForCurrentRound'); return savePlansOk; },

    // モック: 固定データを返す依存
    readStoredData() {
      return {
        schemaVersion: 4,
        activeRecruitmentRoundId: 'round-a',
        recruitmentRounds: {
          'round-a': {
            id: 'round-a',
            settings: { eventBudget: '', bulkRate: '0.9', voucherAmount: '' },
            activePlanId: initActivePlanId,
            plans: basePlans.map(p => Object.assign({}, p, { horseSelections: {} })),
          },
        },
      };
    },
    getPlans(data) {
      const r = data.recruitmentRounds['round-a'];
      return r ? r.plans.map(p => Object.assign({}, p, { horseSelections: {} })) : [];
    },
    getCurrentRecruitmentRound() { return { id: 'round-a' }; },
    createPlanFromLegacyData() {
      return { id: 'new', name: 'プラン1', viewFilter: 'all', horseSelections: {} };
    },

    // モック: 呼出しを記録するUI操作
    renderPlanTabs(_plans) { calls.push('renderPlanTabs'); },
    applyPlan(_plan, _data) { calls.push('applyPlan'); },
    applyFilter() { calls.push('applyFilter'); },

    // モック: ブラウザダイアログ
    prompt(_msg, _cur) { calls.push('prompt'); return promptResult; },
    confirm(_msg) { calls.push('confirm'); return confirmResult; },

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

  return { ctx, calls };
}

// vm コンテキスト内で関数を呼び出すヘルパー
function run(ctx, expr) {
  return vm.runInContext(expr, ctx);
}

// ──────────────────────────────────────────────
// switchPlan
// ──────────────────────────────────────────────
test('switchPlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'switchPlan("plan-b")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('switchPlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'switchPlan("plan-b")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('switchPlan: 成功 → 全工程を呼出し activePlanId を更新', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  run(ctx, 'switchPlan("plan-b")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.equal(ctx.activePlanId, 'plan-b');
});

// ──────────────────────────────────────────────
// addPlan
// ──────────────────────────────────────────────
test('addPlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'addPlan()');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('addPlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'addPlan()');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('addPlan: 成功 → 全工程を呼出し activePlanId を新 ID に更新', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  run(ctx, 'addPlan()');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.notEqual(ctx.activePlanId, 'plan-a');
});

// ──────────────────────────────────────────────
// duplicatePlan
// ──────────────────────────────────────────────
test('duplicatePlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'duplicatePlan("plan-a")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('duplicatePlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'duplicatePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('duplicatePlan: 成功 → 全工程を呼出し activePlanId を複製先 ID に更新', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  run(ctx, 'duplicatePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.notEqual(ctx.activePlanId, 'plan-a');
});

// ──────────────────────────────────────────────
// renamePlan
// ──────────────────────────────────────────────
test('renamePlan: 初段失敗 → saveState のみ呼出し、prompt を呼ばない', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: false });
  run(ctx, 'renamePlan("plan-a")');
  assert.deepEqual(calls, ['saveState']);
});

test('renamePlan: 後段失敗 → saveState・prompt を呼出し、renderPlanTabs を呼ばない', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: false, promptResult: '変更後名' });
  run(ctx, 'renamePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'prompt', 'savePlansForCurrentRound']);
});

test('renamePlan: 成功 → saveState・prompt・savePlans・renderPlanTabs を呼出す', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: true, promptResult: '変更後名' });
  run(ctx, 'renamePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'prompt', 'savePlansForCurrentRound', 'renderPlanTabs']);
});

// ──────────────────────────────────────────────
// deletePlan
// ──────────────────────────────────────────────
test('deletePlan: 初段失敗 → saveState のみ呼出し、confirm を呼ばない', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('deletePlan: 後段失敗 → activePlanId を復元し renderPlanTabs/applyPlan/applyFilter を呼ばない', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: false, confirmResult: true, initActivePlanId: 'plan-a' });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'confirm', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
});

test('deletePlan: 成功 → 全工程を呼出し activePlanId を残存プランの先頭に更新', () => {
  const { ctx, calls } = buildCtx({ saveStateOk: true, savePlansOk: true, confirmResult: true, initActivePlanId: 'plan-a' });
  run(ctx, 'deletePlan("plan-a")');
  assert.deepEqual(calls, ['saveState', 'confirm', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.equal(ctx.activePlanId, 'plan-b');
});
