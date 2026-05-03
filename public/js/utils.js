export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function formatViews(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    const trim = (v) => parseFloat(v.toFixed(1)).toString();
    if (n >= 100_000_000) return `${trim(n / 100_000_000)}億回視聴`;
    if (n >= 10_000)      return `${trim(n / 10_000)}万回視聴`;
    return `${n.toLocaleString()}回視聴`;
}

export function formatSubs(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    const trim = (v) => parseFloat(v.toFixed(1)).toString();
    if (n >= 100_000_000) return `${trim(n / 100_000_000)}億人`;
    if (n >= 10_000)      return `${trim(n / 10_000)}万人`;
    return `${n.toLocaleString()}人`;
}

const EN_AGE_UNIT_MAP = {
    second: { ja: '秒前',   sec: 1 },
    minute: { ja: '分前',   sec: 60 },
    hour:   { ja: '時間前', sec: 3600 },
    day:    { ja: '日前',   sec: 86400 },
    week:   { ja: '週間前', sec: 604800 },
    month:  { ja: 'か月前', sec: 2592000 },
    year:   { ja: '年前',   sec: 31536000 },
};

function translateEnglishAge(text) {
    if (!text || typeof text !== 'string') return '';
    const t = text.trim().toLowerCase();
    if (t === 'just now' || t === 'now') return 'たった今';
    const m = t.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago$/);
    if (!m) return text;
    const n = parseInt(m[1], 10);
    const unit = EN_AGE_UNIT_MAP[m[2]];
    if (!unit) return text;
    return `${n}${unit.ja}`;
}

function ageFromSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    if (seconds < 60)   return 'たった今';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)   return `${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)     return `${hours}時間前`;
    const days = Math.floor(hours / 24);
    if (days < 30)      return `${days}日前`;
    const months = Math.floor(days / 30);
    if (months < 12)    return `${months}か月前`;
    const years = Math.floor(months / 12);
    if (years < 1) return '';
    return `${years}年前`;
}

export function formatAge(unixTs, fallbackText = '') {
    const ts = Number(unixTs);
    if (Number.isFinite(ts) && ts > 0) {
        const seconds = Math.floor(Date.now() / 1000) - ts;
        const out = ageFromSeconds(seconds);
        if (out) return out;
    }
    return translateEnglishAge(fallbackText);
}

export function formatDuration(sec) {
    const s = Number(sec);
    if (!Number.isFinite(s) || s <= 0) return '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export function extractVideoId(val) {
    const patterns = [
        /v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /shorts\/([a-zA-Z0-9_-]{11})/,
        /embed\/([a-zA-Z0-9_-]{11})/,
        /live\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const r of patterns) {
        const m = val.match(r);
        if (m) return m[1];
    }
    return null;
}

export function extractPlaylistId(val) {
    if (!val) return null;
    const m = val.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
}