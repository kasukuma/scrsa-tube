import fetch from 'node-fetch';

let aliveInstances = [];

export function setAliveInstances(instances) {
    aliveInstances = instances;
}

const FALLBACK_INSTANCES = [
    'https://cal1.iv.ggtyler.dev/',
    'https://eu-proxy.poketube.fun/',
    'https://invid-api.poketube.fun/',
    'https://invidious.nerdvpn.de/',
    'https://invidious.private.coffee/',
    'https://invidious.f5.si/',
    'https://yewtu.be/',
    'https://invidious.jing.rocks/',
    'https://iv.duti.dev/',
    'https://nyc1.iv.ggtyler.dev/',
    'https://pol1.iv.ggtyler.dev/',
    'https://usa-proxy2.poketube.fun/',
];

function getPool(max) {
    const base = aliveInstances.length > 0 ? aliveInstances : FALLBACK_INSTANCES;
    return base.slice(0, max);
}

async function fetchWithTimeout(url, ms, signal) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    const onAbort = () => ac.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        return await fetch(url, {
            signal: ac.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept': 'application/json',
            },
        });
    } finally {
        clearTimeout(t);
        signal?.removeEventListener('abort', onAbort);
    }
}

const ITAG_PRIORITY = ['18', '22', '43', '36', '17'];

function pickStream(data) {
    const formats = data.formatStreams || [];
    for (const itag of ITAG_PRIORITY) {
        const f = formats.find(f => String(f.itag) === itag && f.url);
        if (f) return f.url;
    }
    const byRes = formats.find(f =>
        f.url && (
            (f.resolution || '').includes('360') ||
            (f.qualityLabel || '').includes('360')
        )
    );
    if (byRes) return byRes.url;
    const anyMp4 = formats.find(f => f.url && f.type?.includes('video/mp4'));
    if (anyMp4) return anyMp4.url;
    const any = formats.find(f => f.url);
    return any?.url || null;
}

function pickStreamCandidates(data) {
    const formats = data.formatStreams || [];
    const seen = new Set();
    const out = [];
    const push = (u) => { if (u && !seen.has(u)) { seen.add(u); out.push(u); } };
    for (const itag of ITAG_PRIORITY) {
        const f = formats.find(f => String(f.itag) === itag && f.url);
        if (f) push(f.url);
    }
    for (const f of formats) {
        if (f.url && (f.type || '').includes('video/mp4')) push(f.url);
    }
    for (const f of formats) {
        if (f.url) push(f.url);
    }
    if (data.hlsUrl) push(data.hlsUrl);
    return out;
}

export async function getLink(id, signal) {
    const targets = getPool(10);
    if (targets.length === 0) return null;

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const promises = targets.map(async (inst) => {
        const res = await fetchWithTimeout(
            `${inst}api/v1/videos/${id}?fields=formatStreams,hlsUrl`,
            9000,
            controller.signal
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        const data = await res.json();
        const url = pickStream(data) || data.hlsUrl;
        if (!url) throw new Error('No stream URL');
        controller.abort();
        return url;
    });

    try {
        return await Promise.any(promises);
    } catch {
        return null;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}

export async function getLinkCandidates(id, max = 4, signal) {
    const targets = getPool(12);
    if (targets.length === 0) return [];

    const collected = [];
    const seen = new Set();

    const tasks = targets.map(async (inst) => {
        try {
            const res = await fetchWithTimeout(
                `${inst}api/v1/videos/${id}?fields=formatStreams,hlsUrl`,
                9000,
                signal
            );
            if (!res.ok) return;
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return;
            const data = await res.json();
            for (const u of pickStreamCandidates(data)) {
                if (!seen.has(u)) {
                    seen.add(u);
                    collected.push(u);
                    if (collected.length >= max) return;
                }
            }
        } catch {}
    });

    await Promise.allSettled(tasks);
    return collected.slice(0, max);
}
