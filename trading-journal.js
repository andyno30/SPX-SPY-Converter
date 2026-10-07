(() => {
    'use strict';

    const markets = ['options', 'futures'];
    const tabs = markets.map(market => document.getElementById(`${market}-tab`));
    const notice = document.getElementById('journal-notice');
    const journalHost = 'https://spyconverter-journal.vercel.app';
    const pendingImages = new Map();
    const starterDate = '2026-10-05';
    const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
    const editors = new Map();
    let client;
    let owner = false;
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
        return pendingImages.get(path) || `${journalHost}/${path}`;
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
                        edit.disabled = editors.get(market).saving;
                        edit.addEventListener('click', () => openEditor(market, entry));
                        const remove = element('button', 'journal-button journal-button-danger', 'Delete entry');
                        remove.type = 'button';
                        remove.disabled = editors.get(market).saving;
                        remove.addEventListener('click', () => deleteEntry(entry));
                        actions.append(edit, remove);
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
        state.revision++;
        state.images.forEach(image => { if (image.file) URL.revokeObjectURL(image.url); });
        state.images = [];
        state.form.reset();
        state.form.hidden = true;
        state.form.querySelector('.journal-image-previews').replaceChildren();
        state.form.querySelector('.journal-editor-status').textContent = '';
        state.form.querySelector('[data-image-paste]').replaceChildren();
        state.form.querySelector('[data-image-paste]').classList.remove('is-dragging');
        state.dirty = false;
        state.entry = null;
    }

    function addImages(state, files) {
        if (!owner || state.saving || state.form.hidden || !files.length) return;
        const status = state.form.querySelector('.journal-editor-status');
        if (state.images.length + files.length > 10) {
            status.textContent = 'Each entry can have up to 10 images.';
            return;
        }
        if (files.some(file => !extensions[file.type] || file.size > 3 * 1024 * 1024 || !file.size)) {
            status.textContent = 'Choose PNG, JPG, WebP, or GIF images no larger than 3 MB each.';
            return;
        }
        files.forEach(file => state.images.push({ file, url: URL.createObjectURL(file) }));
        status.textContent = '';
        state.dirty = true;
        renderPreviews(state);
    }

    function transferredFiles(transfer) {
        const files = Array.from(transfer?.files || []);
        return files.length ? files : Array.from(transfer?.items || [])
            .filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
    }

    async function pasteImage(state) {
        if (!owner || state.saving || state.pasting || state.form.hidden) return;
        const status = state.form.querySelector('.journal-editor-status');
        const box = state.form.querySelector('[data-image-paste]');
        const button = state.form.querySelector('[data-paste-image]');
        const fallback = 'Click the image box and press Ctrl+V / ⌘V, or right-click it and choose Paste.';
        if (!navigator.clipboard?.read) {
            status.textContent = fallback;
            box.focus();
            return;
        }
        const revision = state.revision;
        state.pasting = true;
        button.disabled = true;
        try {
            const items = await navigator.clipboard.read();
            const files = [];
            for (const item of items) {
                const type = item.types.find(type => extensions[type]);
                if (!type) continue;
                const blob = await item.getType(type);
                files.push(new File([blob], `pasted-image-${crypto.randomUUID()}.${extensions[type]}`, { type }));
            }
            if (state.revision !== revision || state.form.hidden || !owner) return;
            if (!files.length) status.textContent = 'No image found. Copy an image or screenshot, then paste it here.';
            else addImages(state, files);
        } catch {
            if (state.revision === revision && !state.form.hidden) {
                status.textContent = `Clipboard access is unavailable. ${fallback}`;
                box.focus();
            }
        } finally {
            state.pasting = false;
            button.disabled = state.saving;
        }
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

    function setBusy(market, state, busy) {
        state.saving = busy;
        document.getElementById(`${market}-panel`).querySelectorAll('button, input, textarea').forEach(control => {
            control.disabled = busy || (control.hasAttribute('data-paste-image') && state.pasting);
        });
    }

    async function publish(body, session) {
        const response = await fetch(`${journalHost}/api/journal`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Publishing failed. Please retry.');
        return result;
    }

    async function deleteEntry(entry) {
        const state = editors.get(entry.market);
        if (!owner || state.saving) return;
        const draftWarning = state.entry?.id === entry.id && state.dirty ? ' Unsaved edits to this entry will also be discarded.' : '';
        if (!window.confirm(`Delete this ${entry.market} entry for ${displayDate(entry.entry_date)} and its images from the journal?${draftWarning}`)) return;
        setBusy(entry.market, state, true);
        notice.textContent = 'Deleting entry…';
        try {
            const { data: { session } } = await client.auth.getSession();
            if (!session) throw new Error('Please sign in with the journal owner account before deleting.');
            await publish({ action: 'delete', id: entry.id, market: entry.market, updated_at: entry.updated_at }, session);
            if (state.entry?.id === entry.id) clearEditor(state);
            entry.image_paths.forEach(path => {
                if (pendingImages.has(path)) URL.revokeObjectURL(pendingImages.get(path));
                pendingImages.delete(path);
            });
            entries = entries.filter(row => row.id !== entry.id);
            renderEntries();
            notice.textContent = 'Entry deleted. The public page will update once publishing finishes, usually in a few minutes.';
        } catch (error) {
            notice.textContent = error.message || 'The entry could not be deleted. Please retry.';
        } finally {
            setBusy(entry.market, state, false);
            document.querySelector(`[data-add-entry="${entry.market}"]`).focus();
        }
    }

    async function saveEntry(event, market, state) {
        event.preventDefault();
        if (!owner || state.saving) return;
        const status = state.form.querySelector('.journal-editor-status');
        if (state.pasting) {
            status.textContent = 'Finish pasting the image before saving.';
            return;
        }
        const description = state.form.elements.description.value.trim();
        if (!description && !state.images.length) {
            status.textContent = 'Add a description or at least one image.';
            return;
        }
        setBusy(market, state, true);
        status.textContent = 'Saving entry…';
        try {
            const { data: { session } } = await client.auth.getSession();
            if (!session) throw new Error('Please sign in with the journal owner account before saving.');
            const paths = [];
            const uploaded = [];
            for (const item of state.images) {
                if (item.path) { paths.push(item.path); continue; }
                if (!item.upload) {
                    const content = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.onerror = () => reject(new Error('This image could not be read.'));
                        reader.readAsDataURL(item.file);
                    });
                    item.upload = await publish({ action: 'image', content }, session);
                }
                uploaded.push(item.upload);
            }
            const { entry: data } = await publish({
                action: 'entry', id: state.id, market, entry_date: state.form.elements.date.value,
                description, image_paths: paths, uploaded_images: uploaded, updated_at: state.entry?.updated_at || null,
            }, session);
            for (const item of state.images) {
                if (item.file && item.upload) {
                    const path = `journal/images/${state.id}/${item.upload.sha}.${item.upload.extension}`;
                    if (pendingImages.has(path)) URL.revokeObjectURL(pendingImages.get(path));
                    pendingImages.set(path, URL.createObjectURL(item.file));
                }
            }
            entries = entries.filter(entry => entry.id !== data.id);
            entries.push(data);
            clearEditor(state);
            renderEntries();
            notice.textContent = 'Entry saved. It will be public once publishing finishes, usually in a few minutes.';
        } catch (error) {
            status.textContent = error.message || 'The entry could not be saved. Your changes are still in the editor.';
        } finally {
            setBusy(market, state, false);
            if (state.form.hidden && owner) document.querySelector(`[data-add-entry="${market}"]`).focus();
        }
    }

    for (const market of markets) {
        const form = document.getElementById('journal-editor-template').content.firstElementChild.cloneNode(true);
        document.querySelector(`[data-editor="${market}"]`).append(form);
        const state = { form, images: [], dirty: false, saving: false, pasting: false, revision: 0, entry: null };
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
        form.elements.images.addEventListener('change', () => {
            const files = Array.from(form.elements.images.files);
            form.elements.images.value = '';
            addImages(state, files);
        });
        form.querySelector('[data-paste-image]').addEventListener('click', () => pasteImage(state));
        const pasteBox = form.querySelector('[data-image-paste]');
        pasteBox.addEventListener('beforeinput', event => event.preventDefault());
        pasteBox.addEventListener('input', () => pasteBox.replaceChildren());
        pasteBox.addEventListener('paste', event => {
            event.preventDefault();
            if (!owner || state.saving || form.hidden) return;
            const files = transferredFiles(event.clipboardData);
            if (files.length) addImages(state, files);
            else form.querySelector('.journal-editor-status').textContent = 'No image found. Copy an image or screenshot, then paste it here.';
        });
        pasteBox.addEventListener('dragover', event => {
            event.preventDefault();
            if (!state.saving) pasteBox.classList.add('is-dragging');
        });
        pasteBox.addEventListener('dragleave', () => pasteBox.classList.remove('is-dragging'));
        pasteBox.addEventListener('drop', event => {
            event.preventDefault();
            pasteBox.classList.remove('is-dragging');
            addImages(state, transferredFiles(event.dataTransfer));
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
            const { data, error } = await client.auth.getUser(session.access_token);
            allowed = !error && data.user?.email?.toLowerCase() === 'andyno30@gmail.com' && !!data.user.email_confirmed_at;
        }
        if (version !== authVersion) return;
        owner = allowed;
        document.querySelectorAll('[data-journal-owner-only]').forEach(node => { node.hidden = !owner; });
        document.querySelectorAll('[data-journal-visitor-only]').forEach(node => { node.hidden = owner; });
        document.querySelectorAll('[data-add-entry]').forEach(button => { button.hidden = !owner; });
        document.getElementById('journal-login').hidden = owner;
        document.getElementById('journal-owner-status').hidden = !owner;
        if (!owner) editors.forEach(state => { state.form.hidden = true; });
        renderEntries();
    }

    async function loadEntries() {
        try {
            const response = await fetch(`${journalHost}/journal/entries.json`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Journal unavailable');
            entries = await response.json();
            renderEntries();
            notice.textContent = '';
        } catch {
            notice.textContent = 'The journal could not be loaded. Please refresh to try again.';
        }
    }

    async function initializeAuth() {
        try {
            ({ supabase: client } = await import('./docs/auth.js'));
            client.auth.onAuthStateChange((_event, session) => {
                // Run outside the auth callback's lock before verifying the user.
                setTimeout(() => { updateOwner(session).catch(() => {}); }, 0);
            });
            const { data: { session } } = await client.auth.getSession();
            await updateOwner(session);
        } catch {
            // Public entries remain available when login verification is unavailable.
        }
    }

    loadEntries();
    initializeAuth();
})();
