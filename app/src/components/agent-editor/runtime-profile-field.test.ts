/**
 * The agent's runtime profile (a Hermes profile): offered only when the backend has some,
 * the host's names plus the default, and a saved name the host no longer has stays shown
 * and selected rather than being swapped for the default behind the user's back.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

test('options: the default first, then the host\'s names; a saved name the host lost stays, marked', async () => {
  const { runtimeProfileOptions } = await import('./runtime-profile-field');
  assert.deepEqual(runtimeProfileOptions(['alpha', 'beta'], ''), [
    { value: '', missing: false }, { value: 'alpha', missing: false }, { value: 'beta', missing: false },
  ]);
  assert.deepEqual(runtimeProfileOptions(['alpha'], 'gone').map((o) => [o.value, o.missing]), [['', false], ['alpha', false], ['gone', true]]);
});

test('an answer of another shape reads as no profiles', async () => {
  const { asOffered } = await import('./runtime-profile-field');
  assert.equal(asOffered({ ok: true }), null);
  assert.equal(asOffered(null), null);
  assert.deepEqual(asOffered({ label: 'Hermes profile', names: ['alpha', 3, ''] }), { label: 'Hermes profile', names: ['alpha'] });
});

test('the field: hidden without profiles, a select of the names otherwise, the pick reported', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
    install(key, key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]);
  }
  install('self', dom.window);
  install('IS_REACT_ACT_ENVIRONMENT', true);
  const React = await import('react');
  install('React', React);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  try {
    const { RuntimeProfileSelect } = await import('./runtime-profile-field');
    const picked: string[] = [];
    await React.act(async () => {
      root.render(React.createElement(RuntimeProfileSelect, { offered: { label: 'Hermes profile', names: ['alpha', 'beta'] }, value: 'beta', onChange: (v: string) => picked.push(v) }));
    });
    const select = document.querySelector('select[data-runtime-profile]') as HTMLSelectElement;
    assert.ok(select);
    assert.equal(select.getAttribute('aria-label'), 'Hermes profile');
    assert.deepEqual(Array.from(select.options).map((o) => o.value), ['', 'alpha', 'beta']);
    assert.equal(select.value, 'beta');
    await React.act(async () => {
      select.value = 'alpha';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.deepEqual(picked, ['alpha']);
    await React.act(async () => {
      root.render(React.createElement(RuntimeProfileSelect, { offered: null, value: '', onChange: () => {} }));
    });
    assert.equal(document.querySelector('select[data-runtime-profile]'), null);
  } finally {
    await React.act(async () => { root.unmount(); });
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
