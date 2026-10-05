const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

async function setup(owner = false, initial = []) {
    const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
    const win = new Window();
    win.document.body.innerHTML = readFileSync(path.join(__dirname, '../trading-journal.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    const state = { rows: structuredClone(initial), uploads: [], failure: null, time: 0 };
    const clientMock = {
        rpc: async () => ({ data: owner, error: null }),
        auth: { getSession: async () => ({ data: { session: owner ? { user: { id: 'owner-id' } } : null } }), onAuthStateChange() {} },
        storage: { from: () => ({
            getPublicUrl: imagePath => ({ data: { publicUrl: `https://example.com/${imagePath}` } }),
            upload: async (imagePath, file) => { state.uploads.push({ imagePath, file }); return { error: null }; },
            remove: async () => ({ error: null }),
        }) },
        from() {
            let action, payload;
            const filters = {};
            return {
                select() { return this; }, order() { return this; },
                range: async (start, end) => ({ data: state.rows.slice(start, end + 1), error: null }),
                insert(value) { action = 'insert'; payload = value; return this; },
                update(value) { action = 'update'; payload = value; return this; },
                eq(key, value) { filters[key] = value; return this; },
                async single() {
                    if (state.failure) return { data: null, error: state.failure };
                    const stamp = `2026-10-05T19:00:${String(++state.time).padStart(2, '0')}Z`;
                    let row;
                    if (action === 'insert') {
                        row = { ...payload, created_at: stamp, updated_at: stamp };
                        state.rows.push(row);
                    } else {
                        row = state.rows.find(item => Object.entries(filters).every(([key, value]) => item[key] === value));
                        if (!row) return { data: null, error: { code: 'PGRST116' } };
                        Object.assign(row, payload, { updated_at: stamp });
                    }
                    return { data: structuredClone(row), error: null };
                },
            };
        },
    };
    win.confirm = () => true;
    const source = readFileSync(path.join(__dirname, '../trading-journal.js'), 'utf8')
        .replace("import('./docs/auth.js')", 'Promise.resolve({ supabase: clientMock })');
    runInNewContext(source, { document: win.document, window: win, clientMock, crypto: { randomUUID },
        URL: { createObjectURL: () => `blob:${randomUUID()}`, revokeObjectURL() {} }, setTimeout, console });
    await flush();
    const el = selector => win.document.querySelector(selector);
    const submit = async form => { form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush(); };
    return { win, state, el, submit, close: () => win.happyDOM.close() };
}

test('Public visitors can switch tabs with mouse and keyboard but cannot see editor actions', async () => {
    const s = await setup();
    try {
        assert.equal(s.el('#options-panel').hidden, false);
        assert.equal(s.el('#futures-panel').hidden, true);
        assert.equal(s.el('#options-panel time').textContent, '10/5/26');
        assert.equal(s.el('#futures-panel time').textContent, '10/5/26');
        assert.equal(s.el('[data-add-entry="options"]').hidden, true);
        s.el('#futures-tab').click();
        assert.equal(s.el('#options-panel').hidden, true);
        assert.equal(s.el('#futures-tab').getAttribute('aria-selected'), 'true');
        s.el('#futures-tab').dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        assert.equal(s.el('#options-tab').getAttribute('aria-selected'), 'true');
        assert.equal(s.win.document.activeElement.id, 'options-tab');
    } finally { await s.close(); }
});

test('Owner saves images and descriptions; newer entries go first and markets stay separate', async () => {
    const s = await setup(true);
    try {
        assert.equal(s.el('[data-add-entry="options"]').hidden, false);
        s.el('[data-add-entry="options"]').click();
        const form = s.el('[data-editor="options"] form');
        form.elements.date.value = '2026-10-05';
        form.elements.description.value = '<script>alert("test")</script> First trade';
        const file = new s.win.File(['image'], 'chart.png', { type: 'image/png' });
        Object.defineProperty(form.elements.images, 'files', { configurable: true, value: [file] });
        form.elements.images.dispatchEvent(new s.win.Event('change'));
        assert.equal(form.querySelectorAll('.journal-image-preview').length, 1);
        await s.submit(form);
        assert.equal(form.hidden, true);
        assert.equal(s.state.uploads.length, 1);
        assert.equal(s.el('.journal-entry-description').textContent, '<script>alert("test")</script> First trade');
        assert.equal(s.el('.journal-entry script'), null);
        assert.equal(s.el('.journal-entry img').getAttribute('src').startsWith('https://example.com/owner-id/'), true);
        s.el('[data-add-entry="options"]').click();
        form.elements.date.value = '2026-10-05';
        form.elements.description.value = 'Second trade';
        await s.submit(form);
        assert.equal(s.el('.journal-entry-description').textContent, 'Second trade');
        assert.equal(s.el('#futures-panel .journal-entry'), null);
        s.el('[data-add-entry="options"]').click();
        form.elements.date.value = '2026-10-06';
        form.elements.description.value = 'Next day';
        await s.submit(form);
        assert.equal(s.el('#options-panel time').textContent, '10/6/26');
        assert.equal(s.el('.journal-entry-description').textContent, 'Next day');
    } finally { await s.close(); }
});

test('Editing retains creation order; save failures and tab switches preserve drafts', async () => {
    const old = { id: randomUUID(), market: 'options', entry_date: '2026-10-05', description: 'Original', image_paths: [], created_at: '2026-10-05T18:00:00Z', updated_at: '2026-10-05T18:00:00Z' };
    const s = await setup(true, [old]);
    try {
        s.el('.journal-entry button').click();
        const form = s.el('[data-editor="options"] form');
        form.elements.description.value = 'Edited';
        form.elements.description.dispatchEvent(new s.win.Event('input', { bubbles: true }));
        s.el('#futures-tab').click();
        s.el('#options-tab').click();
        assert.equal(form.elements.description.value, 'Edited');
        s.state.failure = { message: 'Connection unavailable' };
        await s.submit(form);
        assert.equal(form.hidden, false);
        assert.equal(form.elements.description.value, 'Edited');
        assert.equal(form.querySelector('.journal-editor-status').textContent, 'Connection unavailable');
        s.state.failure = null;
        await s.submit(form);
        assert.equal(s.state.rows[0].created_at, old.created_at);
        assert.equal(s.el('.journal-entry-description').textContent, 'Edited');
    } finally { await s.close(); }
});

test('Empty entries and unsupported image types are rejected before uploading', async () => {
    const s = await setup(true);
    try {
        s.el('[data-add-entry="futures"]').click();
        const form = s.el('[data-editor="futures"] form');
        await s.submit(form);
        assert.equal(s.state.rows.length, 0);
        assert.match(form.querySelector('.journal-editor-status').textContent, /Add a description/);
        const file = new s.win.File(['<svg></svg>'], 'unsafe.svg', { type: 'image/svg+xml' });
        Object.defineProperty(form.elements.images, 'files', { value: [file] });
        form.elements.images.dispatchEvent(new s.win.Event('change'));
        assert.match(form.querySelector('.journal-editor-status').textContent, /Choose PNG/);
        assert.equal(form.querySelectorAll('.journal-image-preview').length, 0);
        assert.equal(s.state.uploads.length, 0);
    } finally { await s.close(); }
});
