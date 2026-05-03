import { escapeHtml, formatViews, formatAge, formatDuration } from './utils.js';

const loadingHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

const appEl = document.getElementById('onigiri-app');
const resEl = document.getElementById('onigiri-res');

let homeController = null;
let _onCardClick = null;
let _runChannel  = null;

let currentPage  = 0;
let isFetching   = false;
let hasMore      = false;
let gridEl       = null;
let seenIds      = new Set();

let cache = null;

export function setHomeHandlers({ onCardClick, runChannel }) {
    _onCardClick = onCardClick;
    _runChannel  = runChannel;
}

export function abortHome() {
    if (homeController) { homeController.abort(); homeController = null; }
    isFetching = false;
}

export async function runHome() {
    abortHome();
    appEl.dataset.mode = 'home';
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    currentPage = 0;
    hasMore     = false;
    seenIds     = new Set();
    gridEl      = null;

    if (cache && Date.now() - cache.t < 5 * 60 * 1000) {
        seenIds = new Set(cache.videos.map(v => v.id));
        renderInitial(cache.videos, cache.hasMore);
        currentPage = cache.page;
        hasMore = cache.hasMore;
        return;
    }

    resEl.innerHTML = `<div class="video-grid">${loadingHTML}</div>`;
    await fetchPage(true);
}

async function fetchPage(isFirst) {
    if (isFetching) return;
    isFetching = true;
    homeController = new AbortController();

    const targetPage = isFirst ? 1 : currentPage + 1;

    try {
        const r = await fetch(
            `/api/home?mode=videos&page=${targetPage}&pageSize=24`,
            { signal: homeController.signal }
        );
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        const raw = Array.isArray(data.videos) ? data.videos : [];
        const fresh = raw.filter(v => v && v.id && !seenIds.has(v.id));
        fresh.forEach(v => seenIds.add(v.id));

        if (isFirst) {
            renderInitial(fresh, !!data.hasMore);
        } else {
            appendCards(fresh);
        }
        currentPage = targetPage;
        hasMore = !!data.hasMore;

        const all = cache && !isFirst ? cache.videos.concat(fresh) : fresh.slice();
        cache = { videos: all, hasMore, page: currentPage, t: Date.now() };
    } catch (e) {
        if (e.name === 'AbortError') return;
        if (isFirst) {
            resEl.innerHTML = `<p class="status-label">現在表示できません</p>`;
        }
    } finally {
        isFetching = false;
    }
}

function renderInitial(videos, more) {
    if (!videos.length) {
        resEl.innerHTML = `<p class="status-label">現在表示できる動画はありません</p>`;
        gridEl = null;
        return;
    }

    resEl.innerHTML = '';
    gridEl = document.createElement('div');
    gridEl.className = 'video-grid';
    appendCardsTo(gridEl, videos);
    resEl.appendChild(gridEl);
    hasMore = more;
}

function appendCards(videos) {
    if (!videos.length) return;
    if (!gridEl) {
        gridEl = resEl.querySelector('.video-grid');
        if (!gridEl) {
            resEl.innerHTML = '';
            gridEl = document.createElement('div');
            gridEl.className = 'video-grid';
            resEl.appendChild(gridEl);
        }
    }
    appendCardsTo(gridEl, videos);
}

function appendCardsTo(container, videos) {
    const frag = document.createDocumentFragment();
    videos.forEach(v => frag.appendChild(createGridCard(v)));
    container.appendChild(frag);
}

export function createGridCard(v) {
    const views = formatViews(v.viewCount);
    const age   = formatAge(v.published, v.publishedText || '');
    const meta  = [views, age].filter(Boolean).join(' ・ ');

    const card = document.createElement('article');
    card.className = 'video-card';
    card.dataset.id        = v.id;
    card.dataset.title     = v.title || '';
    card.dataset.thumb     = v.thumbnail || '';
    card.dataset.channelId = v.channelId || '';

    const channelHTML = v.channelName
        ? (v.channelId
            ? `<button class="video-card__channel-link" type="button">${escapeHtml(v.channelName)}</button>`
            : `<span>${escapeHtml(v.channelName)}</span>`)
        : '';

    const liveBadge = v.liveNow ? `<span class="live-badge">LIVE</span>` : '';
    const lenText = !v.liveNow ? formatDuration(v.lengthSeconds) : '';
    const lenBadge = lenText ? `<span class="length-badge">${escapeHtml(lenText)}</span>` : '';

    card.innerHTML = `
        <div class="video-card__thumb-wrap">
            <img class="video-card__thumb" src="${escapeHtml(v.thumbnail)}" loading="lazy" alt="">
            ${liveBadge}${lenBadge}
        </div>
        <div class="video-card__details">
            <div class="video-card__text">
                <h3 class="video-card__title">${escapeHtml(v.title)}</h3>
                ${channelHTML ? `<p class="video-card__channel">${channelHTML}</p>` : ''}
                ${meta ? `<p class="video-card__meta">${escapeHtml(meta)}</p>` : ''}
            </div>
        </div>`;

    const img = card.querySelector('img.video-card__thumb');
    img.addEventListener('error', () => {
        img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    }, { once: true });

    card.addEventListener('click', (e) => {
        if (e.target.closest('.video-card__channel-link')) return;
        _onCardClick?.(v.id, { title: v.title, thumbnail: v.thumbnail });
    });

    const ch = card.querySelector('.video-card__channel-link');
    if (ch && v.channelId) {
        ch.addEventListener('click', (e) => {
            e.stopPropagation();
            _runChannel?.(v.channelId);
        });
    }
    return card;
}

const sentinel = document.createElement('div');
sentinel.id = 'home-scroll-sentinel';
sentinel.style.cssText = 'height:1px;';
document.body.appendChild(sentinel);

new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting)         return;
    if (appEl.dataset.mode !== 'home')      return;
    if (isFetching || !hasMore)             return;
    fetchPage(false);
}, { rootMargin: '800px' }).observe(sentinel);