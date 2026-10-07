const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

async function setup(owner = false, initial = [], clipboard = {}) {
    const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
    const win = new Window();
    win.document.body.innerHTML = readFileSync(path.join(__dirname, '../trading-journal.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    const state = { rows: structuredClone(initial), uploads: [], requests: [], failure: null, time: 0 };
    const clientMock = {
        auth: {
            getSession: async () => ({ data: { session: owner ? { access_token: 'test-login' } : null } }),
            getUser: async () => ({ data: { user: owner ? { email: 'andyno30@gmail.com', email_confirmed_at: '2026-01-01' } : null } }),
            onAuthStateChange() {},
        },
    };
    const fetchMock = async (url, options) => {
        if (url.endsWith('/journal/entries.json')) return { ok: true, json: async () => structuredClone(state.rows) };
        assert.equal(url, 'https://spyconverter-journal.vercel.app/api/journal');
        assert.equal(options.headers.Authorization, 'Bearer test-login');
        const payload = JSON.parse(options.body);
        state.requests.push(payload);
        if (state.failure) return { ok: false, json: async () => ({ error: state.failure.message }) };
        if (payload.action === 'image') {
            state.uploads.push(payload);
            return { ok: true, json: async () => ({ sha: 'a'.repeat(40), extension: 'png' }) };
        }
        const old = state.rows.find(row => row.id === payload.id);
        if (payload.action === 'delete') {
            assert.equal(payload.updated_at, old.updated_at);
            assert.equal(payload.market, old.market);
            state.rows = state.rows.filter(row => row.id !== payload.id);
            return { ok: true, json: async () => ({ deleted: payload.id }) };
        }
        const stamp = `2026-10-05T19:00:${String(++state.time).padStart(2, '0')}Z`;
        const row = { ...payload, created_at: old?.created_at || stamp, updated_at: stamp,
            image_paths: [...payload.image_paths, ...payload.uploaded_images.map(image => `journal/images/${payload.id}/${image.sha}.${image.extension}`)] };
        state.rows = state.rows.filter(item => item.id !== row.id).concat(row);
        return { ok: true, json: async () => ({ entry: structuredClone(row) }) };
    };
    win.confirm = () => true;
    const source = readFileSync(path.join(__dirname, '../trading-journal.js'), 'utf8')
        .replace("import('./docs/auth.js')", 'Promise.resolve({ supabase: clientMock })');
    runInNewContext(source, { document: win.document, window: win, clientMock, fetch: fetchMock, FileReader: win.FileReader, File: win.File, navigator: { clipboard }, crypto: { randomUUID },
        URL: { createObjectURL: () => `blob:${randomUUID()}`, revokeObjectURL() {} }, setTimeout, console });
    await flush();
    const el = selector => win.document.querySelector(selector);
    const submit = async form => { form.dispatchEvent(new win.Event('submit', { cancelable: true })); await win.happyDOM.whenAsyncComplete(); await flush(); };
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
        assert.equal(s.el('.journal-entry img').getAttribute('src').startsWith('blob:'), true);
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

test('Paste image button previews and saves clipboard images through the existing publisher', async () => {
    let reads = 0;
    const s = await setup(true, [], { read: async () => {
        reads++;
        return [{ types: ['text/html', 'image/png'], getType: async type => new s.win.Blob(['clipboard image'], { type }) }];
    } });
    try {
        assert.equal(reads, 0);
        s.el('[data-add-entry="options"]').click();
        const form = s.el('[data-editor="options"] form');
        form.querySelector('[data-paste-image]').click();
        await flush();
        assert.equal(reads, 1);
        assert.equal(form.querySelectorAll('.journal-image-preview').length, 1);
        assert.equal(form.querySelector('[data-paste-image]').disabled, false);
        await s.submit(form);
        assert.equal(s.state.uploads.length, 1);
        assert.equal(s.state.uploads[0].content, 'Y2xpcGJvYXJkIGltYWdl');
        assert.equal(s.state.rows.length, 1);
    } finally { await s.close(); }
});

test('Native paste and dropped files share previews, removal, and image limits', async () => {
    const s = await setup(true);
    try {
        s.el('[data-add-entry="futures"]').click();
        const form = s.el('[data-editor="futures"] form');
        const box = form.querySelector('[data-image-paste]');
        const file = new s.win.File(['image'], 'screenshot.png', { type: 'image/png' });
        const transfer = (type, value) => {
            const event = new s.win.Event(type, { cancelable: true });
            Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value });
            box.dispatchEvent(event);
            assert.equal(event.defaultPrevented, true);
        };
        transfer('paste', { items: [{ kind: 'file', getAsFile: () => file }] });
        transfer('drop', { files: [file] });
        assert.equal(form.querySelectorAll('.journal-image-preview').length, 2);
        form.querySelector('.journal-image-preview button').click();
        assert.equal(form.querySelectorAll('.journal-image-preview').length, 1);
        transfer('paste', { files: Array(10).fill(file) });
        assert.match(form.querySelector('.journal-editor-status').textContent, /up to 10/);
        transfer('paste', { files: [new s.win.File([new Uint8Array(3 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] });
        assert.match(form.querySelector('.journal-editor-status').textContent, /no larger than 3 MB/);
        transfer('paste', { files: [] });
        assert.match(form.querySelector('.journal-editor-status').textContent, /No image found/);
        assert.equal(box.childNodes.length, 0);
        assert.equal(form.querySelectorAll('.journal-image-preview').length, 1);
        await s.submit(form);
        assert.equal(s.state.uploads.length, 1);
    } finally { await s.close(); }
});

test('Unsupported or denied clipboard access offers native paste without losing the draft', async () => {
    for (const clipboard of [{}, { read: async () => { throw new Error('NotAllowedError'); } }]) {
        const s = await setup(true, [], clipboard);
        try {
            s.el('[data-add-entry="options"]').click();
            const form = s.el('[data-editor="options"] form');
            form.elements.description.value = 'Keep this draft';
            form.querySelector('[data-paste-image]').click();
            await flush();
            assert.match(form.querySelector('.journal-editor-status').textContent, /Ctrl\+V/);
            assert.equal(s.win.document.activeElement, form.querySelector('[data-image-paste]'));
            assert.equal(form.querySelector('[data-paste-image]').disabled, false);
            assert.equal(form.elements.description.value, 'Keep this draft');
            assert.equal(s.state.uploads.length, 0);
        } finally { await s.close(); }
    }
});

test('A pending clipboard read cannot publish early or add images to a different draft', async () => {
    let finishRead;
    const s = await setup(true, [], { read: () => new Promise(resolve => { finishRead = resolve; }) });
    try {
        s.el('[data-add-entry="options"]').click();
        const form = s.el('[data-editor="options"] form');
        form.elements.description.value = 'First draft';
        form.querySelector('[data-paste-image]').click();
        await s.submit(form);
        assert.match(form.querySelector('.journal-editor-status').textContent, /Finish pasting/);
        assert.equal(s.state.rows.length, 0);
        form.querySelector('[data-cancel]').click();
        s.el('[data-add-entry="options"]').click();
        finishRead([{ types: ['image/png'], getType: async () => new s.win.Blob(['image'], { type: 'image/png' }) }]);
        await flush();
        assert.equal(form.querySelectorAll('.journal-image-preview').length, 0);
        assert.equal(form.querySelector('[data-paste-image]').disabled, false);
    } finally { await s.close(); }
});

const savedRow = { id: randomUUID(), market: 'options', entry_date: '2026-10-05', description: 'Original entry', image_paths: [],
    created_at: '2026-10-05T18:00:00Z', updated_at: '2026-10-05T18:00:00Z' };

test('Deletion confirms first, retains drafts on failure, and clears the deleted entry on success', async () => {
    const other = { ...savedRow, id: randomUUID(), market: 'futures', description: 'Keep this entry' };
    const s = await setup(true, [savedRow, other]);
    try {
        s.el('#options-panel .journal-entry button').click();
        const form = s.el('[data-editor="options"] form');
        form.elements.description.value = 'Unsaved edits';
        form.elements.description.dispatchEvent(new s.win.Event('input', { bubbles: true }));
        s.win.confirm = message => {
            assert.match(message, /10\/5\/26/);
            assert.match(message, /Unsaved edits/);
            return false;
        };
        s.el('#options-panel .journal-button-danger').click();
        await flush();
        assert.equal(s.state.requests.length, 0);
        assert.equal(form.elements.description.value, 'Unsaved edits');
        s.win.confirm = () => true;
        s.state.failure = { message: 'This entry changed in another window. Reload before editing or deleting it.' };
        s.el('#options-panel .journal-button-danger').click();
        await flush();
        assert.match(s.el('#journal-notice').textContent, /changed in another window/);
        assert.equal(form.hidden, false);
        assert.equal(form.elements.description.value, 'Unsaved edits');
        assert.ok(s.el('#options-panel .journal-entry'));
        s.state.failure = null;
        s.el('#options-panel .journal-button-danger').click();
        assert.equal(form.querySelector('button[type="submit"]').disabled, true);
        await s.submit(form);
        assert.equal(s.state.requests.filter(request => request.action === 'entry').length, 0);
        assert.equal(form.hidden, true);
        assert.equal(s.el('#options-panel .journal-entry'), null);
        assert.deepEqual(s.state.rows, [other]);
        assert.match(s.el('#journal-notice').textContent, /Entry deleted/);
        assert.equal(s.el('[data-add-entry="options"]').disabled, false);
    } finally { await s.close(); }
});

test('Deleting an entry preserves a separate draft; visitors never get delete controls', async () => {
    const s = await setup(true, [savedRow]);
    try {
        s.el('[data-add-entry="options"]').click();
        const form = s.el('[data-editor="options"] form');
        form.elements.description.value = 'New draft to keep';
        s.el('.journal-button-danger').click();
        await flush();
        assert.equal(form.hidden, false);
        assert.equal(form.elements.description.value, 'New draft to keep');
        assert.equal(form.elements.description.disabled, false);
    } finally { await s.close(); }
    const visitor = await setup(false, [savedRow]);
    try {
        assert.ok(visitor.el('.journal-entry'));
        assert.equal(visitor.el('.journal-entry-heading'), null);
        assert.equal(visitor.el('.journal-button-danger'), null);
    } finally { await visitor.close(); }
});
