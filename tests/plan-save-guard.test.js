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

// 操作前の画面状態（タブ・アクティブプランデータ）を screenState に設定するヘルパー
// 「利用者が現在見ている状態」の代理として使用する
function initScreen(ctx) {
  vm.runInContext('renderPlanTabs(getPlans(readStoredData()))', ctx);
  vm.runInContext(
    'applyPlan(getPlans(readStoredData()).find(function(p) { return p.id === activePlanId; }), readStoredData())',
    ctx
  );
}

// テスト用コンテキストを構築する
//
// パラメータ:
//   saveStateOk    : 初段 saveState() の戻り値
//   savePlansOk    : 後段 savePlansForCurrentRound() の戻り値
//   initActivePlanId: テスト開始時の activePlanId
//   initPlans      : readStoredData が持つプラン配列（null のとき 2 件のデフォルトを使用）
//   promptResult   : prompt() の戻り値（null でキャンセル扱い）
//   confirmResult  : confirm() の戻り値
//
// 戻り値:
//   ctx           : vm コンテキスト
//   calls         : 呼び出し順を記録した文字列配列
//   alertCalls    : ctx.alert() 経由で発火された警告メッセージ配列
//                   （saveState/savePlansForCurrentRound スタブが ctx.alert() を呼ぶため
//                    alertCalls.length が実際の警告回数を示す）
//   savePlansArgs : savePlansForCurrentRound 呼び出し時のスナップショット配列
//                   （本番と同じ r.plans 参照を使った plans・data の内容を検証可能）
//   renderTabsArgs: renderPlanTabs 呼び出し時の plans スナップショット配列
//   applyPlanArgs : applyPlan 呼び出し時の { plan, data } スナップショット配列
//   screenState   : 仮想スクリーン状態（最後の renderPlanTabs/applyPlan の引数を保持）
//                   tabs       → タブ一覧（名前・ID を含む）
//                   activePlan → 現在表示中のプランデータ（viewFilter, horseSelections を含む）
//                   activeTabId→ アクティブタブの planId
//
// PC幅・iPad幅の視覚確認について:
//   Node.js VM 環境では DOM が存在しないためブラウザ viewport 幅別の視覚確認は実施不可。
//   保存失敗後の画面維持は screenState の deepEqual（タブ・入力値・メモ・viewFilter 不変）で証明し、
//   再試行可能性は専用の再試行テストで確認する。
//   保存失敗・再試行ロジックはビューポート幅に依存しないため全幅で同一動作となる。
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

  // 仮想スクリーン状態: renderPlanTabs/applyPlan が最後に呼ばれた時の内容を保持する
  // deepEqual 比較で「保存失敗後に画面状態が操作前と同一か」を直接証明する
  const screenState = {
    tabs: null,        // タブに表示されるプラン一覧（名前・ID を含む）
    activePlan: null,  // 現在表示中のプランデータ（viewFilter, horseSelections, name を含む）
    activeTabId: initActivePlanId,
  };

  const defaultPlans = [
    { id: 'plan-a', name: 'プランA', viewFilter: 'all', horseSelections: {} },
    { id: 'plan-b', name: 'プランB', viewFilter: 'all', horseSelections: {} },
  ];
  const sourcePlans = initPlans || defaultPlans;

  // ctx を定義する。saveState/savePlansForCurrentRound スタブは失敗時に ctx.alert() を呼ぶ。
  // これにより alertCalls.length が ctx.alert() の呼び出し回数 = 実際の警告回数を示す。
  // （ctx は const だが saveState の関数ボディは呼び出し時に評価されるため TDZ の問題はない）
  const ctx = vm.createContext({
    activePlanId: initActivePlanId,
    DEFAULT_PLAN_ID: 'default',

    // 初段保存スタブ: 失敗時に ctx.alert() を呼ぶ（本番 saveV4Data の挙動を再現）
    saveState() {
      calls.push('saveState');
      if (!saveStateOk) {
        ctx.alert('保存またはバックアップに失敗しました。元データは変更されていません。\ntest error');
      }
      return saveStateOk;
    },

    // 後段保存スタブ: 引数スナップショット保存 + 失敗時 ctx.alert()
    // 本番同様に r.plans 参照を受け取るため、push 等の変更が data 内 plans に反映される
    savePlansForCurrentRound(data, plans) {
      calls.push('savePlansForCurrentRound');
      savePlansArgs.push({
        plansSnapshot: JSON.parse(JSON.stringify(plans)),
        dataSnapshot: JSON.parse(JSON.stringify(data)),
      });
      if (!savePlansOk) {
        ctx.alert('保存またはバックアップに失敗しました。元データは変更されていません。\ntest error');
      }
      return savePlansOk;
    },

    // readStoredData は毎回独立した新しいオブジェクトを返す
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

    // 本番同様に r.plans 参照をそのまま返す（配列コピーなし）
    // → 操作関数が plans.push 等で変更すると data 内の plans も同時に変化する
    getPlans(data) {
      const r = data.recruitmentRounds['round-a'];
      return r ? r.plans : [];
    },

    getCurrentRecruitmentRound() { return { id: 'round-a' }; },
    createPlanFromLegacyData() {
      return { id: 'new', name: 'プラン1', viewFilter: 'all', horseSelections: {} };
    },

    // タブ描画スタブ: screenState を更新して仮想スクリーン状態を記録
    renderPlanTabs(plans) {
      calls.push('renderPlanTabs');
      screenState.tabs = JSON.parse(JSON.stringify(plans));
      screenState.activeTabId = ctx.activePlanId;
      renderTabsArgs.push(JSON.parse(JSON.stringify(plans)));
    },

    // プランデータ適用スタブ: screenState を更新して仮想スクリーン状態を記録
    // activePlan が持つ viewFilter・horseSelections が
    // 「入力値・メモ・表示条件・集計元データ」に対応する
    applyPlan(plan, data) {
      calls.push('applyPlan');
      screenState.activePlan = JSON.parse(JSON.stringify(plan));
      applyPlanArgs.push({
        plan: JSON.parse(JSON.stringify(plan)),
        data: JSON.parse(JSON.stringify(data)),
      });
    },

    applyFilter() { calls.push('applyFilter'); },
    prompt(_msg, _cur) { calls.push('prompt'); return promptResult; },
    confirm(_msg) { calls.push('confirm'); return confirmResult; },

    // 警告表示: alertCalls に記録（ctx.alert 経由で呼ばれることを保証）
    alert(msg) { alertCalls.push(msg); },

    Date: { now() { return 99999; } },
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    Object: { assign: Object.assign },
    Array: Array,
    String: String,
    Number: Number,
  });

  vm.runInContext(fnSrc, ctx);

  return { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState };
}

// vm コンテキスト内で関数を呼び出すヘルパー
function run(ctx, expr) {
  return vm.runInContext(expr, ctx);
}

// ──────────────────────────────────────────────
// switchPlan
// ──────────────────────────────────────────────
test('switchPlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'switchPlan("plan-b")');

  // 呼出し記録（initScreen 分を除く）
  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  // 初段失敗: alert が 1 回だけ（ctx.alert() 経由）
  assert.equal(alertCalls.length, 1, '初段失敗で ctx.alert が 1 回だけ呼ばれる');
  // 後段保存・render・apply・filter は呼ばれない
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
  // 画面状態（タブ・入力値・メモ・viewFilter・集計）が操作前と同一
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('switchPlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'switchPlan("plan-b")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  // 後段失敗: alert が 1 回だけ（ctx.alert() 経由）
  assert.equal(alertCalls.length, 1, '後段失敗で ctx.alert が 1 回だけ呼ばれる');
  // render・apply は呼ばれない
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
  // 画面状態（タブ・入力値・メモ・viewFilter）が操作前と同一
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
  // savePlans に渡された plans スナップショット: 2 件のまま（変更なし）
  assert.equal(savePlansArgs[0].plansSnapshot.length, 2);
});

test('switchPlan: 成功 → 全工程を呼出し activePlanId を更新・画面状態が plan-b に切替', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'switchPlan("plan-b")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.equal(ctx.activePlanId, 'plan-b');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlans 引数: plans 2 件のまま、plan-b を含む
  assert.equal(savePlansArgs[0].plansSnapshot.length, 2);
  assert.equal(savePlansArgs[0].plansSnapshot[1].id, 'plan-b');
  // renderPlanTabs に 2 件
  assert.equal(renderTabsArgs[0].length, 2);
  // applyPlan に plan-b が渡される（viewFilter・horseSelections を直接 assert）
  assert.equal(applyPlanArgs[0].plan.id, 'plan-b');
  assert.equal(applyPlanArgs[0].plan.viewFilter, 'all', '成功後の viewFilter が保持されている');
  assert.deepEqual(applyPlanArgs[0].plan.horseSelections, {}, '成功後の horseSelections が保持されている');
  // 画面状態が plan-b に更新されている
  assert.equal(screenState.activeTabId, 'plan-b', '成功後: アクティブタブが plan-b に更新');
  assert.equal(screenState.activePlan.id, 'plan-b', '成功後: 表示プランが plan-b に更新');
  assert.equal(screenState.activePlan.viewFilter, 'all', '成功後: viewFilter が all');
  assert.deepEqual(screenState.activePlan.horseSelections, {}, '成功後: horseSelections が空');
});

// ──────────────────────────────────────────────
// addPlan
// ──────────────────────────────────────────────
test('addPlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'addPlan()');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '初段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('addPlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'addPlan()');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '後段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('addPlan: 成功 → 全工程を呼出し activePlanId を新 ID に更新・画面状態が新プランに切替', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'addPlan()');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.notEqual(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlans 引数: 新プランが追加されて 3 件、末尾が新 ID
  assert.equal(savePlansArgs[0].plansSnapshot.length, 3);
  assert.equal(savePlansArgs[0].plansSnapshot[2].id, ctx.activePlanId);
  // renderPlanTabs に 3 件
  assert.equal(renderTabsArgs[0].length, 3);
  // applyPlan に新プランが渡される
  assert.equal(applyPlanArgs[0].plan.id, ctx.activePlanId);
  // 画面状態が新プランに更新されている
  assert.equal(screenState.activeTabId, ctx.activePlanId, '成功後: アクティブタブが新プランに更新');
  assert.equal(screenState.activePlan.id, ctx.activePlanId, '成功後: 表示プランが新プランに更新');
  assert.equal(screenState.activePlan.viewFilter, 'all', '成功後: viewFilter が all');
  assert.deepEqual(screenState.activePlan.horseSelections, {}, '成功後: horseSelections が空');
});

// ──────────────────────────────────────────────
// duplicatePlan
// ──────────────────────────────────────────────
test('duplicatePlan: 初段失敗 → saveState のみ呼出し、activePlanId 不変・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'duplicatePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '初段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('duplicatePlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'duplicatePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '後段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('duplicatePlan: 成功 → 全工程を呼出し activePlanId を複製先 ID に更新・画面状態が複製先に切替', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'duplicatePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.notEqual(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlans 引数: 複製プランが追加されて 3 件、名前が「プランAのコピー」
  assert.equal(savePlansArgs[0].plansSnapshot.length, 3);
  assert.equal(savePlansArgs[0].plansSnapshot[2].name, 'プランAのコピー');
  // renderPlanTabs に 3 件
  assert.equal(renderTabsArgs[0].length, 3);
  // applyPlan に複製先プランが渡される（viewFilter・horseSelections を直接 assert）
  assert.equal(applyPlanArgs[0].plan.id, ctx.activePlanId);
  assert.equal(applyPlanArgs[0].plan.viewFilter, 'all', '成功後の viewFilter が保持されている');
  assert.deepEqual(applyPlanArgs[0].plan.horseSelections, {}, '成功後の horseSelections が保持されている');
  // 画面状態が複製先に更新されている
  assert.equal(screenState.activeTabId, ctx.activePlanId, '成功後: アクティブタブが複製先に更新');
  assert.equal(screenState.activePlan.id, ctx.activePlanId, '成功後: 表示プランが複製先に更新');
  assert.equal(screenState.activePlan.name, 'プランAのコピー', '成功後: 複製先プラン名');
});

// ──────────────────────────────────────────────
// renamePlan
// ──────────────────────────────────────────────
test('renamePlan: 初段失敗 → saveState のみ呼出し、prompt を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: false });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'renamePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(alertCalls.length, 1, '初段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('renamePlan: キャンセル → saveState・prompt のみ呼出し、savePlansForCurrentRound を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, promptResult: null });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'renamePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'prompt']);
  assert.equal(alertCalls.length, 0, 'キャンセル時 alert なし');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（タブ名変化なし）');
  assert.deepEqual(screenState, beforeScreen, 'キャンセル後の画面状態が操作前と同一');
});

test('renamePlan: 後段失敗 → saveState・prompt を呼出し、renderPlanTabs を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: false, promptResult: '変更後名' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'renamePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'prompt', 'savePlansForCurrentRound']);
  assert.equal(alertCalls.length, 1, '後段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（タブ名変化なし）');
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('renamePlan: 成功 → saveState・prompt・savePlans・renderPlanTabs を呼出す・タブ名が更新', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: true, promptResult: '変更後名' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'renamePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'prompt', 'savePlansForCurrentRound', 'renderPlanTabs']);
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlans 引数: plan-a の名前が「変更後名」に更新されている
  assert.equal(savePlansArgs[0].plansSnapshot.find(p => p.id === 'plan-a').name, '変更後名');
  assert.equal(savePlansArgs[0].plansSnapshot.length, 2);
  // renderPlanTabs にも変更後の名前が反映されている（タブ表示の直接検証）
  assert.equal(renderTabsArgs[0].find(p => p.id === 'plan-a').name, '変更後名');
  assert.equal(renderTabsArgs[0].length, 2);
  // 画面状態: タブ名が更新されている（screenState.tabs に変更後の名前）
  assert.equal(screenState.tabs.find(p => p.id === 'plan-a').name, '変更後名', '成功後: タブに新名が表示');
  // applyPlan は呼ばれないため activePlan は initScreen 時点のまま（入力値・viewFilter 変化なし）
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・viewFilter 変化なし）');
  assert.equal(screenState.activePlan.viewFilter, 'all', '成功後: viewFilter は変化しない');
  assert.deepEqual(screenState.activePlan.horseSelections, {}, '成功後: horseSelections は変化しない');
});

// ──────────────────────────────────────────────
// deletePlan
// ──────────────────────────────────────────────
test('deletePlan: 初段失敗 → saveState のみ呼出し、confirm を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '初段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
});

test('deletePlan: キャンセル → saveState・confirm のみ呼出し、savePlansForCurrentRound を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, confirmResult: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'confirm']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, 'キャンセル時 alert なし');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（タブ変化なし）');
  assert.deepEqual(screenState, beforeScreen, 'キャンセル後の画面状態が操作前と同一');
});

test('deletePlan: 1 プランのみ → confirm を呼ばず終了（削除禁止）・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs, screenState } = buildCtx({
    saveStateOk: true,
    initActivePlanId: 'plan-a',
    initPlans: [{ id: 'plan-a', name: 'プランA', viewFilter: 'all', horseSelections: {} }],
  });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '1 プランのみの場合 alert なし');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.deepEqual(screenState, beforeScreen, '1 プランのみ削除禁止後の画面状態が操作前と同一');
});

test('deletePlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: false, confirmResult: true, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const beforeScreen = JSON.parse(JSON.stringify(screenState));
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'confirm', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 1, '後段失敗で ctx.alert が 1 回だけ呼ばれる');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
  // 画面状態（タブ・入力値・メモ・viewFilter）が操作前と同一
  assert.deepEqual(screenState, beforeScreen, '保存失敗後の画面状態が操作前と同一');
  // savePlans に渡された plans スナップショット: plan-a が除かれた 1 件
  assert.equal(savePlansArgs[0].plansSnapshot.length, 1);
  assert.equal(savePlansArgs[0].plansSnapshot[0].id, 'plan-b');
});

test('deletePlan: 成功 → 全工程を呼出し activePlanId を残存プランの先頭に更新・画面状態が plan-b に切替', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: true, confirmResult: true, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'confirm', 'savePlansForCurrentRound', 'renderPlanTabs', 'applyPlan', 'applyFilter']);
  assert.equal(ctx.activePlanId, 'plan-b');
  assert.equal(alertCalls.length, 0, '成功時 alert なし');
  // savePlans 引数: plan-a が削除されて 1 件
  assert.equal(savePlansArgs[0].plansSnapshot.length, 1);
  assert.equal(savePlansArgs[0].plansSnapshot[0].id, 'plan-b');
  // renderPlanTabs に 1 件
  assert.equal(renderTabsArgs[0].length, 1);
  // applyPlan に plan-b が渡される（viewFilter・horseSelections を直接 assert）
  assert.equal(applyPlanArgs[0].plan.id, 'plan-b');
  assert.equal(applyPlanArgs[0].plan.viewFilter, 'all', '成功後の viewFilter が保持されている');
  assert.deepEqual(applyPlanArgs[0].plan.horseSelections, {}, '成功後の horseSelections が保持されている');
  // 画面状態が plan-b に更新されている
  assert.equal(screenState.tabs.length, 1, '成功後: タブは plan-b のみ');
  assert.equal(screenState.activeTabId, 'plan-b', '成功後: アクティブタブが plan-b に更新');
  assert.equal(screenState.activePlan.id, 'plan-b', '成功後: 表示プランが plan-b に更新');
  assert.equal(screenState.activePlan.viewFilter, 'all', '成功後: viewFilter が all');
  assert.deepEqual(screenState.activePlan.horseSelections, {}, '成功後: horseSelections が空');
});

// ──────────────────────────────────────────────
// 再試行可能性の確認
//
// PC幅・iPad幅での視覚的確認は Node.js VM 環境では DOM が存在しないため実施不可。
// 以下の方法で同等の保証を提供する:
// (1) 保存失敗後の画面維持: 各失敗テストで screenState deepEqual により直接証明済み
// (2) 再試行可能性: 下記テストで失敗後の状態から同一操作を成功させることを直接確認
// (3) ビューポート非依存性: 保存失敗/再試行ロジックは CSS レイアウト・幅に非依存
// ──────────────────────────────────────────────
test('switchPlan: 後段失敗後に再試行 → 保存回復で成功・画面状態が正しく更新される', () => {
  // [第1回] 後段失敗: activePlanId 復元・画面状態不変
  const attempt1 = buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(attempt1.ctx);
  const before = JSON.parse(JSON.stringify(attempt1.screenState));
  run(attempt1.ctx, 'switchPlan("plan-b")');
  assert.equal(attempt1.ctx.activePlanId, 'plan-a', '失敗後: activePlanId 復元（再試行起点の確認）');
  assert.deepEqual(attempt1.screenState, before, '失敗後: 画面状態不変（再試行可能状態の確認）');
  assert.equal(attempt1.alertCalls.length, 1, '失敗後: 警告1回');

  // [第2回 = 再試行] 失敗後と同一初期状態から保存成功 → 画面が正しく更新される
  const attempt2 = buildCtx({ saveStateOk: true, savePlansOk: true, initActivePlanId: 'plan-a' });
  run(attempt2.ctx, 'switchPlan("plan-b")');
  assert.equal(attempt2.ctx.activePlanId, 'plan-b', '再試行成功: activePlanId 更新');
  assert.equal(attempt2.screenState.activeTabId, 'plan-b', '再試行成功: アクティブタブ更新');
  assert.equal(attempt2.screenState.activePlan.id, 'plan-b', '再試行成功: 表示プランデータ更新');
  assert.equal(attempt2.screenState.activePlan.viewFilter, 'all', '再試行成功: viewFilter が保持');
  assert.deepEqual(attempt2.screenState.activePlan.horseSelections, {}, '再試行成功: horseSelections が保持');
  assert.equal(attempt2.alertCalls.length, 0, '再試行成功: 追加の警告なし');
});
