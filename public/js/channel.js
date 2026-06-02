import { escapeHtml, formatViews, formatAge, formatSubs, formatDuration } from './utils.js';

const loadingHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
const TAB_CACHE_TTL = 5 * 60 * 1000;

const appEl = document.getElementById('onigiri-app');
const resEl = document.getElementById('onigiri-res');

let currentChannelId  = '';
let continuation      = null;
let isFetching        = false;
let channelController = null;
let seenIds           = new Set();

const infoCache = new Map();
const tabCache  = new Map();

let _onCardClick = null;

export function setChannelHandlers({ onCardClick }) {
    _onCardClick = onCardClick;
}

function getTabCache(id) {
    const c = tabCache.get(id);
    if (!c) return null;
    if (Date.now() - c.t > TAB_CACHE_TTL) { tabCache.delete(id); return null; }
    return c;
}

function setTabCache(id, payload) {
    tabCache.set(id, { ...payload, t: Date.now() });
}

export async function runChannel(channelId) {
    const isNewChannel = channelId !== currentChannelId;

    continuation = null;
    isFetching   = false;
    seenIds      = new Set();

    if (channelController) { channelController.abort(); channelController = null; }

    if (isNewChannel) {
        currentChannelId   = channelId;
        appEl.dataset.mode = 'channel';
        resEl.innerHTML    = loadingHTML;
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
        await renderFullPage(channelId);
    } else {
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
        renderContentShell();
        await loadVideos(true);
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
    await loadVideos(true);
}

async function loadVideos(isFirst) {
    if (isFetching) return;

    if (isFirst) {
        const cached = getTabCache(currentChannelId);
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
        const data = await fetchChannelVideos(
            currentChannelId,
            isFirst ? null : continuation,
            channelController.signal
        );
        const items = data.videos || [];
        const next  = data.continuation || null;

        if (isFirst) seenIds = new Set();

        const fresh = items.filter(it => it && it.id && !seenIds.has(it.id));
        fresh.forEach(it => seenIds.add(it.id));

        renderItems(fresh, isFirst);

        continuation = next;

        if (isFirst) {
            setTabCache(currentChannelId, { items: fresh, continuation: next });
        } else {
            const existing = getTabCache(currentChannelId);
            const combined = (existing?.items || []).concat(fresh);
            setTabCache(currentChannelId, { items: combined, continuation: next });
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
            el.innerHTML = '<p class="status-label">表示できる動画がありません</p>';
            return;
        }
        const list = document.createElement('div');
        list.className = 'ch-video-list';
        el.appendChild(list);
    }

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

function renderLoadMoreButton() {
    const wrap = document.getElementById('ch-load-more-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!continuation) return;

    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = 'もっと読み込む';
    btn.addEventListener('click', async () => {
        if (isFetching) return;
        btn.disabled = true;
        btn.textContent = '読み込み中…';
        await loadVideos(false);
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

async function fetchChannelInfo(id, signal) {
    const res  = await fetch('/api/channel/info?id=' + encodeURIComponent(id), { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

async function fetchChannelVideos(id, cont, signal) {
    const params = new URLSearchParams({ id });
    if (cont) params.set('continuation', cont);
    const res  = await fetch('/api/channel/videos?' + params, { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

export function abortChannel() {
    if (channelController) { channelController.abort(); channelController = null; }
    isFetching = false;
}

export function resetChannelState() {
    currentChannelId = '';
    continuation     = null;
    isFetching       = false;
    seenIds          = new Set();
}
