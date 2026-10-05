(() => {
    'use strict';

    const markets = ['options', 'futures'];
    const tabs = markets.map(market => document.getElementById(`${market}-tab`));
    const notice = document.getElementById('journal-notice');
    const bucket = 'trading-journal';
    const starterDate = '2026-10-05';
    const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
    const editors = new Map();
    let client;
    let owner = false;
    let userId = null;
    let entries = [];
    let authVersion = 0;

    function activateTab(index, focus = false) {
        tabs.forEach((tab, tabIndex) => {
            const selected = index === tabIndex;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
        });
        if (focus) tabs[index].focus();
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activateTab(index));
        tab.addEventListener('keydown', event => {
            const destinations = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
            if (event.key in destinations) {
                event.preventDefault();
                activateTab(destinations[event.key], true);
            }
        });
    });

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function displayDate(value) {
        const [year, month, day] = value.split('-');
        return `${Number(month)}/${Number(day)}/${year.slice(-2)}`;
    }

    function today() {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function imageUrl(path) {
        return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }

    function renderEntries() {
        for (const market of markets) {
            const container = document.querySelector(`[data-entries="${market}"]`);
            container.replaceChildren();
            const marketEntries = entries.filter(entry => entry.market === market).sort((a, b) =>
                b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
            const dates = [...new Set([starterDate, ...marketEntries.map(entry => entry.entry_date)])].sort().reverse();
            for (const date of dates) {
                const day = element('section', 'journal-day');
                const heading = element('h3');
                const time = element('time', null, displayDate(date));
                time.dateTime = date;
                heading.append(time);
                day.append(heading);
                const dayEntries = marketEntries.filter(entry => entry.entry_date === date);
                if (!dayEntries.length) day.append(element('p', 'journal-empty', `No ${market} entries yet.`));
                for (const entry of dayEntries) {
                    const article = element('article', 'journal-entry');
                    article.setAttribute('aria-label', `${market === 'options' ? 'Options' : 'Futures'} entry for ${displayDate(date)}`);
                    if (owner) {
                        const actions = element('div', 'journal-entry-heading');
                        const edit = element('button', 'journal-button journal-button-secondary', 'Edit entry');
                        edit.type = 'button';
                        edit.addEventListener('click', () => openEditor(market, entry));
                        actions.append(edit);
                        article.append(actions);
                    }
                    if (entry.description) article.append(element('p', 'journal-entry-description', entry.description));
                    if (entry.image_paths.length) {
                        const images = element('div', 'journal-entry-images');
                        entry.image_paths.forEach((path, index) => {
                            const link = element('a');
                            link.href = imageUrl(path);
                            link.target = '_blank';
                            link.rel = 'noopener';
                            const image = element('img');
                            image.src = link.href;
                            image.alt = `${market === 'options' ? 'Options' : 'Futures'} trade screenshot ${index + 1} — ${displayDate(date)}`;
                            image.loading = 'lazy';
                            link.append(image);
                            images.append(link);
                        });
                        article.append(images);
                    }
                    day.append(article);
                }
                container.append(day);
            }
        }
    }

    function clearEditor(state) {
        state.images.forEach(image => { if (image.file) URL.revokeObjectURL(image.url); });
        state.images = [];
        state.form.reset();
        state.form.hidden = true;
        state.form.querySelector('.journal-image-previews').replaceChildren();
        state.form.querySelector('.journal-editor-status').textContent = '';
        state.dirty = false;
        state.entry = null;
    }

    function renderPreviews(state) {
        const container = state.form.querySelector('.journal-image-previews');
        container.replaceChildren();
        state.images.forEach((item, index) => {
            const preview = element('figure', 'journal-image-preview');
            const image = element('img');
            image.src = item.url;
            image.alt = item.file?.name || `Saved image ${index + 1}`;
            const remove = element('button', 'journal-button journal-button-secondary', 'Remove');
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remove image ${index + 1}`);
            remove.addEventListener('click', () => {
                if (item.file) URL.revokeObjectURL(item.url);
                state.images.splice(index, 1);
                state.dirty = true;
                renderPreviews(state);
            });
            preview.append(image, remove);
            container.append(preview);
        });
    }

    function openEditor(market, entry = null) {
        if (!owner) return;
        const state = editors.get(market);
        if (state.saving) return;
        if (!state.form.hidden && state.entry?.id === entry?.id) {
            state.form.querySelector('textarea').focus();
            return;
        }
        if (state.dirty && !window.confirm('Discard the unsaved changes in this entry?')) return;
        clearEditor(state);
        state.entry = entry;
        state.id = entry?.id || crypto.randomUUID();
        state.form.elements.date.value = entry?.entry_date || today();
        state.form.elements.description.value = entry?.description || '';
        state.form.querySelector('.journal-editor-title').textContent = entry ? 'Edit entry' : 'New entry';
        state.images = (entry?.image_paths || []).map(path => ({ path, url: imageUrl(path) }));
        renderPreviews(state);
        state.form.hidden = false;
        state.form.elements.description.focus();
    }

    async function saveEntry(event, market, state) {
        event.preventDefault();
        if (!owner || state.saving) return;
        const status = state.form.querySelector('.journal-editor-status');
        const description = state.form.elements.description.value.trim();
        if (!description && !state.images.length) {
            status.textContent = 'Add a description or at least one image.';
            return;
        }
        state.saving = true;
        state.form.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = true; });
        status.textContent = 'Saving entry…';
        const uploaded = [];
        let writeStarted = false;
        try {
            const { data: allowed, error: permissionError } = await client.rpc('is_trading_journal_owner');
            if (permissionError || !allowed) throw new Error('Please sign in with the journal owner account before saving.');
            const paths = [];
            for (const item of state.images) {
                if (item.path) { paths.push(item.path); continue; }
                const path = `${userId}/${state.id}/${crypto.randomUUID()}.${extensions[item.file.type]}`;
                const { error } = await client.storage.from(bucket).upload(path, item.file, { contentType: item.file.type, upsert: false });
                if (error) throw error;
                uploaded.push(path);
                paths.push(path);
            }
            const content = { entry_date: state.form.elements.date.value, description, image_paths: paths };
            writeStarted = true;
            const query = state.entry
                ? client.from('trading_journal_entries').update(content).eq('id', state.id).eq('updated_at', state.entry.updated_at)
                : client.from('trading_journal_entries').insert({ id: state.id, market, ...content });
            const { data, error } = await query.select().single();
            if (error) {
                if (error.code === 'PGRST116') throw new Error('This entry changed in another window. Copy your notes, then reload before editing again.');
                if (error.code === '23505') throw new Error('This entry may already have saved. Reload the page to check before adding it again.');
                throw error;
            }
            entries = entries.filter(entry => entry.id !== data.id);
            entries.push(data);
            clearEditor(state);
            renderEntries();
            notice.textContent = 'Entry saved. Everyone can now view it.';
            document.querySelector(`[data-add-entry="${market}"]`).focus();
        } catch (error) {
            // Once a database write starts, a network error may hide a successful
            // commit. Keep the uploaded files so that published images stay intact.
            if (!writeStarted && uploaded.length) await client.storage.from(bucket).remove(uploaded).catch(() => {});
            status.textContent = error.message || 'The entry could not be saved. Your changes are still in the editor.';
        } finally {
            state.saving = false;
            state.form.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = false; });
        }
    }

    for (const market of markets) {
        const form = document.getElementById('journal-editor-template').content.firstElementChild.cloneNode(true);
        document.querySelector(`[data-editor="${market}"]`).append(form);
        const state = { form, images: [], dirty: false, saving: false, entry: null };
        editors.set(market, state);
        form.elements.date.min = '1900-01-01';
        form.elements.date.max = '9999-12-31';
        form.addEventListener('input', () => { state.dirty = true; });
        form.addEventListener('submit', event => saveEntry(event, market, state));
        form.querySelector('[data-cancel]').addEventListener('click', () => {
            if (state.dirty && !window.confirm('Discard the unsaved changes in this entry?')) return;
            clearEditor(state);
            document.querySelector(`[data-add-entry="${market}"]`).focus();
        });
        form.elements.images.addEventListener('change', async () => {
            const files = Array.from(form.elements.images.files);
            const status = form.querySelector('.journal-editor-status');
            form.elements.images.value = '';
            if (state.images.length + files.length > 10) {
                status.textContent = 'Each entry can have up to 10 images.';
                return;
            }
            if (files.some(file => !extensions[file.type] || file.size > 10 * 1024 * 1024 || !file.size)) {
                status.textContent = 'Choose PNG, JPG, WebP, or GIF images no larger than 10 MB each.';
                return;
            }
            files.forEach(file => state.images.push({ file, url: URL.createObjectURL(file) }));
            status.textContent = '';
            state.dirty = true;
            renderPreviews(state);
        });
        document.querySelector(`[data-add-entry="${market}"]`).addEventListener('click', () => openEditor(market));
    }

    window.addEventListener('beforeunload', event => {
        if ([...editors.values()].some(state => state.dirty || state.saving)) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    async function updateOwner(session) {
        const version = ++authVersion;
        let allowed = false;
        if (session) {
            const { data, error } = await client.rpc('is_trading_journal_owner');
            allowed = !error && data === true;
        }
        if (version !== authVersion) return;
        owner = allowed;
        userId = allowed ? session.user.id : null;
        document.querySelectorAll('[data-add-entry]').forEach(button => { button.hidden = !owner; });
        document.getElementById('journal-login').hidden = owner;
        document.getElementById('journal-owner-status').hidden = !owner;
        if (!owner) editors.forEach(state => { state.form.hidden = true; });
        renderEntries();
    }

    async function initialize() {
        try {
            ({ supabase: client } = await import('./docs/auth.js'));
            const loaded = [];
            for (let offset = 0; ; offset += 500) {
                const { data, error } = await client.from('trading_journal_entries')
                    .select('id, market, entry_date, description, image_paths, created_at, updated_at')
                    .order('entry_date', { ascending: false }).order('created_at', { ascending: false })
                    .order('id', { ascending: false }).range(offset, offset + 499);
                if (error) throw error;
                loaded.push(...data);
                if (data.length < 500) break;
            }
            entries = loaded;
            renderEntries();
            notice.textContent = '';
            client.auth.onAuthStateChange((_event, session) => {
                // Run outside the auth callback's lock before issuing another request.
                setTimeout(() => { updateOwner(session).catch(() => {}); }, 0);
            });
            const { data: { session } } = await client.auth.getSession();
            await updateOwner(session);
        } catch {
            notice.textContent = 'The journal could not be loaded. Please refresh to try again.';
        }
    }

    initialize();
})();
