const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schema = require('../js/schema-v4.js');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function input(value) {
  return {
    value: String(value),
    style: {},
    classList: { toggle() {} },
    scrollHeight: 44
  };
}

function horseCard(no, units, memo) {
  const attributes = { 'data-no': String(no) };
  const fields = {
    '.units': input(units),
    '.memo': input(memo)
  };
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    querySelector(selector) {
      return fields[selector];
    }
  };
}

function createHarness(storedData, options = {}) {
  const cards = options.cards || [horseCard('1', 3, 'updated memo')];
  const roundRoot = {
    querySelectorAll(selector) {
      return selector === '.horseCard' ? cards : [];
    }
  };
  const roundElement = {
    getAttribute(name) {
      if (name === 'data-recruitment-round-id') return options.roundId || 'round-current';
      if (name === 'data-recruitment-round-name') return 'Current Round';
      return null;
    },
    querySelectorAll: roundRoot.querySelectorAll
  };
  const elements = {
    eventBudget: input(options.eventBudget ?? '250000'),
    voucherAmount: input(options.voucherAmount ?? '15000'),
    bulkRate: input(options.bulkRate ?? '0.95'),
    viewFilter: input(options.viewFilter ?? 'selected'),
    eventBudgetSnapshot: { textContent: '' },
    voucherSnapshot: { textContent: '' },
    bulkRateSnapshot: { textContent: '' }
  };
  const document = {
    querySelectorAll(selector) {
      return selector === '[data-recruitment-round-id]' ? [roundElement] : [];
    },
    getElementById(id) {
      return elements[id];
    }
  };
  const writes = [];
  const localStorage = {
    getItem() {
      if (options.storageGetError) throw options.storageGetError;
      return JSON.stringify(storedData);
    },
    setItem(key, value) {
      writes.push([key, value]);
    }
  };
  const alerts = [];
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inlineScript, 'index.html inline script should exist');
  const definitionsOnly = inlineScript[1].split("setupHorseCards();")[0];
  const context = vm.createContext({
    console,
    document,
    localStorage,
    TurfightSchemaV4: schema,
    alert(message) {
      alerts.push(message);
    }
  });
  vm.runInContext(definitionsOnly, context, { filename: 'index.html' });
  context.activePlanId = options.activePlanId || 'plan-active';
  return { context, elements, cards, writes, alerts };
}

test('saving updates only the active round and plan while preserving unknown and inactive data', () => {
  const inactiveRound = {
    id: 'round-inactive',
    roundExtra: 'unchanged',
    settings: { eventBudget: '900', voucherAmount: '10', bulkRate: '0.9' },
    activePlanId: 'other',
    plans: [{
      id: 'other',
      name: 'Other',
      viewFilter: 'all',
      horseSelections: { 8: { units: 2, memo: 'keep' } }
    }]
  };
  const inactivePlan = {
    id: 'plan-inactive',
    name: 'Inactive',
    planExtra: 'unchanged',
    viewFilter: 'all',
    horseSelections: { 2: { units: 4, memo: 'keep inactive' } }
  };
  const storedData = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-inactive',
    rootExtra: { keep: true },
    recruitmentRounds: {
      'round-current': {
        id: 'round-current',
        roundExtra: 'keep round',
        settings: {
          eventBudget: '100000',
          voucherAmount: '5000',
          bulkRate: '0.9',
          settingsExtra: 'keep settings'
        },
        activePlanId: 'plan-inactive',
        plans: [{
          id: 'plan-active',
          name: 'Active',
          planExtra: 'keep plan',
          viewFilter: 'all',
          horseSelections: {
            1: { units: 1, memo: 'old memo', selectionExtra: 'keep selection' },
            99: { units: 7, memo: 'not in DOM', offCatalogExtra: true }
          }
        }, inactivePlan]
      },
      'round-inactive': inactiveRound
    }
  };
  const { context } = createHarness(storedData);

  const actual = plain(context.getSaveData());

  assert.deepEqual(actual, {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-current',
    rootExtra: { keep: true },
    recruitmentRounds: {
      'round-current': {
        id: 'round-current',
        roundExtra: 'keep round',
        settings: {
          eventBudget: 250000,
          voucherAmount: 15000,
          bulkRate: '0.95',
          settingsExtra: 'keep settings'
        },
        activePlanId: 'plan-active',
        plans: [{
          id: 'plan-active',
          name: 'Active',
          planExtra: 'keep plan',
          viewFilter: 'selected',
          horseSelections: {
            1: { units: 3, memo: 'updated memo', selectionExtra: 'keep selection' },
            99: { units: 7, memo: 'not in DOM', offCatalogExtra: true }
          }
        }, inactivePlan]
      },
      'round-inactive': inactiveRound
    }
  });
});

test('saving inserts a missing active plan once and preserves every inactive plan', () => {
  const inactivePlans = [
    { id: 'plan-one', name: 'One', viewFilter: 'all', horseSelections: {} },
    { id: 'plan-two', name: 'Two', viewFilter: 'selected', horseSelections: { 7: { units: 2, memo: 'keep' } } }
  ];
  const storedData = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-current',
    recruitmentRounds: {
      'round-current': {
        id: 'round-current',
        settings: { eventBudget: '', voucherAmount: '', bulkRate: '0.9' },
        activePlanId: 'plan-one',
        plans: inactivePlans
      }
    }
  };
  const { context } = createHarness(storedData, { activePlanId: 'plan-new' });

  const plans = plain(context.getSaveData().recruitmentRounds['round-current'].plans);

  assert.deepEqual(plans, [
    inactivePlans[0],
    inactivePlans[1],
    {
      id: 'plan-new',
      name: 'プラン1',
      viewFilter: 'selected',
      horseSelections: { 1: { units: 3, memo: 'updated memo' } }
    }
  ]);
});

test('round settings and plan state are applied through separate DOM responsibilities', () => {
  const storedData = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-current',
    recruitmentRounds: {
      'round-current': {
        id: 'round-current',
        settings: { eventBudget: '123000', voucherAmount: '4500', bulkRate: '0.9' },
        activePlanId: 'plan-active',
        plans: []
      }
    }
  };
  const card = horseCard('1', 8, 'before');
  const { context, elements } = createHarness(storedData, {
    cards: [card],
    eventBudget: '1',
    voucherAmount: '2',
    bulkRate: '0.95',
    viewFilter: 'no200'
  });

  context.applyRecruitmentRoundSettings(storedData);
  assert.deepEqual(
    {
      settings: [elements.eventBudget.value, elements.voucherAmount.value, elements.bulkRate.value],
      plan: [elements.viewFilter.value, card.querySelector('.units').value, card.querySelector('.memo').value]
    },
    {
      settings: ['123,000', '4,500', '0.9'],
      plan: ['no200', '8', 'before']
    }
  );

  context.applyPlan({
    id: 'plan-active',
    viewFilter: 'selected',
    horseSelections: { 1: { units: 4, memo: 'after' } }
  });
  assert.deepEqual(
    {
      settings: [elements.eventBudget.value, elements.voucherAmount.value, elements.bulkRate.value],
      plan: [elements.viewFilter.value, card.querySelector('.units').value, card.querySelector('.memo').value]
    },
    {
      settings: ['123,000', '4,500', '0.9'],
      plan: ['selected', 4, 'after']
    }
  );
});

test('storage read errors stop saveState before any storage write', () => {
  const { context, writes, alerts } = createHarness({}, {
    activePlanId: 'default',
    storageGetError: new Error('read denied')
  });

  assert.equal(context.saveState(), false);
  assert.equal(writes.length, 0);
  assert.equal(alerts.length, 1);
});

test('saveV4Data returns false without writing when writeV4 validation fails', () => {
  const valid = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-current',
    recruitmentRounds: {
      'round-current': {
        id: 'round-current',
        settings: {},
        activePlanId: 'plan-active',
        plans: [{ id: 'plan-active', horseSelections: {} }]
      }
    }
  };
  const { context, writes, alerts } = createHarness(valid);

  assert.equal(context.saveV4Data({ schemaVersion: 4, recruitmentRounds: {} }), false);
  assert.equal(writes.length, 0);
  assert.equal(alerts.length, 1);
});
