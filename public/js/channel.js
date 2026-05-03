import { escapeHtml, formatViews, formatAge, formatSubs, formatDuration } from './utils.js';

const loadingHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
const TAB_CACHE_TTL = 5 * 60 * 1000;

const appEl = document.getElementById('onigiri-app');
const resEl = document.getElementById('onigiri-res');

let currentChannelId   = '';
let currentChannelType = 'videos';
let currentChannelSort = 'newest';
let continuation       = null;
let isFetching         = false;
let channelController  = null;
let seenIds            = new Set();

const infoCache = new Map();
const tabCache  = new Map();

let _onCardClick = null;
let _onPlaylistClick = null;

export function setChannelHandlers({ onCardClick, onPlaylistClick }) {
    _onCardClick = onCardClick;
    _onPlaylistClick = onPlaylistClick;
}

function tabKey(id, type, sort) {
    return type === 'playlists' ? `pl:${id}` : `${type}:${sort}:${id}`;
}

function getTabCache(id, type, sort) {
    const k = tabKey(id, type, sort);
    const c = tabCache.get(k);
    if (!c) return null;
    if (Date.now() - c.t > TAB_CACHE_TTL) { tabCache.delete(k); return null; }
    return c;
}

function setTabCache(id, type, sort, payload) {
    const k = tabKey(id, type, sort);
    tabCache.set(k, { ...payload, t: Date.now() });
}

export async function runChannel(channelId, type, sort) {
    const isNewChannel = channelId !== currentChannelId;

    currentChannelType = type || 'videos';
    currentChannelSort = sort || 'newest';
    continuation       = null;
    isFetching         = false;
    seenIds            = new Set();

    if (channelController) { channelController.abort(); channelController = null; }

    if (isNewChannel) {
        currentChannelId   = channelId;
        appEl.dataset.mode = 'channel';
        resEl.innerHTML    = loadingHTML;
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
        await renderFullPage(channelId);
    } else {
        updateControlButtons();
        await replaceContentArea();
    }
}

async function renderFullPage(channelId) {
    channelController = new AbortController();
    try {
        const cachedInfo = infoCache.get(channelId);
        if (cachedInfo && Date.now() - cachedInfo.t < 30 * 60 * 1000) {
            renderHeader(cachedInfo.data);
        } else {
            const info = await fetchChannelInfo(channelId, channelController.signal);
            infoCache.set(channelId, { data: info, t: Date.now() });
            renderHeader(info);
        }
        renderControls();
        renderContentShell();
        await loadCurrentTab(true);
    } catch (e) {
        if (e.name === 'AbortError') return;
        resEl.innerHTML = '<p class="status-label">チャンネル情報を取得できませんでした</p>';
    }
}

function renderHeader(info) {
    const subsText  = info.subscribers ? '登録者 ' + formatSubs(info.subscribers) : '';
    const badge     = info.verified ? ' <span class="ch-badge" title="認証済みチャンネル">✓</span>' : '';
    const thumbHtml = info.thumbnail
        ? '<img class="ch-avatar" src="' + escapeHtml(info.thumbnail) + '" alt="">'
        : '<div class="ch-avatar ch-avatar--placeholder"></div>';

    resEl.innerHTML =
        '<div class="ch-header" id="ch-header">' +
            thumbHtml +
            '<div class="ch-header__info">' +
                '<span class="ch-name">' + escapeHtml(info.name) + badge + '</span>' +
                (subsText ? '<span class="ch-subs">' + escapeHtml(subsText) + '</span>' : '') +
            '</div>' +
        '</div>' +
        '<div class="ch-divider"></div>' +
        '<div id="ch-controls"></div>' +
        '<div class="ch-divider"></div>' +
        '<div id="ch-content"></div>' +
        '<div id="ch-load-more-wrap"></div>';

    const av = resEl.querySelector('img.ch-avatar');
    if (av) {
        av.addEventListener('error', () => {
            const ph = document.createElement('div');
            ph.className = 'ch-avatar ch-avatar--placeholder';
            av.replaceWith(ph);
        }, { once: true });
    }
}

function buildControlsHTML() {
    const a = (val, target) => val === target ? 'ch-btn--active' : '';
    const showSort = currentChannelType !== 'playlists';
    return '<div class="ch-controls">' +
        '<div class="ch-type-btns">' +
            '<button class="ch-btn ' + a(currentChannelType, 'videos')    + '" data-type="videos">動画</button>' +
            '<button class="ch-btn ' + a(currentChannelType, 'shorts')    + '" data-type="shorts">ショート</button>' +
            '<button class="ch-btn ' + a(currentChannelType, 'live')      + '" data-type="live">ライブ</button>' +
            '<button class="ch-btn ' + a(currentChannelType, 'playlists') + '" data-type="playlists">再生リスト</button>' +
        '</div>' +
        (showSort ? '<div class="ch-sort-btns">' +
            '<button class="ch-btn ' + a(currentChannelSort, 'newest')  + '" data-sort="newest">新しい</button>' +
            '<button class="ch-btn ' + a(currentChannelSort, 'popular') + '" data-sort="popular">人気</button>' +
            '<button class="ch-btn ' + a(currentChannelSort, 'oldest')  + '" data-sort="oldest">古い</button>' +
        '</div>' : '') +
    '</div>';
}

function bindControlButtons(el) {
    el.querySelectorAll('[data-type]').forEach(btn =>
        btn.addEventListener('click', () => {
            if (btn.dataset.type !== currentChannelType)
                runChannel(currentChannelId, btn.dataset.type, currentChannelSort);
        })
    );
    el.querySelectorAll('[data-sort]').forEach(btn =>
        btn.addEventListener('click', () => {
            if (btn.dataset.sort !== currentChannelSort)
                runChannel(currentChannelId, currentChannelType, btn.dataset.sort);
        })
    );
}

function renderControls() {
    const el = document.getElementById('ch-controls');
    if (!el) return;
    el.innerHTML = buildControlsHTML();
    bindControlButtons(el);
}

function updateControlButtons() {
    const el = document.getElementById('ch-controls');
    if (!el) return;
    el.innerHTML = buildControlsHTML();
    bindControlButtons(el);
}

function renderContentShell() {
    const el = document.getElementById('ch-content');
    if (el) el.innerHTML = loadingHTML;
    const lm = document.getElementById('ch-load-more-wrap');
    if (lm) lm.innerHTML = '';
}

async function replaceContentArea() {
    const el = document.getElementById('ch-content');
    if (el) el.innerHTML = loadingHTML;
    const lm = document.getElementById('ch-load-more-wrap');
    if (lm) lm.innerHTML = '';
    await loadCurrentTab(true);
}

async function loadCurrentTab(isFirst) {
    if (isFetching) return;

    if (isFirst) {
        const cached = getTabCache(currentChannelId, currentChannelType, currentChannelSort);
        if (cached) {
            continuation = cached.continuation;
            seenIds = new Set(cached.items.map(it => it.id));
            renderItems(cached.items, true);
            renderLoadMoreButton();
            return;
        }
    }

    isFetching        = true;
    channelController = new AbortController();

    try {
        let items = [];
        let next  = null;

        if (currentChannelType === 'playlists') {
            const data = await fetchChannelPlaylists(currentChannelId, isFirst ? null : continuation, channelController.signal);
            items = data.playlists || [];
            next  = data.continuation || null;
        } else {
            const data = await fetchChannelVideos(
                currentChannelId, currentChannelType, currentChannelSort,
                isFirst ? null : continuation, channelController.signal
            );
            items = data.videos || [];
            next  = data.continuation || null;
        }

        if (isFirst) seenIds = new Set();

        const fresh = items.filter(it => it && it.id && !seenIds.has(it.id));
        fresh.forEach(it => seenIds.add(it.id));

        renderItems(fresh, isFirst);

        continuation = next;

        if (isFirst) {
            setTabCache(currentChannelId, currentChannelType, currentChannelSort, {
                items: fresh, continuation: next,
            });
        } else {
            const existing = getTabCache(currentChannelId, currentChannelType, currentChannelSort);
            const combined = (existing?.items || []).concat(fresh);
            setTabCache(currentChannelId, currentChannelType, currentChannelSort, {
                items: combined, continuation: next,
            });
        }

        renderLoadMoreButton();
    } catch (e) {
        if (e.name === 'AbortError') return;
        if (isFirst) {
            const el = document.getElementById('ch-content');
            if (el) el.innerHTML = '<p class="status-label">読み込めませんでした</p>';
        }
    } finally {
        isFetching = false;
    }
}

function renderItems(items, isFirst) {
    const el = document.getElementById('ch-content');
    if (!el) return;

    if (isFirst) {
        el.innerHTML = '';
        if (items.length === 0) {
            el.innerHTML = '<p class="status-label">表示できる項目がありません</p>';
            return;
        }
        if (currentChannelType === 'playlists') {
            const grid = document.createElement('div');
            grid.className = 'ch-playlist-grid';
            el.appendChild(grid);
        } else {
            const list = document.createElement('div');
            list.className = 'ch-video-list';
            el.appendChild(list);
        }
    }

    if (currentChannelType === 'playlists') {
        let grid = el.querySelector('.ch-playlist-grid');
        if (!grid) {
            grid = document.createElement('div');
            grid.className = 'ch-playlist-grid';
            el.appendChild(grid);
        }
        const frag = document.createDocumentFragment();
        items.forEach(p => frag.appendChild(createPlaylistCard(p)));
        grid.appendChild(frag);
    } else {
        let list = el.querySelector('.ch-video-list');
        if (!list) {
            list = document.createElement('div');
            list.className = 'ch-video-list';
            el.appendChild(list);
        }
        const frag = document.createDocumentFragment();
        items.forEach(v => frag.appendChild(createChannelVideoCard(v)));
        list.appendChild(frag);
    }
}

function renderLoadMoreButton() {
    const wrap = document.getElementById('ch-load-more-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (currentChannelType === 'playlists') return;
    if (!continuation) return;

    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = 'もっと読み込む';
    btn.addEventListener('click', async () => {
        if (isFetching) return;
        btn.disabled = true;
        btn.textContent = '読み込み中…';
        await loadCurrentTab(false);
    });
    wrap.appendChild(btn);
}

function createChannelVideoCard(v) {
    const views = formatViews(v.viewCount);
    const age   = formatAge(v.published, v.publishedText || '');
    const meta  = [views, age].filter(Boolean).join(' ・ ');

    const liveBadge = v.liveNow ? `<span class="live-badge">LIVE</span>` : '';
    const lenText = !v.liveNow ? formatDuration(v.lengthSeconds) : '';
    const lenBadge = lenText ? `<span class="length-badge">${escapeHtml(lenText)}</span>` : '';

    const card = document.createElement('div');
    card.className = 'ch-video-card';
    card.innerHTML =
        '<div class="ch-video-card__thumb-wrap">' +
            '<img class="ch-video-card__thumb" src="' + escapeHtml(v.thumbnail) + '" loading="lazy" alt="">' +
            liveBadge + lenBadge +
        '</div>' +
        '<div class="ch-video-card__info">' +
            '<h2 class="ch-video-card__title">' + escapeHtml(v.title) + '</h2>' +
            (meta ? '<p class="ch-video-card__meta">' + escapeHtml(meta) + '</p>' : '') +
        '</div>';

    const img = card.querySelector('img.ch-video-card__thumb');
    img.addEventListener('error', () => {
        img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    }, { once: true });

    card.addEventListener('click', () => {
        _onCardClick?.(v.id, { title: v.title, thumbnail: v.thumbnail });
    });
    return card;
}

function createPlaylistCard(p) {
    const card = document.createElement('div');
    card.className = 'ch-playlist-card';
    const countBadge = p.videoCount
        ? `<span class="ch-playlist-card__count-badge">${escapeHtml(String(p.videoCount))} 本</span>`
        : '';

    const firstId = p.firstVideoId || '';
    const fallbackThumb = firstId ? `https://i.ytimg.com/vi/${firstId}/hqdefault.jpg` : '';
    const thumbSrc = firstId
        ? `https://i.ytimg.com/vi/${firstId}/hqdefault.jpg`
        : (p.thumbnail || '');

    const stackOverlay = '<span class="ch-playlist-card__stack" aria-hidden="true"></span>';
    const playOverlay = '<span class="ch-playlist-card__play" aria-hidden="true">▶ 再生</span>';
    card.innerHTML =
        '<div class="ch-playlist-card__thumb-wrap">' +
            (thumbSrc
                ? `<img class="ch-playlist-card__thumb" src="${escapeHtml(thumbSrc)}" loading="lazy" alt="">`
                : '<div class="ch-playlist-card__thumb ch-playlist-card__thumb--ph"></div>') +
            stackOverlay +
            playOverlay +
            countBadge +
        '</div>' +
        `<h3 class="ch-playlist-card__title">${escapeHtml(p.title || '')}</h3>`;

    const img = card.querySelector('img.ch-playlist-card__thumb');
    if (img) {
        const fallbacks = [];
        if (firstId) fallbacks.push(`https://i.ytimg.com/vi/${firstId}/mqdefault.jpg`);
        if (p.thumbnail && p.thumbnail !== thumbSrc) fallbacks.push(p.thumbnail);

        let fbIdx = 0;
        img.addEventListener('error', function onErr() {
            if (fbIdx < fallbacks.length) {
                img.src = fallbacks[fbIdx++];
            } else {
                img.removeEventListener('error', onErr);
                const ph = document.createElement('div');
                ph.className = 'ch-playlist-card__thumb ch-playlist-card__thumb--ph';
                img.replaceWith(ph);
            }
        });

        if (p.id && !firstId) {
            fetchPlaylistFirstThumb(p.id, channelController?.signal).then(fid => {
                if (!fid) return;
                const url = `https://i.ytimg.com/vi/${fid}/hqdefault.jpg`;
                if (img.src !== url) img.src = url;
            }).catch(() => {});
        }
    }

    card.addEventListener('click', () => {
        if (p.id) {
            _onPlaylistClick?.(p.id, { title: p.title, firstVideoId: p.firstVideoId });
        } else if (p.firstVideoId) {
            _onCardClick?.(p.firstVideoId, { title: p.title || '' });
        }
    });
    return card;
}

const firstThumbCache = new Map();
async function fetchPlaylistFirstThumb(playlistId, signal) {
    if (firstThumbCache.has(playlistId)) return firstThumbCache.get(playlistId);
    try {
        const r = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`, { signal });
        if (!r.ok) { firstThumbCache.set(playlistId, ''); return ''; }
        const data = await r.json();
        const id = data?.videos?.[0]?.id || '';
        firstThumbCache.set(playlistId, id);
        return id;
    } catch {
        firstThumbCache.set(playlistId, '');
        return '';
    }
}

async function fetchChannelInfo(id, signal) {
    const res  = await fetch('/api/channel/info?id=' + encodeURIComponent(id), { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

async function fetchChannelVideos(id, type, sort, cont, signal) {
    const params = new URLSearchParams({ id, type, sort });
    if (cont) params.set('continuation', cont);
    const res  = await fetch('/api/channel/videos?' + params, { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

async function fetchChannelPlaylists(id, cont, signal) {
    const params = new URLSearchParams({ id });
    if (cont) params.set('continuation', cont);
    const res  = await fetch('/api/channel/playlists?' + params, { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

export function abortChannel() {
    if (channelController) { channelController.abort(); channelController = null; }
    isFetching   = false;
}

export function resetChannelState() {
    currentChannelId   = '';
    currentChannelType = 'videos';
    currentChannelSort = 'newest';
    continuation       = null;
    isFetching         = false;
    seenIds            = new Set();
}