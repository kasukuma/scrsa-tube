import { escapeHtml, formatViews, formatAge, formatSubs, formatDuration } from './utils.js';
import { getPlayerMode, onPlayerModeChange } from './settings.js';

const loadingHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
const REC_INITIAL_BATCH = 25;

const appEl = document.getElementById('onigiri-app');
const resEl = document.getElementById('onigiri-res');

let watchController = null;
let _runChannel = null;
let _navigateWatch = null;
let currentVideoId = '';
let currentVideoTitle = '';

let recAll      = [];
let recShown    = 0;
let recHasMore  = false;
let recLoading  = false;
let recPage     = 0;
let recExtraSeen = new Set();

let isLiveCurrent = false;
let isUpcomingCurrent = false;
let currentEffectivePlayer = 'embed';
let lastResolved = null;
let directUrlIdx = 0;
let directRetryCount = 0;
const MAX_DIRECT_RETRIES = 2;

let playlistContext = null;

export function setWatchHandlers({ runChannel, navigateWatch }) {
    _runChannel    = runChannel;
    _navigateWatch = navigateWatch;
}

export function abortWatch() {
    if (watchController) { watchController.abort(); watchController = null; }
}

onPlayerModeChange(() => {
    if (appEl.dataset.mode === 'watch' && currentVideoId) {
        directUrlIdx = 0;
        directRetryCount = 0;
        applyEffectivePlayer({ resolved: lastResolved });
    }
});

export async function runWatch(id, hint = {}, opts = {}) {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return;

    abortWatch();
    watchController = new AbortController();
    currentVideoId = id;
    currentVideoTitle = hint.title || '';
    recAll = [];
    recShown = 0;
    recHasMore = false;
    recLoading = false;
    recPage = 0;
    recExtraSeen = new Set();
    isLiveCurrent = false;
    isUpcomingCurrent = false;
    lastResolved = null;
    directUrlIdx = 0;
    directRetryCount = 0;
    playlistContext = opts.playlist || null;
    recScrollEnabled = false; // #6: 動画遷移のたびにリセット

    appEl.dataset.mode = 'watch';
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    renderShell(id, hint);

    const signal = watchController.signal;

    let info = null;
    try {
        const r = await fetch(`/api/video-info?id=${encodeURIComponent(id)}`, { signal });
        if (r.ok) info = await r.json();
    } catch {}
    if (signal.aborted || currentVideoId !== id) return;

    const live = !!(info?.liveNow);
    const upcoming = !!(info?.isUpcoming);
    isLiveCurrent = live;
    isUpcomingCurrent = upcoming;

    const title = info?.title || hint.title || '';
    if (title) {
        currentVideoTitle = title;
        const titleEl = document.getElementById('watch-title');
        if (titleEl) titleEl.textContent = title;
        document.title = `${title} - onigiri`;
    }

    if (info?.channelId) {
        renderChannelLine({ id: info.channelId, name: info.channelName });
        fetchChannelInfo(info.channelId, signal)
            .then(ci => { if (!signal.aborted) renderChannelLine(ci); })
            .catch(() => {});
    } else {
        renderChannelLine({ id: '', name: info?.channelName || '' });
    }

    if (live || upcoming) {
        lastResolved = { type: 'youtube_embed', url: '', isLive: live, isUpcoming: upcoming, urls: [] };
        currentEffectivePlayer = 'embed';
        renderEmbedPlayer(id);
        renderSwitcher();
        renderActionRow(id, lastResolved);
    } else {
        const requested = getPlayerMode();
        if (requested === 'direct') {
            renderPlaceholderPlayer();
            try {
                const rr = await fetch(`/api/resolve?id=${encodeURIComponent(id)}`, { signal });
                if (rr.ok) lastResolved = await rr.json();
            } catch {}
            if (signal.aborted || currentVideoId !== id) return;
            applyEffectivePlayer({ resolved: lastResolved });
            renderActionRow(id, lastResolved);
        } else {
            currentEffectivePlayer = 'embed';
            renderEmbedPlayer(id);
            renderSwitcher();
            fetch(`/api/resolve?id=${encodeURIComponent(id)}`, { signal })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (!data || signal.aborted || currentVideoId !== id) return;
                    lastResolved = data;
                    renderSwitcher();
                    renderActionRow(id, lastResolved);
                })
                .catch(() => {});
            renderActionRow(id, null);
        }
    }

    recAll = info?.recommended || [];
    renderSidebar();
}

function renderShell(id, hint) {
    const initialTitle = hint.title ? escapeHtml(hint.title) : '読み込み中…';

    resEl.innerHTML = `
        <div class="watch-wrap">
            <main class="watch-main">
                <div class="watch-player" id="watch-player"></div>
                <div class="watch-player__switcher" id="watch-switcher"></div>
                <h1 class="watch-title" id="watch-title">${initialTitle}</h1>
                <div class="watch-channel" id="watch-channel">
                    <div class="watch-channel__avatar watch-channel__avatar--placeholder"></div>
                    <div class="watch-channel__meta">
                        <span class="watch-channel__name">&nbsp;</span>
                    </div>
                </div>
                <div class="watch-actions" id="watch-actions">${loadingHTML}</div>
            </main>
            <aside class="watch-side" id="watch-side">${loadingHTML}</aside>
        </div>`;
    renderPlaceholderPlayer();
}

function renderPlaceholderPlayer() {
    const player = document.getElementById('watch-player');
    if (!player) return;
    player.innerHTML = `<div class="watch-player__placeholder">${loadingHTML}</div>`;
}

function renderEmbedPlayer(id) {
    const player = document.getElementById('watch-player');
    if (!player) return;
    const safeId = escapeHtml(id);
    player.innerHTML = `
        <iframe class="oni-iframe"
                src="https://www.youtube-nocookie.com/embed/${safeId}?rel=0&autoplay=1"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowfullscreen></iframe>`;
}

function renderDirectPlayer(streamUrl) {
    const player = document.getElementById('watch-player');
    if (!player) return;
    const safeUrl = escapeHtml(streamUrl);
    player.innerHTML = `<video controls autoplay playsinline preload="metadata" src="${safeUrl}"></video>`;
    const v = player.querySelector('video');
    if (!v) return;

    v.addEventListener('error', () => onDirectError(), { once: true });
    v.addEventListener('ended', () => onVideoEnded(), { once: true });
}

function onDirectError() {
    const urls = lastResolved?.urls || (lastResolved?.url ? [lastResolved.url] : []);
    directUrlIdx += 1;
    if (directUrlIdx < urls.length) {
        renderDirectPlayer(urls[directUrlIdx]);
        return;
    }
    if (directRetryCount < MAX_DIRECT_RETRIES) {
        directRetryCount += 1;
        directUrlIdx = 0;
        refetchAndRetry();
        return;
    }
    currentEffectivePlayer = 'embed';
    renderEmbedPlayer(currentVideoId);
    renderSwitcher();
}

async function refetchAndRetry() {
    const targetId = currentVideoId; // #4: 呼び出し時点の動画IDを保持
    const player = document.getElementById('watch-player');
    if (player) player.innerHTML = `<div class="watch-player__placeholder">${loadingHTML}</div>`;
    try {
        const r = await fetch(`/api/resolve?id=${encodeURIComponent(targetId)}&_=${Date.now()}`);
        if (currentVideoId !== targetId) return; // #4: ナビゲーション済みなら中断
        if (r.ok) {
            const data = await r.json();
            if (data && data.type === 'download' && (data.url || (data.urls && data.urls.length))) {
                lastResolved = data;
                directUrlIdx = 0;
                const urls = data.urls && data.urls.length ? data.urls : [data.url];
                renderDirectPlayer(urls[0]);
                renderSwitcher();
                renderActionRow(currentVideoId, lastResolved);
                return;
            }
        }
    } catch {}
    if (currentVideoId !== targetId) return; // #4: fetch待機中にナビゲーションされた場合も中断
    currentEffectivePlayer = 'embed';
    renderEmbedPlayer(currentVideoId);
    renderSwitcher();
}

function onVideoEnded() {
    if (playlistContext) {
        const next = getNextPlaylistVideo();
        if (next) {
            _navigateWatch?.(next.id, { title: next.title, thumbnail: next.thumbnail }, {
                playlist: { ...playlistContext, currentIndex: playlistContext.currentIndex + 1 },
            });
        }
    }
}

function getNextPlaylistVideo() {
    if (!playlistContext) return null;
    const list = playlistContext.videos || [];
    const idx = playlistContext.currentIndex;
    if (idx + 1 < list.length) return list[idx + 1];
    return null;
}

function applyEffectivePlayer({ resolved, force } = {}) {
    const requested = getPlayerMode();
    let effective = requested;

    if (isLiveCurrent || isUpcomingCurrent) {
        effective = 'embed';
    } else if (requested === 'direct') {
        const hasUrls = resolved && resolved.type === 'download' &&
            ((resolved.urls && resolved.urls.length) || resolved.url);
        if (!hasUrls) effective = 'embed';
    }

    if (force) effective = force;

    currentEffectivePlayer = effective;

    if (effective === 'direct' && resolved) {
        const urls = resolved.urls && resolved.urls.length ? resolved.urls : (resolved.url ? [resolved.url] : []);
        if (urls.length) {
            directUrlIdx = 0;
            renderDirectPlayer(urls[0]);
        } else {
            renderEmbedPlayer(currentVideoId);
            currentEffectivePlayer = 'embed';
        }
    } else {
        renderEmbedPlayer(currentVideoId);
    }
    renderSwitcher();
}

function renderSwitcher() {
    const sw = document.getElementById('watch-switcher');
    if (!sw) return;

    if (isLiveCurrent || isUpcomingCurrent) {
        sw.innerHTML = '';
        return;
    }

    const hasDirectUrls = lastResolved && lastResolved.type === 'download' &&
        ((lastResolved.urls && lastResolved.urls.length) || lastResolved.url);

    const directBtn = `<button class="watch-player__switch-btn ${currentEffectivePlayer === 'direct' ? 'watch-player__switch-btn--active' : ''}" data-mode="direct" ${hasDirectUrls ? '' : 'disabled'}>直接再生</button>`;
    const embedBtn  = `<button class="watch-player__switch-btn ${currentEffectivePlayer === 'embed' ? 'watch-player__switch-btn--active' : ''}" data-mode="embed">YouTube 埋め込み</button>`;

    sw.innerHTML = directBtn + embedBtn;

    sw.querySelectorAll('[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const mode = btn.dataset.mode;
            if (mode === currentEffectivePlayer) return;
            directUrlIdx = 0;
            directRetryCount = 0;
            applyEffectivePlayer({ resolved: lastResolved, force: mode });
        });
    });
}

function renderChannelLine(ci) {
    const wrap = document.getElementById('watch-channel');
    if (!wrap) return;

    const safeName = escapeHtml(ci.name || '');
    const subs = ci.subscribers ? escapeHtml('登録者 ' + formatSubs(ci.subscribers)) : '';
    const verified = ci.verified ? ' <span class="ch-badge" title="認証済みチャンネル">✓</span>' : '';

    let avatarHTML;
    if (ci.thumbnail) {
        avatarHTML = `<img class="watch-channel__avatar" src="${escapeHtml(ci.thumbnail)}" alt="">`;
    } else {
        avatarHTML = `<div class="watch-channel__avatar watch-channel__avatar--placeholder"></div>`;
    }

    wrap.innerHTML = `
        ${avatarHTML}
        <div class="watch-channel__meta">
            <span class="watch-channel__name">${safeName}${verified}</span>
            ${subs ? `<span class="watch-channel__subs">${subs}</span>` : ''}
        </div>`;

    if (ci.id) {
        wrap.classList.add('is-clickable');
        wrap.onclick = () => _runChannel?.(ci.id);
    } else {
        wrap.classList.remove('is-clickable');
        wrap.onclick = null;
    }

    const img = wrap.querySelector('img.watch-channel__avatar');
    if (img) {
        img.addEventListener('error', () => {
            const ph = document.createElement('div');
            ph.className = 'watch-channel__avatar watch-channel__avatar--placeholder';
            img.replaceWith(ph);
        }, { once: true });
    }
}

function renderActionRow(id, resolved) {
    const el = document.getElementById('watch-actions');
    if (!el) return;
    const safeId = escapeHtml(id);

    const ytLink = `<a href="https://www.youtube.com/watch?v=${safeId}" class="oni-yt-link" target="_blank" rel="noopener">YouTube で見る</a>`;

    if (resolved && resolved.type === 'download' && resolved.url && !isLiveCurrent && !isUpcomingCurrent) {
        el.innerHTML = `
            <a href="${escapeHtml(resolved.url)}" class="onigiri-dl-link" target="_blank" rel="noopener">ダウンロード</a>
            ${ytLink}`;
    } else {
        el.innerHTML = ytLink;
    }
}

function renderSidebar() {
    const side = document.getElementById('watch-side');
    if (!side) return;

    if (playlistContext) {
        renderPlaylistSidebar(side);
        return;
    }
    renderRecommendedInitial(side);
}

function renderPlaylistSidebar(side) {
    side.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'pl-sidebar__header';
    const total = playlistContext.videos?.length || 0;
    const idx = playlistContext.currentIndex + 1;
    header.innerHTML = `
        <div class="pl-sidebar__title">${escapeHtml(playlistContext.title || '再生リスト')}</div>
        <div class="pl-sidebar__meta">${idx} / ${total}</div>`;
    side.appendChild(header);

    const list = document.createElement('div');
    list.className = 'pl-sidebar__list rec-list';
    side.appendChild(list);

    (playlistContext.videos || []).forEach((v, i) => {
        list.appendChild(createPlaylistRow(v, i));
    });

    const active = list.querySelector('.pl-sidebar__row--active');
    if (active) {
        try { active.scrollIntoView({ block: 'nearest' }); } catch {}
    }
}

function createPlaylistRow(v, i) {
    const isActive = i === playlistContext.currentIndex;
    const row = document.createElement('div');
    row.className = 'rec-card pl-sidebar__row' + (isActive ? ' pl-sidebar__row--active' : '');
    const idxBadge = `<span class="pl-sidebar__index">${i + 1}</span>`;
    const lenText = formatDuration(v.lengthSeconds);
    const lenBadge = lenText ? `<span class="length-badge">${escapeHtml(lenText)}</span>` : '';
    row.innerHTML = `
        ${idxBadge}
        <div class="rec-card__thumb-wrap">
            <img class="rec-card__thumb" src="${escapeHtml(v.thumbnail)}" loading="lazy" alt="">
            ${lenBadge}
        </div>
        <div class="rec-card__info">
            <h3 class="rec-card__title">${escapeHtml(v.title)}</h3>
            ${v.channelName ? `<p class="rec-card__channel">${escapeHtml(v.channelName)}</p>` : ''}
        </div>`;

    const img = row.querySelector('img.rec-card__thumb');
    img.addEventListener('error', () => {
        img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    }, { once: true });

    row.addEventListener('click', () => {
        if (i === playlistContext.currentIndex) return;
        _navigateWatch?.(v.id, { title: v.title, thumbnail: v.thumbnail }, {
            playlist: { ...playlistContext, currentIndex: i },
        });
    });
    return row;
}

function renderRecommendedInitial(side) {
    if (!recAll.length) {
        side.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'rec-list';
        side.appendChild(list);
        const more = document.createElement('button');
        more.className = 'load-more-btn';
        more.id = 'rec-load-more';
        more.textContent = 'もっと読み込む';
        more.addEventListener('click', () => triggerLoadMore());
        side.appendChild(more);
        return;
    }

    side.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'rec-list';
    side.appendChild(list);

    const initial = recAll.slice(0, REC_INITIAL_BATCH);
    initial.forEach(v => {
        list.appendChild(createRecommendedCard(v));
        recExtraSeen.add(v.id);
    });
    recShown = initial.length;
    recHasMore = true;

    const more = document.createElement('button');
    more.className = 'load-more-btn';
    more.id = 'rec-load-more';
    more.textContent = 'もっと読み込む';
    more.addEventListener('click', () => triggerLoadMore());
    side.appendChild(more);
}

async function triggerLoadMore() {
    const btn = document.getElementById('rec-load-more');
    if (btn) btn.remove();
    await loadMoreRecommended();
    enableRecInfiniteScroll();
}

async function loadMoreRecommended() {
    if (recLoading || !recHasMore) return;
    if (playlistContext) return;
    recLoading = true;
    const list = document.querySelector('#watch-side .rec-list');

    try {
        if (recShown < recAll.length) {
            const next = recAll.slice(recShown, recShown + REC_INITIAL_BATCH);
            const frag = document.createDocumentFragment();
            next.forEach(v => {
                if (!recExtraSeen.has(v.id)) {
                    recExtraSeen.add(v.id);
                    frag.appendChild(createRecommendedCard(v));
                }
            });
            list?.appendChild(frag);
            recShown += next.length;
            recLoading = false;
            return;
        }

        recPage += 1;
        const q = (currentVideoTitle || '').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
        if (!q) {
            recHasMore = false;
            recLoading = false;
            return;
        }
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${recPage}`);
        if (!r.ok) {
            recHasMore = false;
            recLoading = false;
            return;
        }
        const data = await r.json();
        // #11: サーバーが {videos, hasMore} 形式で返すため対応
        const arr = Array.isArray(data.videos) ? data.videos : (Array.isArray(data) ? data : []);
        const newOnes = arr
            .filter(v => v && v.id && v.id !== currentVideoId && !recExtraSeen.has(v.id));
        if (newOnes.length === 0) {
            recHasMore = false;
            recLoading = false;
            return;
        }
        const frag = document.createDocumentFragment();
        newOnes.forEach(v => {
            recExtraSeen.add(v.id);
            frag.appendChild(createRecommendedCard(v));
        });
        list?.appendChild(frag);
    } catch {
        recHasMore = false;
    } finally {
        recLoading = false;
    }
}

let recScrollEnabled = false;
function enableRecInfiniteScroll() {
    recScrollEnabled = true;
}

function createRecommendedCard(v) {
    const views = formatViews(v.viewCount);
    const age   = formatAge(v.published, v.publishedText || '');
    const meta  = [views, age].filter(Boolean).join(' ・ ');

    const liveBadge = v.liveNow ? `<span class="live-badge">LIVE</span>` : '';
    const lenText = !v.liveNow ? formatDuration(v.lengthSeconds) : '';
    const lenBadge = lenText ? `<span class="length-badge">${escapeHtml(lenText)}</span>` : '';

    const card = document.createElement('div');
    card.className = 'rec-card';
    card.innerHTML = `
        <div class="rec-card__thumb-wrap">
            <img class="rec-card__thumb" src="${escapeHtml(v.thumbnail)}" loading="lazy" alt="">
            ${liveBadge}${lenBadge}
        </div>
        <div class="rec-card__info">
            <h3 class="rec-card__title">${escapeHtml(v.title)}</h3>
            ${v.channelName ? `<p class="rec-card__channel">${escapeHtml(v.channelName)}</p>` : ''}
            ${meta ? `<p class="rec-card__meta">${escapeHtml(meta)}</p>` : ''}
        </div>`;

    const img = card.querySelector('img.rec-card__thumb');
    img.addEventListener('error', () => {
        img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    }, { once: true });

    card.addEventListener('click', () => {
        if (typeof _navigateWatch === 'function') {
            _navigateWatch(v.id, { title: v.title, thumbnail: v.thumbnail });
        }
    });
    return card;
}

const recSentinel = document.createElement('div');
recSentinel.id = 'rec-scroll-sentinel';
recSentinel.style.cssText = 'height:1px;';
document.body.appendChild(recSentinel);

new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    if (appEl.dataset.mode !== 'watch') return;
    if (!recScrollEnabled) return;
    if (recLoading || !recHasMore) return;
    if (playlistContext) return;
    loadMoreRecommended();
}, { rootMargin: '600px' }).observe(recSentinel);

async function fetchChannelInfo(channelId, signal) {
    const r = await fetch('/api/channel/info?id=' + encodeURIComponent(channelId), { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data;
}