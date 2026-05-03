import { escapeHtml } from './utils.js';
import { getPlayerMode } from './settings.js';

const loadingHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

const modal        = document.getElementById('oni-modal');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose   = document.getElementById('modal-close');
const modalThumb   = document.getElementById('modal-thumb');
const modalTitleEl = document.getElementById('modal-title-text');
const modalAction  = document.getElementById('modal-action');

let modalController = null;
let modalOpener     = null;
let onCloseCallback = null;
let currentVideoId  = '';
let currentUrls     = [];
let currentUrlIdx   = 0;

export function setModalCloseCallback(fn) {
    onCloseCallback = fn;
}

export async function openModal(id, title, thumbnail) {
    if (modalController) modalController.abort();
    modalController = new AbortController();
    currentVideoId = id;
    currentUrls = [];
    currentUrlIdx = 0;

    if (!modal.classList.contains('is-open')) {
        modalOpener = document.activeElement;
    }

    const card = document.querySelector('.oni-modal-card');
    card.classList.remove('oni-modal-card--wide');
    modalThumb.style.display = '';
    modalThumb.src = thumbnail || '';
    modalThumb.alt = title || '';
    modalTitleEl.textContent = title || '';
    modalAction.innerHTML = loadingHTML;

    modal.removeAttribute('inert');
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    modalClose.focus();

    try {
        const res  = await fetch(`/api/resolve?id=${encodeURIComponent(id)}`, { signal: modalController.signal });
        const data = await res.json();

        if (data.isLive || data.isUpcoming) {
            renderYoutubeModal(id);
            return;
        }

        const playerMode = getPlayerMode();

        if (data.type === 'download' && (data.url || (Array.isArray(data.urls) && data.urls.length))) {
            currentUrls = Array.isArray(data.urls) && data.urls.length ? data.urls.slice() : [data.url];
            currentUrlIdx = 0;
            modalThumb.style.display = 'none';
            card.classList.add('oni-modal-card--wide');
            if (playerMode === 'direct') {
                renderDirectVideoModal(id);
            } else {
                renderEmbedVideoModal(id);
            }
        } else {
            renderYoutubeModal(id);
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        renderYoutubeModal(id);
    }
}

function renderDirectVideoModal(id) {
    if (!currentUrls.length) {
        renderYoutubeModal(id);
        return;
    }
    const safeId = escapeHtml(id);
    const safeUrl = escapeHtml(currentUrls[currentUrlIdx]);
    const dlUrl = escapeHtml(currentUrls[0]);
    modalAction.innerHTML = `
        <video controls autoplay playsinline preload="metadata" src="${safeUrl}"></video>
        <a href="${dlUrl}" class="onigiri-dl-link" target="_blank" rel="noopener">ダウンロード</a>
        <a href="https://www.youtube.com/watch?v=${safeId}" class="oni-yt-link" target="_blank" rel="noopener">YouTube で見る</a>`;

    const v = modalAction.querySelector('video');
    if (v) {
        v.addEventListener('error', () => handleDirectError(id), { once: true });
    }
}

function handleDirectError(id) {
    currentUrlIdx += 1;
    if (currentUrlIdx < currentUrls.length) {
        renderDirectVideoModal(id);
    } else {
        renderEmbedVideoModal(id);
    }
}

function renderEmbedVideoModal(id) {
    const safeId = escapeHtml(id);
    const dlUrl = currentUrls[0] ? escapeHtml(currentUrls[0]) : '';
    modalAction.innerHTML = `
        <div class="oni-iframe-wrap oni-iframe-wrap--modal">
            <iframe class="oni-iframe" src="https://www.youtube-nocookie.com/embed/${safeId}?rel=0&autoplay=1"
                    allow="encrypted-media; picture-in-picture; fullscreen"></iframe>
        </div>
        ${dlUrl ? `<a href="${dlUrl}" class="onigiri-dl-link" target="_blank" rel="noopener">ダウンロード</a>` : ''}
        <a href="https://www.youtube.com/watch?v=${safeId}" class="oni-yt-link" target="_blank" rel="noopener">YouTube で見る</a>`;
}

function renderYoutubeModal(id) {
    const safeId = escapeHtml(id);
    const card   = document.querySelector('.oni-modal-card');
    modalThumb.style.display = 'none';
    card.classList.add('oni-modal-card--wide');
    modalAction.innerHTML = `
        <div class="oni-iframe-wrap oni-iframe-wrap--modal">
            <iframe class="oni-iframe" src="https://www.youtube-nocookie.com/embed/${safeId}?rel=0&autoplay=1"
                    allow="encrypted-media; picture-in-picture; fullscreen"></iframe>
        </div>
        <a href="https://www.youtube.com/watch?v=${safeId}" class="onigiri-dl-link oni-yt-link oni-yt-link--prominent" target="_blank" rel="noopener">
            YouTube で見る
        </a>`;
}

export function closeModal({ silent = false } = {}) {
    if (!modal.classList.contains('is-open')) return;

    if (modalController) {
        modalController.abort();
        modalController = null;
    }

    const iframe = modalAction.querySelector('iframe');
    if (iframe) iframe.src = '';
    const video = modalAction.querySelector('video');
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch {} }
    modalAction.innerHTML = '';
    currentVideoId = '';
    currentUrls = [];
    currentUrlIdx = 0;

    modal.classList.remove('is-open');
    modal.setAttribute('inert', '');
    document.body.style.overflow = '';

    if (modalOpener?.focus) modalOpener.focus();
    modalOpener = null;

    if (!silent && typeof onCloseCallback === 'function') onCloseCallback();
}

export function abortModal() {
    if (modalController) {
        modalController.abort();
        modalController = null;
    }
}

export function isModalOpen() {
    return modal.classList.contains('is-open');
}

modalClose.addEventListener('click', () => closeModal());
modalOverlay.addEventListener('click', () => closeModal());
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen()) closeModal();
});