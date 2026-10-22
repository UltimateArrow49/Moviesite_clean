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

test('URL building rejects invalid content and preserves TV season zero', () => {
  const sources = load();
  assert.equal(sources.buildUrl('cinesrc', 'movie', null), null);
  assert.equal(sources.buildUrl('cinesrc', 'movie', '278&source=other'), null);
  assert.equal(sources.buildUrl('__proto__', 'movie', 278), null);
  assert.equal(sources.buildUrl('vidnest', 'tv', 1396, 0, 1), 'https://vidnest.fun/tv/1396/0/1');
  assert.equal(sources.buildUrl('vidcore', 'tv', 1396, 1, 0), null);
});

test('incompatible sources produce isolated launch links, never unrestricted iframes', async () => {
  for (const provider of ['vidnest', 'vidcore', 'videasy']) {
    const nodes = [];
    function element(tag) {
      const e = { tag, children: [], classList: { add() {}, remove() {}, toggle() {} },
        setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
        appendChild(child) { this.children.push(child); }, addEventListener() {} };
      nodes.push(e); return e;
    }
    const document = { head: element('head'), body: element('body'),
      createElement: element, getElementById: () => null, querySelector: () => null,
      addEventListener() {} };
    const url = new URL('https://site.example/player.html?mode=tv&tmdb=1396&season=2&episode=3&provider=' + provider);
    const window = { addEventListener() {} };
    const scope = { window, document, location: url, URL, URLSearchParams,
      setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
      MutationObserver: class { observe() {} },
      fetch: async () => ({ ok: true, json: async () => ({ episodes: [] }) }) };
    vm.createContext(scope);
    for (const script of ['source-catalog.js', 'player-fullscreen.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', script), 'utf8'), scope);
    }
    await Promise.resolve();
    assert.equal(nodes.filter(n => n.tag === 'iframe').length, 0);
    const launch = nodes.find(n => n.className === 'tbb-external-open');
    assert.equal(launch.href, window.tbbSources.buildUrl(provider, 'tv', '1396', '2', '3'));
    assert.equal(launch.target, '_blank');
    assert.equal(launch.rel, 'noopener noreferrer');
    assert.ok(nodes.find(n => n.className === 'tbb-external-fallback').href.includes('provider=cinesrc'));
  }
});
