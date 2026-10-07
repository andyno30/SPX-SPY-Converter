import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalRequest } from '../trading-journal/lib/publisher.js';

const id = '12345678-1234-1234-1234-123456789abc';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-key', JOURNAL_GITHUB_TOKEN: 'test-secret' };
const entry = { action: 'entry', id, market: 'options', entry_date: '2026-10-05', description: 'Trade notes', image_paths: [], uploaded_images: [], updated_at: null };
function setup({ email = 'andyno30@gmail.com', confirmed = true, rows = [], conflict = false, onConflict } = {}) {
    const calls = [];
    let attempt = 0;
    const fetcher = async (url, options) => {
        const data = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ url, ...options, data });
        if (url.startsWith('https://auth.example')) {
            assert.equal(url, 'https://auth.example/auth/v1/user');
            return Response.json({ email, email_confirmed_at: confirmed ? '2026-01-01' : null });
        }
        assert.ok(url.startsWith('https://api.github.com/repos/andyno30/SPX-SPY-Converter/'));
        if (url.includes('/git/ref/')) return Response.json({ object: { sha: `head${attempt}` } });
        if (url.includes('/git/commits/head')) return Response.json({ tree: { sha: `tree${attempt}` } });
        if (url.includes('/contents/')) return Response.json({ content: Buffer.from(JSON.stringify(rows)).toString('base64') });
        if (url.includes('/git/refs/')) {
            assert.equal(data.force, false);
            if (conflict && attempt++ === 0) {
                onConflict?.();
                return Response.json({}, { status: 422 });
            }
        }
        return Response.json({ sha: 'a'.repeat(40) });
    };
    const send = (body = entry, headers = {}) => journalRequest(new Request('https://journal.example/api/journal', {
        method: 'POST', headers: { origin: 'https://spyconverter.com', authorization: 'Bearer login-token', ...headers }, body: JSON.stringify(body),
    }), env, fetcher);
    return { send, calls };
}

test('Only the verified owner can write; denied requests never reach GitHub', async () => {
    for (const options of [{ email: 'other@example.com' }, { confirmed: false }]) {
        const s = setup(options);
        assert.equal((await s.send()).status, 403);
        assert.equal(s.calls.length, 1);
    }
    const s = setup();
    assert.equal((await s.send(entry, { authorization: '' })).status, 401);
    assert.equal((await s.send(entry, { origin: 'https://other.example' })).status, 403);
    assert.equal(s.calls.length, 0);
});

test('Publish creates one commit limited to journal files and preserves the parent tree', async () => {
    const s = setup();
    const upload = { sha: 'b'.repeat(40), extension: 'png' };
    const response = await s.send({ ...entry, uploaded_images: [upload, upload] });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://spyconverter.com');
    const saved = (await response.json()).entry;
    assert.equal(saved.image_paths.length, 1);
    const tree = s.calls.find(call => call.url.endsWith('/git/trees')).data;
    assert.equal(tree.base_tree, 'tree0');
    assert.equal(tree.tree.length, 2);
    assert.ok(tree.tree.every(file => file.path.startsWith('trading-journal/public/journal/')));
    const commit = s.calls.find(call => call.url.endsWith('/git/commits')).data;
    assert.deepEqual(commit.parents, ['head0']);
});

test('Concurrent unrelated commits retry; stale edits cannot overwrite entries', async () => {
    const s = setup({ conflict: true });
    assert.equal((await s.send()).status, 200);
    assert.equal(s.calls.filter(call => call.method === 'PATCH').length, 2);
    const stale = setup({ rows: [{ ...entry, updated_at: 'newer' }] });
    assert.equal((await stale.send()).status, 409);
    assert.equal(stale.calls.some(call => call.method === 'POST'), false);
});

test('Images require supported signatures and size; staging does not change the branch', async () => {
    const s = setup();
    assert.equal((await s.send({ action: 'image', content: Buffer.from('<svg/>').toString('base64') })).status, 400);
    assert.equal((await s.send({ action: 'image', content: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') })).status, 400);
    const response = await s.send({ action: 'image', content: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).extension, 'png');
    assert.equal(s.calls.filter(call => call.url.includes('api.github.com')).length, 1);
    assert.equal(s.calls.some(call => call.method === 'PATCH'), false);
});

test('Validation rejects arbitrary paths, invalid dates and empty content', async () => {
    for (const patch of [{ image_paths: ['../news-app/secret'] }, { entry_date: '2026-02-30' }, { description: '' }]) {
        const s = setup();
        assert.equal((await s.send({ ...entry, ...patch })).status, 400);
        assert.equal(s.calls.some(call => call.method === 'POST'), false);
    }
});

const savedEntry = { id, market: 'options', entry_date: '2026-10-05', description: 'Saved trade',
    image_paths: [`journal/images/${id}/${'b'.repeat(40)}.png`], created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z' };
const deletion = { action: 'delete', id, market: 'options', updated_at: savedEntry.updated_at };

test('Deletion requires owner verification and a current entry version', async () => {
    for (const options of [{ email: 'other@example.com' }, { confirmed: false }]) {
        const s = setup(options);
        assert.equal((await s.send(deletion)).status, 403);
        assert.equal(s.calls.length, 1);
    }
    for (const [rows, payload, expected] of [
        [[], deletion, 404],
        [[savedEntry], { ...deletion, updated_at: 'old-version' }, 409],
        [[savedEntry], { ...deletion, updated_at: null }, 400],
        [[savedEntry], { ...deletion, market: 'futures' }, 400],
    ]) {
        const s = setup({ rows });
        assert.equal((await s.send(payload)).status, expected);
        assert.equal(s.calls.some(call => call.method === 'POST' || call.method === 'PATCH'), false);
    }
});

test('Deletion removes only the selected entry and its images, retaining other entries and Git history', async () => {
    const other = { ...savedEntry, id: 'aaaaaaaa-1234-1234-1234-123456789abc', market: 'futures', image_paths: [] };
    const s = setup({ rows: [savedEntry, other], conflict: true });
    const result = await s.send({ ...deletion, image_paths: ['../../script.js'] });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).deleted, id);
    const manifestWrites = s.calls.filter(call => call.url.endsWith('/git/blobs'));
    assert.ok(manifestWrites.every(call => JSON.stringify(JSON.parse(call.data.content)) === JSON.stringify([other])));
    const trees = s.calls.filter(call => call.url.endsWith('/git/trees'));
    assert.equal(trees.length, 2);
    assert.deepEqual(trees[1].data, { base_tree: 'tree1', tree: [
        { path: 'trading-journal/public/journal/entries.json', mode: '100644', type: 'blob', sha: 'a'.repeat(40) },
        { path: `trading-journal/public/${savedEntry.image_paths[0]}`, mode: '100644', type: 'blob', sha: null },
    ] });
    const commits = s.calls.filter(call => call.url.endsWith('/git/commits'));
    assert.equal(commits[1].data.message, 'Delete options journal entry for 2026-10-05');
    assert.deepEqual(commits[1].data.parents, ['head1']);
    assert.ok(s.calls.filter(call => call.method === 'PATCH').every(call => call.data.force === false));
});

test('An edit racing with deletion is preserved when GitHub rejects the first update', async () => {
    const rows = [structuredClone(savedEntry)];
    const s = setup({ rows, conflict: true, onConflict: () => { rows[0].updated_at = 'newer-version'; } });
    assert.equal((await s.send(deletion)).status, 409);
    assert.equal(s.calls.filter(call => call.method === 'PATCH').length, 1);
});
