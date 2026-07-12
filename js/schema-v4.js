(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TurfightSchemaV4 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var SCHEMA_VERSION = 4;
  var DEFAULT_PLAN_ID = 'default';
  var DEFAULT_ROUND_ID = 'default-round';

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function catalogRounds(context) {
    return context && Array.isArray(context.rounds) ? context.rounds : [];
  }

  function firstCatalogRoundId(context) {
    var rounds = catalogRounds(context);
    return rounds.length && rounds[0].id ? String(rounds[0].id) : '';
  }

  function defaultSettings() {
    return { eventBudget: '', voucherAmount: '', bulkRate: '0.9' };
  }

  function normalizeSettings(source) {
    source = isObject(source) ? source : {};
    return {
      eventBudget: source.eventBudget != null ? source.eventBudget : '',
      voucherAmount: source.voucherAmount != null ? source.voucherAmount : '',
      bulkRate: source.bulkRate != null ? source.bulkRate : '0.9'
    };
  }

  function normalizeSelections(source) {
    if (!isObject(source)) return {};
    var result = {};
    Object.keys(source).forEach(function(horseId) {
      var selection = source[horseId];
      if (!isObject(selection)) return;
      result[horseId] = {
        units: selection.units != null ? selection.units : 0,
        memo: selection.memo != null ? selection.memo : ''
      };
    });
    return result;
  }

  function hasRound(plan, roundId) {
    return isObject(plan) && isObject(plan.recruitmentRounds) && isObject(plan.recruitmentRounds[roundId]);
  }

  function planForV4(plan, roundId, fallbackIndex) {
    var roundData = hasRound(plan, roundId) ? plan.recruitmentRounds[roundId] : {};
    return {
      id: String(plan.id || (fallbackIndex === 0 ? DEFAULT_PLAN_ID : 'plan-' + (fallbackIndex + 1))),
      name: plan.name || ('プラン' + (fallbackIndex + 1)),
      viewFilter: plan.viewFilter != null ? plan.viewFilter : 'all',
      horseSelections: normalizeSelections(roundData.horses || roundData.horseSelections || plan.horses)
    };
  }

  function settingsSignature(settings) {
    return JSON.stringify(normalizeSettings(settings));
  }

  function settingsFromPlan(plan) {
    return normalizeSettings(plan || {});
  }

  function resolveV3Settings(data, plans, roundId, diagnostics) {
    var rootSettings = isObject(data.recruitmentRoundSettings) && data.recruitmentRoundSettings[roundId];
    var activePlan = plans.filter(function(plan) { return plan.id === data.activePlanId; })[0];
    var roundPlans = plans.filter(function(plan) { return hasRound(plan, roundId); });
    var candidates = [];
    var selected;
    var selectedFrom;

    if (isObject(rootSettings)) {
      selected = normalizeSettings(rootSettings);
      selectedFrom = 'recruitmentRoundSettings';
      candidates.push({ from: selectedFrom, settings: selected });
    }
    roundPlans.forEach(function(plan) {
      candidates.push({ from: 'plan:' + plan.id, settings: settingsFromPlan(plan) });
    });
    if (!selected && activePlan && hasRound(activePlan, roundId)) {
      selected = settingsFromPlan(activePlan);
      selectedFrom = 'active-plan-with-round';
    }
    if (!selected && roundPlans.length) {
      selected = settingsFromPlan(roundPlans[0]);
      selectedFrom = 'first-plan-with-round';
    }
    if (!selected && activePlan) {
      selected = settingsFromPlan(activePlan);
      selectedFrom = 'active-plan';
      candidates.push({ from: 'active-plan', settings: selected });
    }
    if (!selected) {
      selected = defaultSettings();
      selectedFrom = 'defaults';
    }

    var selectedSignature = settingsSignature(selected);
    var conflicts = candidates.filter(function(candidate) {
      return settingsSignature(candidate.settings) !== selectedSignature;
    });
    if (conflicts.length) {
      diagnostics.push({
        code: 'recruitment-round-settings-conflict',
        roundId: roundId,
        selectedFrom: selectedFrom,
        conflictCount: conflicts.length,
        conflictingSources: conflicts.map(function(candidate) { return candidate.from; })
      });
    }
    return selected;
  }

  function migrateV3(data, context, diagnostics) {
    if (!Array.isArray(data.plans)) throw new Error('schemaVersion 3 の plans はArrayである必要があります');
    var plans = data.plans;
    var roundIds = [];
    function addRoundId(id) {
      if (id != null && String(id) && roundIds.indexOf(String(id)) < 0) roundIds.push(String(id));
    }
    plans.forEach(function(plan) {
      if (!isObject(plan)) throw new Error('schemaVersion 3 のPlanが不正です');
      if (!plan.id) throw new Error('schemaVersion 3 のPlan IDがありません');
      if (plan.recruitmentRounds != null && !isObject(plan.recruitmentRounds)) {
        throw new Error('schemaVersion 3 のrecruitmentRoundsがMapではありません: ' + plan.id);
      }
      if (isObject(plan.recruitmentRounds)) {
        Object.keys(plan.recruitmentRounds).forEach(function(roundId) {
          var round = plan.recruitmentRounds[roundId];
          if (!isObject(round)) throw new Error('schemaVersion 3 の募集回がObjectではありません: ' + roundId);
          if (round.horses != null && !isObject(round.horses)) {
            throw new Error('schemaVersion 3 のhorsesがMapではありません: ' + roundId);
          }
          addRoundId(roundId);
        });
      }
      addRoundId(plan.activeRecruitmentRoundId);
    });
    addRoundId(data.activeRecruitmentRoundId);
    catalogRounds(context).forEach(function(round) { addRoundId(round.id); });
    if (!roundIds.length) addRoundId(DEFAULT_ROUND_ID);

    var rounds = {};
    roundIds.forEach(function(roundId) {
      var roundPlans = plans.filter(function(plan) { return hasRound(plan, roundId); });
      if (!roundPlans.length && roundIds.length === 1) roundPlans = plans.slice();
      var migratedPlans = roundPlans.map(function(plan, index) { return planForV4(plan, roundId, index); });
      if (!migratedPlans.length) {
        migratedPlans.push({ id: DEFAULT_PLAN_ID, name: 'プラン1', viewFilter: 'all', horseSelections: {} });
      }
      var activePlanId = migratedPlans.some(function(plan) { return plan.id === data.activePlanId; })
        ? data.activePlanId : migratedPlans[0].id;
      rounds[roundId] = {
        id: roundId,
        settings: resolveV3Settings(data, plans, roundId, diagnostics),
        activePlanId: activePlanId,
        plans: migratedPlans
      };
    });

    var activePlan = plans.filter(function(plan) { return plan.id === data.activePlanId; })[0];
    var activeRoundId = activePlan && activePlan.activeRecruitmentRoundId;
    if (!activeRoundId || !rounds[activeRoundId]) activeRoundId = data.activeRecruitmentRoundId;
    if (!activeRoundId || !rounds[activeRoundId]) activeRoundId = firstCatalogRoundId(context);
    if (!activeRoundId || !rounds[activeRoundId]) activeRoundId = roundIds[0];
    return { schemaVersion: SCHEMA_VERSION, activeRecruitmentRoundId: activeRoundId, recruitmentRounds: rounds };
  }

  function migrateLegacy(data, context) {
    var roundId = data.activeRecruitmentRoundId || firstCatalogRoundId(context) || DEFAULT_ROUND_ID;
    var selections = normalizeSelections(data.horses);
    if (isObject(data.recruitmentRounds) && isObject(data.recruitmentRounds[roundId])) {
      selections = normalizeSelections(data.recruitmentRounds[roundId].horses || data.recruitmentRounds[roundId].horseSelections);
    }
    var planId = data.activePlanId || DEFAULT_PLAN_ID;
    var plan = {
      id: planId,
      name: data.name || 'プラン1',
      viewFilter: data.viewFilter != null ? data.viewFilter : 'all',
      horseSelections: selections
    };
    var rounds = {};
    rounds[roundId] = {
      id: roundId,
      settings: normalizeSettings(data),
      activePlanId: planId,
      plans: [plan]
    };
    return { schemaVersion: SCHEMA_VERSION, activeRecruitmentRoundId: roundId, recruitmentRounds: rounds };
  }

  function validateV4(data) {
    var errors = [];
    if (!isObject(data)) return { valid: false, errors: ['RootがObjectではありません'] };
    if (data.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersionが4ではありません');
    if (!data.activeRecruitmentRoundId) errors.push('activeRecruitmentRoundIdがありません');
    if (!isObject(data.recruitmentRounds)) {
      errors.push('recruitmentRoundsがMapではありません');
      return { valid: false, errors: errors };
    }
    Object.keys(data.recruitmentRounds).forEach(function(roundKey) {
      var round = data.recruitmentRounds[roundKey];
      if (!isObject(round)) { errors.push('募集回 ' + roundKey + ' がObjectではありません'); return; }
      if (!round.id || String(round.id) !== roundKey) errors.push('募集回IDが欠落またはMapキーと不一致です: ' + roundKey);
      if (!isObject(round.settings)) errors.push('募集回設定がObjectではありません: ' + roundKey);
      if (!Array.isArray(round.plans) || !round.plans.length) { errors.push('plansが空またはArrayではありません: ' + roundKey); return; }
      var planIds = {};
      round.plans.forEach(function(plan) {
        if (!isObject(plan) || !plan.id) { errors.push('Plan IDがありません: ' + roundKey); return; }
        if (planIds[plan.id]) errors.push('Plan IDが重複しています: ' + roundKey + '/' + plan.id);
        planIds[plan.id] = true;
        if (!isObject(plan.horseSelections)) errors.push('horseSelectionsがMapではありません: ' + roundKey + '/' + plan.id);
      });
      if (!round.activePlanId || !planIds[round.activePlanId]) errors.push('activePlanIdが募集回内のPlanを参照していません: ' + roundKey);
    });
    if (data.activeRecruitmentRoundId && !data.recruitmentRounds[data.activeRecruitmentRoundId]) {
      errors.push('activeRecruitmentRoundIdが存在する募集回を参照していません');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function migrateToV4(rawData, context) {
    var diagnostics = [];
    if (!isObject(rawData)) return { ok: false, error: '保存データのRootがObjectではありません', diagnostics: diagnostics };
    var version = rawData.schemaVersion;
    if (typeof version === 'number' && version > SCHEMA_VERSION) {
      return { ok: false, error: '未対応の将来schemaVersionです: ' + version, diagnostics: diagnostics };
    }
    var data;
    try {
      if (version === SCHEMA_VERSION) data = clone(rawData);
      else if (version === 3) data = migrateV3(rawData, context, diagnostics);
      else data = migrateLegacy(rawData, context);
    } catch (error) {
      return { ok: false, error: error.message || String(error), diagnostics: diagnostics };
    }
    var validation = validateV4(data);
    if (!validation.valid) return { ok: false, error: validation.errors.join('\n'), diagnostics: diagnostics };
    return { ok: true, data: data, diagnostics: diagnostics, sourceVersion: version == null ? null : version, migrated: version !== SCHEMA_VERSION };
  }

  function parseAndMigrateToV4(rawText, context) {
    if (rawText == null || rawText === '') return migrateToV4({}, context);
    var parsed;
    try { parsed = JSON.parse(rawText); }
    catch (error) { return { ok: false, error: '保存JSONを解析できません: ' + error.message, diagnostics: [] }; }
    return migrateToV4(parsed, context);
  }

  function writeV4(storage, storageKey, backupKey, data) {
    var validation = validateV4(data);
    if (!validation.valid) return { ok: false, error: validation.errors.join('\n') };
    try {
      var original = storage.getItem(storageKey);
      if (original != null) {
        var parsed = JSON.parse(original);
        if (parsed.schemaVersion !== SCHEMA_VERSION && storage.getItem(backupKey) == null) {
          storage.setItem(backupKey, original);
          if (storage.getItem(backupKey) !== original) throw new Error('バックアップの検証に失敗しました');
        }
      }
      storage.setItem(storageKey, JSON.stringify(data));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    migrateToV4: migrateToV4,
    parseAndMigrateToV4: parseAndMigrateToV4,
    validateV4: validateV4,
    writeV4: writeV4
  };
});
