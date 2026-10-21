const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
  const scope = { window: {}, document: { createElement: () => ({}) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source-catalog.js'), 'utf8'), scope);
  return scope.window.tbbSources;
}

test('unknown and inherited provider names safely fall back to the default', () => {
  const sources = load();
  for (const value of [null, undefined, '', 'vidking', '__proto__', 'constructor']) {
    assert.equal(sources.selected(value), 'cinesrc');
  }
  assert.equal(sources.selected('videasy'), 'videasy');
});

test('every provider has HTTPS movie and TV routes with all identifiers expanded', () => {
  const sources = load();
  for (const provider of Object.values(sources.providers)) {
    for (const mode of ['movie', 'tv']) {
      const value = provider[mode].replace('{id}', '1396').replace('{s}', '2').replace('{e}', '3');
      const url = new URL(value);
      assert.equal(url.protocol, 'https:');
      assert.ok(!/[{}]/.test(value));
      assert.ok(value.includes('1396'));
      if (mode === 'tv') {
        assert.ok(url.pathname.endsWith('/2/3') || (url.searchParams.get('s') === '2' && url.searchParams.get('e') === '3'));
      }
    }
  }
});

test('both selectors receive identical accessible choices and the selected value', () => {
  const sources = load();
  const select = { children: [], setAttribute(k, v) { this[k] = v; }, appendChild(v) { this.children.push(v); } };
  sources.fill(select, 'vidcore');
  assert.equal(select.value, 'vidcore');
  assert.equal(select['aria-label'], 'Playback source');
  assert.deepEqual(select.children.map(x => x.value), ['cinesrc', 'vidcore', 'vidnest', 'videasy']);
});
