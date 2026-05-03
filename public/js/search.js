import { escapeHtml, formatViews, formatAge, formatDuration } from './utils.js';

const loadingHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
const PAGE_SIZE   = 20;

const appEl = document.getElementById('onigiri-app');
const resEl = document.getElementById('onigiri-res');

let currentQuery    = '';
let currentPage     = 1;
let isFetching      = false;
let hasMore         = false;
let fetchController = null;

let _onCardClick = null;
let _runChannel  = null;

export function setSearchHandlers({ onCardClick, runChannel }) {
    _onCardClick = onCardClick;
    _runChannel  = runChannel;
}

export function getCurrentQuery() {
    return currentQuery;
}

export async function runSearch(query, isNew = true) {
    if (isNew && currentQuery === query && appEl.dataset.mode === 'search' && resEl.querySelector('.search-list')) {
        return;
    }

    if (isFetching && isNew) {
        abortSearch();
    } else if (isFetching) {
        return;
    }

    if (isNew) {
        currentQuery = query;
        currentPage  = 1;
        hasMore      = false;
        appEl.dataset.mode = 'search';
        resEl.innerHTML    = `<div class="search-list">${loadingHTML}</div>`;
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    }

    const pageToFetch = isNew ? 1 : currentPage + 1;
    isFetching      = true;
    fetchController = new AbortController();

    try {
        const res = await fetch(
            `/api/search?q=${encodeURIComponent(currentQuery)}&page=${pageToFetch}`,
            { signal: fetchController.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // #11: サーバーが {videos, hasMore} 形式で返すようになったため対応
        const videos = Array.isArray(data.videos) ? data.videos : [];
        const serverHasMore = typeof data.hasMore === 'boolean' ? data.hasMore : videos.length >= PAGE_SIZE;

        let listEl;
        if (isNew) {
            resEl.innerHTML = '';
            if (!Array.isArray(videos) || videos.length === 0) {
                resEl.innerHTML = '<p class="status-label">検索結果がありませんでした</p>';
                return;
            }
            listEl = document.createElement('div');
            listEl.className = 'search-list';
            resEl.appendChild(listEl);
        } else {
            listEl = resEl.querySelector('.search-list');
            if (!listEl) return;
        }

        const frag = document.createDocumentFragment();
        videos.forEach(v => frag.appendChild(createSearchRow(v)));
        listEl.appendChild(frag);

        currentPage = pageToFetch;
        hasMore     = serverHasMore;
    } catch (e) {
        if (e.name === 'AbortError') return;
        if (isNew) {
            const msg = e.message?.includes('503')
                ? 'サーバーに接続できませんでした。しばらくしてから再試行してください。'
                : '検索に失敗しました';
            resEl.innerHTML = `<p class="status-label">${msg}</p>`;
        }
    } finally {
        isFetching      = false;
        fetchController = null;
    }
}

function createSearchRow(v) {
    const views = formatViews(v.viewCount);
    const age   = formatAge(v.published, v.publishedText || '');
    const meta  = [views, age].filter(Boolean).join(' ・ ');

    const liveBadge = v.liveNow ? `<span class="live-badge">LIVE</span>` : '';
    const lenText   = !v.liveNow ? formatDuration(v.lengthSeconds) : '';
    const lenBadge  = lenText ? `<span class="length-badge">${escapeHtml(lenText)}</span>` : '';

    const channelHTML = v.channelName
        ? (v.channelId
            ? `<button class="search-row__channel-link" type="button">${escapeHtml(v.channelName)}</button>`
            : `<span>${escapeHtml(v.channelName)}</span>`)
        : '';

    const row = document.createElement('article');
    row.className = 'search-row';
    row.innerHTML = `
        <div class="search-row__thumb-wrap">
            <img class="search-row__thumb" src="${escapeHtml(v.thumbnail)}" loading="lazy" alt="">
            ${liveBadge}${lenBadge}
        </div>
        <div class="search-row__info">
            <h3 class="search-row__title">${escapeHtml(v.title)}</h3>
            ${meta ? `<p class="search-row__meta">${escapeHtml(meta)}</p>` : ''}
            ${channelHTML ? `<p class="search-row__channel">${channelHTML}</p>` : ''}
        </div>`;

    const img = row.querySelector('img.search-row__thumb');
    img.addEventListener('error', () => {
        img.src = `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
    }, { once: true });

    row.addEventListener('click', (e) => {
        if (e.target.closest('.search-row__channel-link')) return;
        _onCardClick?.(v.id, { title: v.title, thumbnail: v.thumbnail });
    });

    const chBtn = row.querySelector('.search-row__channel-link');
    if (chBtn && v.channelId) {
        chBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _runChannel?.(v.channelId);
        });
    }
    return row;
}

export function abortSearch() {
    if (fetchController) {
        fetchController.abort();
        fetchController = null;
    }
    isFetching = false;
}

export function getSearchState() {
    return { currentQuery, hasMore, isFetching };
}

const sentinel = document.createElement('div');
sentinel.id = 'search-scroll-sentinel';
sentinel.style.cssText = 'height:1px;';
document.body.appendChild(sentinel);

new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting)           return;
    if (appEl.dataset.mode !== 'search')      return;
    const state = getSearchState();
    if (state.isFetching || !state.hasMore)   return;
    runSearch(state.currentQuery, false);
}, { rootMargin: '600px' }).observe(sentinel);