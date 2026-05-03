const KEY_MODAL = 'onigiri.useModal';
const KEY_PLAYER_MODE = 'onigiri.playerMode';

const state = {
    useModal: false,
    playerMode: 'direct',
};

const listeners = { playerMode: new Set() };

function loadFromStorage() {
    try {
        const m = localStorage.getItem(KEY_MODAL);
        state.useModal = m === '1' || m === 'true' || m === 'modal';

        const p = localStorage.getItem(KEY_PLAYER_MODE);
        state.playerMode = (p === 'embed' || p === 'direct') ? p : 'direct';
    } catch {}
}

function save(key, value) {
    try { localStorage.setItem(key, value); } catch {}
}

export function isModalMode()    { return state.useModal; }
export function getPlayerMode()  { return state.playerMode; }

export function onPlayerModeChange(fn) { listeners.playerMode.add(fn); return () => listeners.playerMode.delete(fn); }

let drawerEl, overlayEl, closeBtn, openBtn, modalSel, playerSel;
let drawerOpener = null;

function openDrawer() {
    if (!drawerEl) return;
    drawerOpener = document.activeElement;
    drawerEl.classList.add('is-open');
    drawerEl.removeAttribute('inert');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    closeBtn?.focus();
}

function closeDrawer() {
    if (!drawerEl) return;
    drawerEl.classList.remove('is-open');
    drawerEl.setAttribute('inert', '');
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (drawerOpener?.focus) drawerOpener.focus();
    drawerOpener = null;
}

export function initSettings() {
    loadFromStorage();

    drawerEl  = document.getElementById('oni-drawer');
    overlayEl = document.getElementById('drawer-overlay');
    closeBtn  = document.getElementById('drawer-close');
    openBtn   = document.getElementById('menu-btn');
    modalSel  = document.getElementById('opt-modal-mode');
    playerSel = document.getElementById('opt-player-mode');

    if (modalSel) {
        modalSel.value = state.useModal ? 'modal' : 'page';
        modalSel.addEventListener('change', () => {
            state.useModal = modalSel.value === 'modal';
            save(KEY_MODAL, state.useModal ? 'modal' : 'page');
        });
    }

    if (playerSel) {
        playerSel.value = state.playerMode;
        playerSel.addEventListener('change', () => {
            state.playerMode = playerSel.value === 'embed' ? 'embed' : 'direct';
            save(KEY_PLAYER_MODE, state.playerMode);
            listeners.playerMode.forEach(fn => { try { fn(state.playerMode); } catch {} });
        });
    }

    openBtn?.addEventListener('click', openDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    overlayEl?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawerEl?.classList.contains('is-open')) closeDrawer();
    });
}