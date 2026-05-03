import { extractVideoId } from './utils.js';
import { initSettings, isModalMode }  from './settings.js';
import { runHome, abortHome, setHomeHandlers }            from './home.js';
import { runSearch, abortSearch, setSearchHandlers, getCurrentQuery } from './search.js';
import { runChannel, abortChannel, resetChannelState, setChannelHandlers } from './channel.js';
import { runWatch, abortWatch, setWatchHandlers }         from './watch.js';
import { openModal, closeModal, isModalOpen, setModalCloseCallback } from './modal.js';

const appEl   = document.getElementById('onigiri-app');
const inputEl = document.getElementById('v_url');
const btnEl   = document.getElementById('v_exec');
const logoBtn = document.getElementById('logo-btn');
const resEl   = document.getElementById('onigiri-res');

initSettings();

let suppressPush = false;
let playlistController = null; // #3: goPlaylist キャンセル用

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
    // #3: 進行中の goPlaylist フェッチのキャンセル
    if (playlistController) { playlistController.abort(); playlistController = null; }
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

function goWatch(videoId, hint = {}, opts = {}, { push = true } = {}) {
    if (!videoId) return;
    if (isModalOpen()) closeModal({ silent: true });
    abortHome();
    abortSearch();
    abortChannel();
    abortWatch();
    runWatch(videoId, hint, opts);
    if (push) pushHistory({ mode: 'watch', videoId, videoHint: hint });
}

function goChannel(channelId, { push = true } = {}) {
    if (!channelId) return;
    if (isModalOpen()) closeModal({ silent: true });
    abortAllExceptModal();
    runChannel(channelId);
    if (push) pushHistory({ mode: 'channel', channelId });
}

async function goPlaylist(playlistId, hint = {}) {
    if (!playlistId) return;
    if (isModalOpen()) closeModal({ silent: true });
    abortAllExceptModal(); // playlistController も一緒にキャンセル

    playlistController = new AbortController(); // #3: 新たなコントローラーを生成
    const signal = playlistController.signal;

    appEl.dataset.mode = 'watch';
    resEl.innerHTML = '<div class="status-label" style="padding:60px 0;">再生リストを読み込み中…</div>';
    document.title = (hint.title || '再生リスト') + ' - onigiri';

    try {
        const r = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`, { signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (signal.aborted) return; // #3: fetch完了前にナビゲーションされていたら中断
        const videos = Array.isArray(data.videos) ? data.videos : [];
        if (videos.length === 0) {
            resEl.innerHTML = '<p class="status-label">再生リストの動画を取得できませんでした。</p>';
            return;
        }
        const first = videos[0];
        const ctx = {
            id: data.id || playlistId,
            title: data.title || hint.title || '',
            videos,
            currentIndex: 0,
        };
        goWatch(first.id, { title: first.title, thumbnail: first.thumbnail }, { playlist: ctx });
    } catch (e) {
        if (e.name === 'AbortError') return; // #3: キャンセル時は何もしない
        resEl.innerHTML = '<p class="status-label">再生リストを取得できませんでした。</p>';
    } finally {
        playlistController = null;
    }
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
setChannelHandlers({
    onCardClick: handleVideoClick,
    onPlaylistClick: (pid, hint) => goPlaylist(pid, hint),
});
setWatchHandlers({
    runChannel:   (id) => goChannel(id),
    navigateWatch: (id, hint, opts) => goWatch(id, hint, opts || {}),
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
                    goWatch(state.videoId, state.videoHint || {}, {}, { push: false });
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