import { extractVideoId } from './utils.js';
import { initSettings, isModalMode } from './settings.js';
import { runHome, abortHome, setHomeHandlers } from './home.js';
import { runSearch, abortSearch, setSearchHandlers, getCurrentQuery } from './search.js';
import { runChannel, abortChannel, resetChannelState, setChannelHandlers } from './channel.js';
import { runWatch, abortWatch, setWatchHandlers } from './watch.js';
import { openModal, closeModal, isModalOpen, setModalCloseCallback } from './modal.js';

const appEl   = document.getElementById('onigiri-app');
const inputEl = document.getElementById('v_url');
const btnEl   = document.getElementById('v_exec');
const logoBtn = document.getElementById('logo-btn');

initSettings();

let suppressPush = false;

function pushHistory(state) {
    if (suppressPush) return;
    const cur = history.state;
    if (cur && cur.mode === state.mode &&
        cur.query     === state.query &&
        cur.videoId   === state.videoId &&
        cur.channelId === state.channelId &&
        !!cur.modal   === !!state.modal) {
        return;
    }
    history.pushState(state, '', buildUrl(state));
}

function replaceHistory(state) {
    history.replaceState(state, '', buildUrl(state));
}

function buildUrl(state) {
    if (!state) return '/';
    switch (state.mode) {
        case 'home':    return '/';
        case 'search':  return '/?q=' + encodeURIComponent(state.query || '');
        case 'watch':   return '/?v=' + encodeURIComponent(state.videoId || '');
        case 'channel': return '/?c=' + encodeURIComponent(state.channelId || '');
        default:        return '/';
    }
}

function abortAllExceptModal() {
    abortHome();
    abortSearch();
    abortChannel();
    abortWatch();
}

function goHome({ push = true } = {}) {
    if (isModalOpen()) closeModal({ silent: true });
    abortAllExceptModal();
    resetChannelState();
    inputEl.value = '';
    document.title = 'onigiri';
    runHome();
    if (push) pushHistory({ mode: 'home' });
}

function goSearch(query, { push = true } = {}) {
    if (!query) return;
    if (isModalOpen()) closeModal({ silent: true });
    inputEl.value = query;
    document.title = `${query} - onigiri`;

    const sameAsCurrent = appEl.dataset.mode === 'search' && getCurrentQuery() === query;
    if (!sameAsCurrent) {
        abortAllExceptModal();
        runSearch(query, true);
    } else {
        appEl.dataset.mode = 'search';
    }

    if (push) pushHistory({ mode: 'search', query });
}

function goWatch(videoId, hint = {}, { push = true } = {}) {
    if (!videoId) return;
    if (isModalOpen()) closeModal({ silent: true });
    abortHome();
    abortSearch();
    abortChannel();
    abortWatch();
    runWatch(videoId, hint);
    if (push) pushHistory({ mode: 'watch', videoId, videoHint: hint });
}

function goChannel(channelId, { push = true } = {}) {
    if (!channelId) return;
    if (isModalOpen()) closeModal({ silent: true });
    abortAllExceptModal();
    resetChannelState();
    runChannel(channelId);
    if (push) pushHistory({ mode: 'channel', channelId });
}

function handleVideoClick(videoId, hint = {}) {
    if (!videoId) return;
    if (isModalMode()) {
        openModal(videoId, hint.title || '', hint.thumbnail || '');
    } else {
        goWatch(videoId, hint);
    }
}

setModalCloseCallback(() => {});

setHomeHandlers({ onCardClick: handleVideoClick, runChannel: (id) => goChannel(id) });
setSearchHandlers({ onCardClick: handleVideoClick, runChannel: (id) => goChannel(id) });
setChannelHandlers({ onCardClick: handleVideoClick });
setWatchHandlers({
    runChannel:    (id) => goChannel(id),
    navigateWatch: (id, hint) => goWatch(id, hint),
});

window.addEventListener('popstate', (e) => {
    const state = e.state || { mode: 'home' };
    suppressPush = true;
    try {
        if (isModalOpen()) closeModal({ silent: true });

        switch (state.mode) {
            case 'home':
                goHome({ push: false });
                break;
            case 'search':
                if (state.query) goSearch(state.query, { push: false });
                else goHome({ push: false });
                break;
            case 'watch':
                if (state.videoId) {
                    goWatch(state.videoId, state.videoHint || {}, { push: false });
                } else {
                    goHome({ push: false });
                }
                break;
            case 'channel':
                if (state.channelId) goChannel(state.channelId, { push: false });
                else goHome({ push: false });
                break;
            default:
                goHome({ push: false });
        }
    } finally {
        suppressPush = false;
    }
});

inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btnEl.disabled) btnEl.click();
});

btnEl.addEventListener('click', () => {
    const val = inputEl.value.trim();
    if (!val) return;

    const id = extractVideoId(val);
    if (id) {
        goWatch(id, {});
    } else {
        goSearch(val);
    }
});

logoBtn.addEventListener('click', () => goHome());

(function bootstrap() {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    const v = params.get('v');
    const c = params.get('c');

    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        replaceHistory({ mode: 'watch', videoId: v });
        runWatch(v, {});
    } else if (c) {
        replaceHistory({ mode: 'channel', channelId: c });
        runChannel(c);
    } else if (q) {
        replaceHistory({ mode: 'search', query: q });
        inputEl.value = q;
        runSearch(q, true);
    } else {
        replaceHistory({ mode: 'home' });
        runHome();
    }
})();
