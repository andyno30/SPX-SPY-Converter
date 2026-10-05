// Journal content is committed to GitHub. Supabase is used only for login checks.
const repository = 'andyno30/SPX-SPY-Converter';
const branch = 'main';
const manifestPath = 'trading-journal/public/journal/entries.json';
const ownerEmail = 'andyno30@gmail.com';
const maxImageBytes = 3 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class JournalError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
export async function journalRequest(request, env = process.env, fetcher = fetch) {
    const origin = request.headers.get('origin');
    const headers = { 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    if (origin === 'https://spyconverter.com' || origin === 'https://spyconverter-journal.vercel.app') {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    else if (origin) {
        return Response.json({ error: 'This origin is not allowed.' }, { status: 403, headers });
    }
    if (request.method === 'OPTIONS')
        return new Response(null, { status: 204, headers });
    if (request.method !== 'POST')
        return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });
    try {
        const authorization = request.headers.get('authorization') || '';
        if (!/^Bearer \S+$/.test(authorization))
            throw new JournalError('Please sign in first.', 401);
        const authUrl = env.NEXT_PUBLIC_SUPABASE_URL;
        const authKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!authUrl || !authKey)
            throw new JournalError('Login verification is unavailable.', 503);
        const auth = await fetcher(`${authUrl}/auth/v1/user`, {
            headers: { Authorization: authorization, apikey: authKey }, cache: 'no-store',
        });
        if (!auth.ok)
            throw new JournalError('Your login expired. Please sign in again.', 401);
        const user = await auth.json();
        if (user.email?.toLowerCase() !== ownerEmail || !user.email_confirmed_at) {
            throw new JournalError('Only the journal owner can publish entries.', 403);
        }
        const token = env.JOURNAL_GITHUB_TOKEN;
        if (!token)
            throw new JournalError('GitHub publishing has not been connected yet.', 503);
        const bodyText = await request.text();
        if (bodyText.length > 4400000)
            throw new JournalError('Choose an image smaller than 3 MB.', 413);
        let body;
        try {
            body = JSON.parse(bodyText);
        }
        catch {
            throw new JournalError('Invalid request.');
        }
        if (!body || typeof body !== 'object')
            throw new JournalError('Invalid request.');
        async function github(endpoint, method = 'GET', data) {
            const response = await fetcher(`https://api.github.com/repos/${repository}/${endpoint}`, {
                method, headers: {
                    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28',
                }, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store',
            });
            if (!response.ok) {
                throw new JournalError(response.status === 403 || response.status === 401
                    ? 'GitHub publishing permission is unavailable.' : 'GitHub could not publish this entry. Please retry.', response.status === 409 || response.status === 422 ? 409 : 502);
            }
            return response.json();
        }
        if (body.action === 'image') {
            if (typeof body.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) {
                throw new JournalError('Invalid image.');
            }
            const bytes = Buffer.from(body.content, 'base64');
            if (!bytes.length || bytes.length > maxImageBytes)
                throw new JournalError('Images must be 3 MB or smaller.');
            let extension;
            if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
                extension = 'png';
            if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
                extension = 'jpg';
            if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString()))
                extension = 'gif';
            if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
                extension = 'webp';
            if (!extension)
                throw new JournalError('Choose a PNG, JPG, WebP, or GIF image.');
            const blob = await github('git/blobs', 'POST', { content: body.content, encoding: 'base64' });
            return Response.json({ sha: blob.sha, extension }, { headers });
        }
        if (body.action !== 'entry' || !uuid.test(body.id) || !['options', 'futures'].includes(body.market)) {
            throw new JournalError('Invalid journal entry.');
        }
        if (typeof body.entry_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.entry_date)
            || !Number.isFinite(Date.parse(body.entry_date))
            || new Date(body.entry_date).toISOString().slice(0, 10) !== body.entry_date)
            throw new JournalError('Choose a valid date.');
        if (typeof body.description !== 'string' || body.description.length > 20000)
            throw new JournalError('Description is too long.');
        if (!Array.isArray(body.image_paths) || !Array.isArray(body.uploaded_images)
            || body.image_paths.length + body.uploaded_images.length > 10)
            throw new JournalError('Use up to 10 images per entry.');
        let uploads = body.uploaded_images;
        if (uploads.some(image => !image || !/^[a-f0-9]{40}$/.test(image.sha) || !['png', 'jpg', 'gif', 'webp'].includes(image.extension))) {
            throw new JournalError('Invalid uploaded image.');
        }
        uploads = [...new Map(uploads.map(image => [`${image.sha}.${image.extension}`, image])).values()];
        if (!body.description.trim() && !body.image_paths.length && !uploads.length)
            throw new JournalError('Add a description or image.');
        for (let attempt = 0; attempt < 3; attempt++) {
            const ref = await github(`git/ref/heads/${branch}`);
            const parent = await github(`git/commits/${ref.object.sha}`);
            const file = await github(`contents/${manifestPath}?ref=${ref.object.sha}`);
            const entries = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
            const previous = entries.find(entry => entry.id === body.id);
            if ((previous?.updated_at || null) !== (body.updated_at || null)) {
                throw new JournalError('This entry changed in another window. Reload before editing it again.', 409);
            }
            if (previous && previous.market !== body.market)
                throw new JournalError('An entry cannot change journals.');
            if (body.image_paths.some((imagePath) => typeof imagePath !== 'string' || !previous?.image_paths.includes(imagePath))) {
                throw new JournalError('An existing image could not be verified.');
            }
            const uploadedPaths = uploads.map(image => `journal/images/${body.id}/${image.sha}.${image.extension}`);
            const imagePaths = [...body.image_paths, ...uploadedPaths];
            const stamp = new Date().toISOString();
            const entry = {
                id: body.id, market: body.market, entry_date: body.entry_date, description: body.description.trim(),
                image_paths: [...new Set(imagePaths)], created_at: previous?.created_at || stamp, updated_at: stamp,
            };
            const nextEntries = entries.filter(row => row.id !== entry.id).concat(entry).sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
            const manifest = await github('git/blobs', 'POST', { content: JSON.stringify(nextEntries, null, 2) + '\n', encoding: 'utf-8' });
            const tree = [
                { path: manifestPath, mode: '100644', type: 'blob', sha: manifest.sha },
                ...uploads.map((image, index) => ({ path: `trading-journal/public/${uploadedPaths[index]}`, mode: '100644', type: 'blob', sha: image.sha })),
                ...(previous?.image_paths || []).filter(imagePath => !imagePaths.includes(imagePath)).map(imagePath => ({
                    path: `trading-journal/public/${imagePath}`, mode: '100644', type: 'blob', sha: null,
                })),
            ];
            const newTree = await github('git/trees', 'POST', { base_tree: parent.tree.sha, tree });
            const commit = await github('git/commits', 'POST', {
                message: `${previous ? 'Edit' : 'Add'} ${entry.market} journal entry for ${entry.entry_date}`,
                tree: newTree.sha, parents: [ref.object.sha],
            });
            try {
                await github(`git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
                return Response.json({ entry, commit: commit.sha }, { headers });
            }
            catch (error) {
                if (!(error instanceof JournalError) || error.status !== 409 || attempt === 2)
                    throw error;
            }
        }
        throw new JournalError('GitHub is busy. Please retry.', 409);
    }
    catch (error) {
        return Response.json({ error: error instanceof JournalError ? error.message : 'The entry could not be published. Please retry.' }, { status: error instanceof JournalError ? error.status : 500, headers });
    }
}
