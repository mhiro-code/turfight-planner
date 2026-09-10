const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schema = require('../js/schema-v4.js');

function field(value) {
  return { value: String(value), style: {}, classList: { toggle() {} }, scrollHeight: 44 };
}

function card(no, units, memo) {
  const attributes = { 'data-no': String(no), 'data-shares': '1000' };
  const fields = { '.units': field(units), '.memo': field(memo) };
  return {
    classList: { contains() { return false; }, add() {}, remove() {}, toggle() {} },
    getAttribute(name) { return attributes[name] ?? null; },
    setAttribute(name, value) { attributes[name] = String(value); },
    querySelector(selector) { return fields[selector]; }
  };
}

function round(id, name, cards) {
  const attributes = {
    'data-recruitment-round-id': id,
    'data-recruitment-round-name': name
  };
  return {
    hidden: false,
    getAttribute(name) { return attributes[name] ?? null; },
    setAttribute(name, value) { attributes[name] = String(value); },
    querySelectorAll(selector) { return selector === '.horseCard' ? cards : []; }
  };
}

function createHarness(storedData, options = {}) {
  const oldCards = options.oldCards || [card('1', 3, 'old draft')];
  const newCards = options.newCards || [card('2', 0, '')];
  const roots = options.roots || [round('round-old', 'Old round', oldCards), round('round-new', 'New round', newCards)];
  const elements = {
    eventBudget: field('0'), voucherAmount: field('0'), bulkRate: field('0.9'), viewFilter: field('all'),
    eventBudgetSnapshot: { textContent: '' }, voucherSnapshot: { textContent: '' }, bulkRateSnapshot: { textContent: '' },
    recruitmentRoundSelector: { value: '', options: [], innerHTML: '', appendChild(option) { this.options.push(option); } }
  };
  const writes = [];
  const storage = new Map([['hitokuchiPlanner.card.v5.fixed', JSON.stringify(storedData)]]);
  const document = {
    querySelectorAll(selector) { return selector === '[data-recruitment-round-id]' ? roots : []; },
    getElementById(id) { return elements[id]; },
    createElement() { return { setAttribute() {}, appendChild() {}, className: '', textContent: '', value: '' }; }
  };
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  const definitionsOnly = inlineScript[1].split("setupHorseCards();")[0];
  const context = vm.createContext({
    document,
    localStorage: {
      getItem(key) { if (options.storageGetError) throw options.storageGetError; return storage.get(key) ?? null; },
      setItem(key, value) { writes.push([key, value]); storage.set(key, value); }
    },
    TurfightSchemaV4: schema,
    alert() {},
    window: { requestAnimationFrame(fn) { fn(); } }
  });
  vm.runInContext(definitionsOnly, context, { filename: 'index.html' });
  context.renderPlanTabs = function() {};
  context.applyFilter = function() { context.saveState(); };
  return { context, roots, oldCards, newCards, elements, writes };
}

test('saved active round selects the matching DOM catalog root and only its cards receive plan state', () => {
  const data = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-new',
    recruitmentRounds: {
      'round-old': { id: 'round-old', settings: {}, activePlanId: 'old-plan', plans: [{ id: 'old-plan', viewFilter: 'selected', horseSelections: { 1: { units: 7, memo: 'keep old' } } }] },
      'round-new': { id: 'round-new', settings: { eventBudget: '2000', voucherAmount: '5', bulkRate: '0.95' }, activePlanId: 'new-plan', plans: [{ id: 'new-plan', viewFilter: 'selected', horseSelections: { 2: { units: 4, memo: 'new draft' } } }] }
    }
  };
  const { context, roots, oldCards, newCards, elements } = createHarness(data);

  context.loadState();

  assert.equal(context.getCurrentRecruitmentRound().id, 'round-new');
  assert.deepEqual(roots.map(root => root.hidden), [true, false]);
  assert.equal(elements.recruitmentRoundSelector.value, 'round-new');
  assert.equal(oldCards[0].querySelector('.units').value, '3');
  assert.equal(newCards[0].querySelector('.units').value, 4);
  assert.equal(newCards[0].querySelector('.memo').value, 'new draft');
});

test('switching rounds saves the previous round, retains unknown data, and applies the selected round', () => {
  const data = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-old',
    rootExtra: { retained: true },
    recruitmentRounds: {
      'round-old': { id: 'round-old', roundExtra: 'old', settings: {}, activePlanId: 'old-plan', plans: [{ id: 'old-plan', planExtra: 'old', viewFilter: 'all', horseSelections: { 1: { units: 1, memo: 'before', selectionExtra: 'keep' } } }] },
      'round-new': { id: 'round-new', roundExtra: 'new', settings: { eventBudget: '8', voucherAmount: '', bulkRate: '0.9' }, activePlanId: 'new-plan', plans: [{ id: 'new-plan', planExtra: 'new', viewFilter: 'selected', horseSelections: { 2: { units: 2, memo: 'next' } } }] }
    }
  };
  const { context, oldCards, newCards, roots } = createHarness(data);
  context.loadState();
  oldCards[0].querySelector('.units').value = '6';
  oldCards[0].querySelector('.memo').value = 'saved old';

  assert.equal(context.selectRecruitmentRound('round-new'), true);
  const saved = JSON.parse(context.localStorage.getItem('hitokuchiPlanner.card.v5.fixed'));

  assert.equal(saved.activeRecruitmentRoundId, 'round-new');
  assert.deepEqual(saved.rootExtra, { retained: true });
  assert.deepEqual(saved.recruitmentRounds['round-old'].plans[0].horseSelections[1], { units: 6, memo: 'saved old', selectionExtra: 'keep' });
  assert.equal(saved.recruitmentRounds['round-new'].roundExtra, 'new');
  assert.deepEqual(roots.map(root => root.hidden), [true, false]);
  assert.equal(newCards[0].querySelector('.units').value, 2);
});

test('a missing or unavailable active ID falls back to the first catalog round without treating other DOM roots as current', () => {
  const data = { schemaVersion: 4, activeRecruitmentRoundId: 'missing', recruitmentRounds: {
    missing: { id: 'missing', settings: {}, activePlanId: 'p', plans: [{ id: 'p', horseSelections: {} }] }
  } };
  const { context, roots } = createHarness(data);

  context.loadState();

  assert.equal(context.getCurrentRecruitmentRound().id, 'round-old');
  assert.deepEqual(roots.map(root => root.hidden), [false, true]);
});

test('one catalog root and a DOM root without an ID use the documented fallback without showing a selector', () => {
  const onlyCard = card('1', 0, '');
  const noIdRoot = {
    hidden: false,
    getAttribute(name) { return name === 'data-recruitment-round-name' ? 'Only round' : null; },
    querySelectorAll(selector) { return selector === '.horseCard' ? [onlyCard] : []; }
  };
  const { context, elements } = createHarness({}, { roots: [noIdRoot] });

  context.renderRecruitmentRoundSelector();
  context.loadState();

  assert.equal(context.getCurrentRecruitmentRound().id, 'round-1');
  assert.equal(elements.recruitmentRoundSelector.hidden, true);
  assert.equal(onlyCard.querySelector('.units').value, 0);
});

test('a storage read failure leaves the current round selected and performs no write or switch', () => {
  const { context, roots, writes, elements } = createHarness({}, { storageGetError: new Error('read denied') });
  context.setActiveRecruitmentRoundId('round-old');
  elements.recruitmentRoundSelector.value = 'round-new';

  assert.equal(context.selectRecruitmentRound('round-new'), false);
  assert.equal(context.getCurrentRecruitmentRound().id, 'round-old');
  assert.deepEqual(roots.map(root => root.hidden), [false, true]);
  assert.equal(elements.recruitmentRoundSelector.value, 'round-old');
  assert.equal(writes.length, 0);
});

test('non-selected card-list roots have an author CSS rule that honors the hidden attribute', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /\.cardList\[hidden\]\{display:none!important\}/);
});
