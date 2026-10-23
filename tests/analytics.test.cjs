const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const script = readFileSync(require('node:path').join(__dirname, '../dist/analytics.js'), 'utf8');

function run(overrides = {}) {
  const calls = [];
  const warnings = [];
  const document = {
    referrer: 'https://search.example/results?q=private',
    visibilityState: 'visible',
    querySelector: () => ({ content: 'https://admin.imachraf.tech/api/collect' }),
    ...overrides.document
  };
  vm.runInNewContext(script, {
    URL,
    document,
    navigator: { ...overrides.navigator },
    location: { pathname: '/' },
    fetch: async (...args) => {
      calls.push(args);
      return { ok: overrides.ok !== false, status: 503 };
    },
    console: { warn: (...args) => warnings.push(args) }
  });
  return { calls, warnings, document };
}

test('tracking is disabled until a backend is configured', () => {
  const { calls } = run({ document: { querySelector: () => ({ content: '' }) } });
  assert.equal(calls.length, 0);
});

test('privacy signals prevent any network request', () => {
  for (const navigator of [{ doNotTrack: '1' }, { globalPrivacyControl: true }]) {
    assert.equal(run({ navigator }).calls.length, 0);
  }
});

test('collector sends only a path and referring origin, without credentials', () => {
  const { calls } = run();
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'https://admin.imachraf.tech/api/collect');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(options.body), { path: '/', referrer: 'https://search.example' });
});

test('a background page is counted once when first visible', () => {
  let handler;
  const document = {
    visibilityState: 'hidden',
    addEventListener: (name, callback, options) => {
      assert.equal(name, 'visibilitychange');
      assert.equal(options.once, true);
      handler = callback;
    }
  };
  const result = run({ document });
  const { calls } = result;
  assert.equal(calls.length, 0);
  result.document.visibilityState = 'visible';
  handler();
  assert.equal(calls.length, 1);
});

test('an invalid endpoint is reported and never contacted', () => {
  const { calls, warnings } = run({ document: { querySelector: () => ({ content: 'http://invalid.example/api/collect' }) } });
  assert.equal(calls.length, 0);
  assert.equal(warnings.length, 1);
});

test('failed analytics requests are reported without interrupting the portfolio', async () => {
  const { warnings } = run({ ok: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(warnings.length, 1);
});
