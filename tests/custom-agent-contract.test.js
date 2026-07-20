const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AGENTS_DIR = path.join(__dirname, '..', '.github', 'agents');

function readAgentFile(filename) {
  return fs.readFileSync(path.join(AGENTS_DIR, filename), 'utf8');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    if (raw === 'true') result[key] = true;
    else if (raw === 'false') result[key] = false;
    else if (raw.startsWith('[') && raw.endsWith(']')) {
      result[key] = raw.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      result[key] = raw;
    }
  }
  return result;
}

const REQUIRED_FIELDS = ['name', 'description', 'target', 'tools', 'disable-model-invocation', 'user-invocable'];
const COMMON_TOOLS = ['read', 'search', 'execute'];

[
  { label: 'ナイチンゲール・QA', file: 'nightingale-qa.agent.md' },
  { label: '田中久重・実装', file: 'tanaka-hisashige-implementer.agent.md' }
].forEach(({ label, file }) => {
  test(`${label}: エージェントファイルが存在する`, () => {
    assert.ok(fs.existsSync(path.join(AGENTS_DIR, file)));
  });

  test(`${label}: frontmatterが解析可能`, () => {
    const fm = parseFrontmatter(readAgentFile(file));
    assert.ok(fm !== null, 'frontmatterが見つかりません');
  });

  test(`${label}: 必須フィールドをすべて持つ`, () => {
    const fm = parseFrontmatter(readAgentFile(file));
    for (const field of REQUIRED_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(fm, field), `必須フィールドが存在しません: ${field}`);
    }
  });

  test(`${label}: target が github-copilot`, () => {
    const fm = parseFrontmatter(readAgentFile(file));
    assert.equal(fm.target, 'github-copilot');
  });

  test(`${label}: disable-model-invocation が true`, () => {
    const fm = parseFrontmatter(readAgentFile(file));
    assert.equal(fm['disable-model-invocation'], true);
  });

  test(`${label}: user-invocable が true`, () => {
    const fm = parseFrontmatter(readAgentFile(file));
    assert.equal(fm['user-invocable'], true);
  });

  test(`${label}: tools が配列である`, () => {
    const fm = parseFrontmatter(readAgentFile(file));
    assert.ok(Array.isArray(fm.tools), 'toolsが配列ではありません');
  });

  test(`${label}: tools に ${COMMON_TOOLS.join('・')} を含む`, () => {
    const fm = parseFrontmatter(readAgentFile(file));
    for (const tool of COMMON_TOOLS) {
      assert.ok(fm.tools.includes(tool), `tools に ${tool} が含まれていません`);
    }
  });
});

test('ナイチンゲール・QA: tools に edit を含まない（読み取り専用）', () => {
  const fm = parseFrontmatter(readAgentFile('nightingale-qa.agent.md'));
  assert.ok(!fm.tools.includes('edit'), 'QAエージェントは edit ツールを持ってはなりません');
});

test('田中久重・実装: tools に edit を含む', () => {
  const fm = parseFrontmatter(readAgentFile('tanaka-hisashige-implementer.agent.md'));
  assert.ok(fm.tools.includes('edit'), '実装エージェントは edit ツールを持たなければなりません');
});
