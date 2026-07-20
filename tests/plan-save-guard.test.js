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

// saveV4Data のソースを抽出（saveV4DataCtx テストで使用）
const saveV4DataSrc = extractFunction(scriptSrc, 'saveV4Data');

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
//   alertCalls    : 本操作関数（switchPlan等）が ctx.alert() を直接呼んだ場合に記録される
//                   （saveState/savePlansForCurrentRound スタブはalertを呼ばない。
//                    alertCalls.length === 0 が「操作関数自身はalertを呼ばない」ことの証明。
//                    実際の保存経路での alert 呼出し回数確認は末尾の saveV4Data テスト群を参照。
//                    合計: 0（操作関数） + 1（saveV4Data）= 保存失敗時に利用者へ警告が合計1回届く）
//   savePlansArgs : savePlansForCurrentRound 呼び出し時のスナップショット配列
//                   （本番と同じ r.plans 参照を使った plans・data の内容を検証可能）
//   renderTabsArgs: renderPlanTabs 呼び出し時の plans スナップショット配列
//   applyPlanArgs : applyPlan 呼び出し時の { plan, data } スナップショット配列
//   screenState   : 仮想スクリーン状態（最後の renderPlanTabs/applyPlan の引数を保持）
//                   tabs       → タブ一覧（名前・ID を含む）
//                   activePlan → 現在表示中のプランデータ（viewFilter, horseSelections を含む）
//                   activeTabId→ アクティブタブの planId
//
// PC・iPad 実確認について:
//   このテストファイルで確認できるのは、保存失敗時に renderPlanTabs/applyPlan が呼ばれないこと、
//   および単一コンテキストで再試行ロジックが成立することまでである。
//   末尾の screenState 比較はテスト用代替処理が保持する仮想状態の一致確認であり、
//   実DOM・viewport・タッチ操作・入力/メモ/集計表示を観測した事実ではない。
//   したがって PC・iPad で「現在画面に留まること」の実ブラウザ確認は未実施・未確認である。
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

  // ctx を定義する。
  // （ctx は const だが saveState の関数ボディは呼び出し時に評価されるため TDZ の問題はない）
  const ctx = vm.createContext({
    activePlanId: initActivePlanId,
    DEFAULT_PLAN_ID: 'default',

    // 初段保存スタブ: 成否のみを返す
    // （本番の alert は saveV4Data 内で呼ばれる。本テストでは操作関数自身が alert を呼ばないことを検証するため省略）
    saveState() {
      calls.push('saveState');
      return saveStateOk;
    },

    // 後段保存スタブ: 引数スナップショット保存、成否のみを返す
    // 本番同様に r.plans 参照を受け取るため、push 等の変更が data 内 plans に反映される
    savePlansForCurrentRound(data, plans) {
      calls.push('savePlansForCurrentRound');
      savePlansArgs.push({
        plansSnapshot: JSON.parse(JSON.stringify(plans)),
        dataSnapshot: JSON.parse(JSON.stringify(data)),
      });
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
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'switchPlan("plan-b")');

  // 呼出し記録（initScreen 分を除く）
  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  // 本操作関数はalertを直接呼ばない（alertはsaveV4Data内が担う）
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  // 後段保存・render・apply・filter は呼ばれない（= DOM変化なし）
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
});

test('switchPlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'switchPlan("plan-b")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  // 本操作関数はalertを直接呼ばない
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  // render・apply は呼ばれない（= DOM変化なし）
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
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
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'addPlan()');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
});

test('addPlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'addPlan()');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
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
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'duplicatePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
});

test('duplicatePlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'duplicatePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
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
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: false });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'renamePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
});

test('renamePlan: キャンセル → saveState・prompt のみ呼出し、savePlansForCurrentRound を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, promptResult: null });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'renamePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'prompt']);
  assert.equal(alertCalls.length, 0, 'キャンセル時 alert なし');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（タブ名変化なし）');
});

test('renamePlan: 後段失敗 → saveState・prompt を呼出し、renderPlanTabs を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, promptResult: '変更後名' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'renamePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'prompt', 'savePlansForCurrentRound']);
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（タブ名変化なし）');
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
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し');
});

test('deletePlan: キャンセル → saveState・confirm のみ呼出し、savePlansForCurrentRound を呼ばない・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, confirmResult: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'confirm']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, 'キャンセル時 alert なし');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（タブ変化なし）');
});

test('deletePlan: 1 プランのみ → confirm を呼ばず終了（削除禁止）・画面状態変化なし', () => {
  const { ctx, calls, alertCalls, renderTabsArgs, applyPlanArgs } = buildCtx({
    saveStateOk: true,
    initActivePlanId: 'plan-a',
    initPlans: [{ id: 'plan-a', name: 'プランA', viewFilter: 'all', horseSelections: {} }],
  });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '1 プランのみの場合 alert なし');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し');
});

test('deletePlan: 後段失敗 → activePlanId を復元し画面状態変化なし', () => {
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, confirmResult: true, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(calls.slice(callsBase), ['saveState', 'confirm', 'savePlansForCurrentRound']);
  assert.equal(ctx.activePlanId, 'plan-a');
  assert.equal(alertCalls.length, 0, '本操作関数はalertを呼ばない');
  assert.equal(renderTabsArgs.length, 0, 'renderPlanTabs 未呼出し（表示不変）');
  assert.equal(applyPlanArgs.length, 0, 'applyPlan 未呼出し（入力値・メモ・viewFilter 不変）');
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
// このテスト群で確認できる事実:
// (1) 各失敗テストで renderPlanTabs/applyPlan が呼ばれない
// (2) 下記テストで同一コンテキスト上・失敗後の同一状態から再試行し成功する
//
// このテスト群からの推論:
// (3) 保存失敗/再試行ロジック自体は CSS レイアウト・幅に依存しない
//
// 未確認事項:
// (4) PC・iPad 実ブラウザで保存失敗後も現在画面に留まること
// (5) PC・iPad 実ブラウザで入力・メモ・集計表示を含む同一状態から再試行できること
// ──────────────────────────────────────────────
test('switchPlan: 後段失敗後に再試行 → 保存回復で成功・画面状態が正しく更新される', () => {
  // 単一コンテキスト: 失敗後の同一画面・同一状態から再試行することを確認
  const { ctx, calls, alertCalls, savePlansArgs, renderTabsArgs, applyPlanArgs, screenState } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  const callsBase = calls.length;
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;

  // [第1回] 後段失敗: activePlanId 復元・render/apply 未呼出し
  run(ctx, 'switchPlan("plan-b")');
  assert.equal(ctx.activePlanId, 'plan-a', '失敗後: activePlanId 復元（再試行起点）');
  assert.equal(renderTabsArgs.length, 0, '失敗後: renderPlanTabs 未呼出し（画面不変）');
  assert.equal(applyPlanArgs.length, 0, '失敗後: applyPlan 未呼出し（画面不変）');
  assert.equal(alertCalls.length, 0, '失敗後: 本操作関数はalertを呼ばない');

  // 同一コンテキスト上で保存スタブを成功させ再試行する（失敗後の同一画面・同一状態での再試行）
  ctx.savePlansForCurrentRound = function(data, plans) {
    calls.push('savePlansForCurrentRound');
    savePlansArgs.push({
      plansSnapshot: JSON.parse(JSON.stringify(plans)),
      dataSnapshot: JSON.parse(JSON.stringify(data)),
    });
    return true;
  };

  // [第2回 = 再試行] 失敗後と同一コンテキスト・同一状態から保存成功
  run(ctx, 'switchPlan("plan-b")');
  assert.equal(ctx.activePlanId, 'plan-b', '再試行成功: activePlanId 更新');
  assert.equal(renderTabsArgs.length, 1, '再試行成功: renderPlanTabs 呼出し');
  assert.equal(applyPlanArgs.length, 1, '再試行成功: applyPlan 呼出し');
  assert.equal(screenState.activeTabId, 'plan-b', '再試行成功: アクティブタブ更新');
  assert.equal(screenState.activePlan.id, 'plan-b', '再試行成功: 表示プランデータ更新');
  assert.equal(screenState.activePlan.viewFilter, 'all', '再試行成功: viewFilter が保持');
  assert.deepEqual(screenState.activePlan.horseSelections, {}, '再試行成功: horseSelections が保持');
  assert.equal(alertCalls.length, 0, '再試行成功: alertなし');
});

// ──────────────────────────────────────────────
// 保存失敗後の仮想 screenState 一致確認
//
// ここで比較しているのは、renderPlanTabs/applyPlan のテスト用代替処理が保持する仮想状態である。
// これは論理分岐の自動試験であり、実DOM・viewport・タッチ操作の観測ではない。
// したがって PC・iPad 実ブラウザ確認の代替にはならず、未確認事項は残る。
// ──────────────────────────────────────────────

test('switchPlan: 初段失敗後 仮想screenState が操作前と同一（論理分岐の自動試験）', () => {
  const { ctx, screenState, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;
  const tabsBefore = JSON.parse(JSON.stringify(screenState.tabs));
  const activePlanBefore = JSON.parse(JSON.stringify(screenState.activePlan));
  const activeTabIdBefore = screenState.activeTabId;

  run(ctx, 'switchPlan("plan-b")');

  assert.deepEqual(screenState.tabs, tabsBefore, 'タブ表示が操作前と同一（現在画面に留まる）');
  assert.deepEqual(screenState.activePlan, activePlanBefore, 'プランデータが操作前と同一（現在画面に留まる）');
  assert.equal(screenState.activeTabId, activeTabIdBefore, 'アクティブタブが操作前と同一（現在画面に留まる）');
});

test('switchPlan: 後段失敗後 仮想screenState が操作前と同一（論理分岐の自動試験）', () => {
  const { ctx, screenState, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;
  const tabsBefore = JSON.parse(JSON.stringify(screenState.tabs));
  const activePlanBefore = JSON.parse(JSON.stringify(screenState.activePlan));
  const activeTabIdBefore = screenState.activeTabId;

  run(ctx, 'switchPlan("plan-b")');

  assert.deepEqual(screenState.tabs, tabsBefore, 'タブ表示が操作前と同一（現在画面に留まる）');
  assert.deepEqual(screenState.activePlan, activePlanBefore, 'プランデータが操作前と同一（現在画面に留まる）');
  assert.equal(screenState.activeTabId, activeTabIdBefore, 'アクティブタブが操作前と同一（現在画面に留まる）');
});

test('addPlan: 後段失敗後 仮想screenState が操作前と同一（論理分岐の自動試験）', () => {
  const { ctx, screenState, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;
  const tabsBefore = JSON.parse(JSON.stringify(screenState.tabs));
  const activePlanBefore = JSON.parse(JSON.stringify(screenState.activePlan));
  const activeTabIdBefore = screenState.activeTabId;

  run(ctx, 'addPlan()');

  assert.deepEqual(screenState.tabs, tabsBefore, 'タブ表示が操作前と同一（現在画面に留まる）');
  assert.deepEqual(screenState.activePlan, activePlanBefore, 'プランデータが操作前と同一（現在画面に留まる）');
  assert.equal(screenState.activeTabId, activeTabIdBefore, 'アクティブタブが操作前と同一（現在画面に留まる）');
  assert.equal(ctx.activePlanId, 'plan-a', 'activePlanId が操作前に復元（同一状態から再試行可能）');
});

test('deletePlan: 後段失敗後 仮想screenState が操作前と同一（論理分岐の自動試験）', () => {
  const { ctx, screenState, renderTabsArgs, applyPlanArgs } =
    buildCtx({ saveStateOk: true, savePlansOk: false, confirmResult: true, initActivePlanId: 'plan-a' });
  initScreen(ctx);
  renderTabsArgs.length = 0; applyPlanArgs.length = 0;
  const tabsBefore = JSON.parse(JSON.stringify(screenState.tabs));
  const activePlanBefore = JSON.parse(JSON.stringify(screenState.activePlan));
  const activeTabIdBefore = screenState.activeTabId;

  run(ctx, 'deletePlan("plan-a")');

  assert.deepEqual(screenState.tabs, tabsBefore, 'タブ表示が操作前と同一（現在画面に留まる）');
  assert.deepEqual(screenState.activePlan, activePlanBefore, 'プランデータが操作前と同一（現在画面に留まる）');
  assert.equal(screenState.activeTabId, activeTabIdBefore, 'アクティブタブが操作前と同一（現在画面に留まる）');
  assert.equal(ctx.activePlanId, 'plan-a', 'activePlanId が操作前に復元（同一状態から再試行可能）');
});

// ──────────────────────────────────────────────
// saveV4Data: 保存失敗時の alert 呼出し回数の確認
//
// 受入条件:「保存失敗時に、既存の利用者向け警告が合計1回表示される」
//
// 各操作関数（switchPlan等）は alert を直接呼ばない（各失敗テストの alertCalls.length === 0 で確認済み）。
// alert は saveV4Data 内で呼ばれる。以下テストで「実際の保存経路における alert 呼出し回数」を確認する。
// 合計: 0（操作関数） + 1（saveV4Data）= 保存失敗時に利用者へ警告が合計1回届く。
// ──────────────────────────────────────────────

// saveV4Data 単体テスト用コンテキストを構築する
function buildSaveV4Ctx({ writeV4Result = { ok: true }, storageReadError = '' } = {}) {
  const alertCalls = [];
  const ctx = vm.createContext({
    storageReadError,
    localStorage: {},
    STORAGE_KEY: 'test-key',
    BACKUP_STORAGE_KEY: 'test-backup-key',
    TurfightSchemaV4: {
      writeV4(_storage, _key, _backup, _data) {
        return writeV4Result;
      },
    },
    alert(msg) { alertCalls.push(msg); },
  });
  vm.runInContext(saveV4DataSrc, ctx);
  return { ctx, alertCalls };
}

test('saveV4Data: writeV4失敗 → alert が合計1回呼ばれる（実際の保存経路で利用者向け警告が1回届く）', () => {
  const { ctx, alertCalls } = buildSaveV4Ctx({ writeV4Result: { ok: false, error: 'テスト用エラー' } });
  const ok = vm.runInContext('saveV4Data({})', ctx);
  assert.equal(ok, false, '保存失敗を返す');
  assert.equal(alertCalls.length, 1, '保存失敗時に alert が合計1回呼ばれる');
  assert.ok(alertCalls[0].includes('保存またはバックアップに失敗しました'), 'alert メッセージが既存のものと一致');
  assert.ok(alertCalls[0].includes('テスト用エラー'), 'alert にエラー詳細が含まれる');
});

test('saveV4Data: storageReadError がある → alert が合計1回呼ばれる（読取エラー時の利用者向け警告が1回届く）', () => {
  const { ctx, alertCalls } = buildSaveV4Ctx({ storageReadError: '読取テストエラー' });
  const ok = vm.runInContext('saveV4Data({})', ctx);
  assert.equal(ok, false, '読取エラー時は保存中止を返す');
  assert.equal(alertCalls.length, 1, '読取エラー時に alert が合計1回呼ばれる');
  assert.ok(alertCalls[0].includes('読取テストエラー'), 'alert に storageReadError が含まれる');
  assert.ok(alertCalls[0].includes('元データを保護するため保存を中止しました'), 'alert に既存メッセージが含まれる');
});

test('saveV4Data: 成功 → alert 呼出しなし（成功時は利用者への警告なし）', () => {
  const { ctx, alertCalls } = buildSaveV4Ctx({ writeV4Result: { ok: true } });
  const ok = vm.runInContext('saveV4Data({})', ctx);
  assert.equal(ok, true, '成功を返す');
  assert.equal(alertCalls.length, 0, '成功時は alert なし');
});
