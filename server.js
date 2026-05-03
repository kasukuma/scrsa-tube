import express from 'express';
import fetch from 'node-fetch';
import helmet from 'helmet';
import { getLink, getLinkCandidates, setAliveInstances } from './downloader.js';

const app = express();

// #1: リバースプロキシ背後での正しいIPアドレス取得（レートリミットの正常動作に必須）
app.set('trust proxy', true);

// #7: セキュリティヘッダー設定
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            frameSrc: ["https://www.youtube-nocookie.com"],
            imgSrc: ["'self'", "https://i.ytimg.com", "https:", "data:"],
            mediaSrc: ["https:"],
            connectSrc: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(express.static('public'));

const INSTANCES = [
    'https://cal1.iv.ggtyler.dev/',
    'https://eu-proxy.poketube.fun/',
    'https://id.420129.xyz/',
    'https://inv.nadeko.net/',
    'https://inv1-nadeko-net.zproxy.org/',
    'https://inv2-nadeko-net.zproxy.org/',
    'https://inv3-nadeko-net.zproxy.org/',
    'https://inv4-nadeko-net.zproxy.org/',
    'https://invid-api.poketube.fun/',
    'https://invidious-f5-si.zproxy.org/',
    'https://invidious.0011.lt/',
    'https://invidious.adminforge.de/',
    'https://invidious.darkness.service/',
    'https://invidious.dhusch.de/',
    'https://invidious.ducks.party/',
    'https://invidious.einfachzocken.eu/',
    'https://invidious.esmailelbob.xyz/',
    'https://invidious.f5.si/',
    'https://invidious.jing.rocks/',
    'https://invidious.lunivers.trade/',
    'https://invidious.nerdvpn.de/',
    'https://invidious.nikkosphere.com/',
    'https://invidious.perennialte.ch/',
    'https://invidious.private.coffee/',
    'https://invidious.projectsegfau.lt/',
    'https://invidious.reallyaweso.me/',
    'https://iv.datura.network/',
    'https://iv.duti.dev/',
    'https://iv.melmac.space/',
    'https://lekker.gay/',
    'https://nyc1.iv.ggtyler.dev/',
    'https://pol1.iv.ggtyler.dev/',
    'https://super8.absturztau.be/',
    'https://usa-proxy2.poketube.fun/',
    'https://yewtu.be/',
    'https://youtube.mosesmang.com/',
    'https://yt.omada.cafe/',
];

const TZ = 'Asia/Tokyo';
const CHECK_HOURS = [4, 16];
let alive = [];

const resolveCache = new Map();
const RESOLVE_TTL = 3 * 60 * 1000;

const genericCache = new Map();

function gcGet(key) {
    const e = genericCache.get(key);
    if (!e) return null;
    if (e.expire < Date.now()) { genericCache.delete(key); return null; }
    return e.value;
}
function gcSet(key, value, ttlMs) {
    genericCache.set(key, { value, expire: Date.now() + ttlMs });
    if (genericCache.size > 300) {
        const now = Date.now();
        for (const [k, v] of genericCache) if (v.expire < now) genericCache.delete(k);
        if (genericCache.size > 300) {
            const oldest = genericCache.keys().next().value;
            if (oldest) genericCache.delete(oldest);
        }
    }
}

function resolveCacheGet(id) {
    const entry = resolveCache.get(id);
    if (!entry) return null;
    if (entry.expire < Date.now()) { resolveCache.delete(id); return null; }
    return entry.payload;
}

function resolveCacheSet(id, payload) {
    resolveCache.set(id, { payload, expire: Date.now() + RESOLVE_TTL });
    if (resolveCache.size > 500) {
        const now = Date.now();
        let deleted = 0;
        for (const [k, v] of resolveCache) {
            if (v.expire < now) { resolveCache.delete(k); deleted++; }
        }
        if (deleted === 0) {
            const oldest = resolveCache.keys().next().value;
            if (oldest) resolveCache.delete(oldest);
        }
    }
}

const rlStore = new Map();
function rateLimit(maxReq, windowMs) {
    return (req, res, next) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let rec = rlStore.get(ip);
        if (!rec || now > rec.reset) {
            rec = { count: 0, reset: now + windowMs };
            rlStore.set(ip, rec);
        }
        rec.count++;
        if (rec.count > maxReq) {
            return res.status(429).json({ error: 'リクエストが多すぎます。しばらくしてから再試行してください。' });
        }
        next();
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of rlStore) if (now > rec.reset) rlStore.delete(ip);
}, 5 * 60 * 1000);

function nowJST() {
    const parts = new Intl.DateTimeFormat('ja-JP', {
        timeZone: TZ, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find(p => p.type === type)?.value ?? 0);
    return { hour: get('hour'), minute: get('minute'), second: get('second'), ms: new Date().getMilliseconds() };
}

async function pingOnce() {
    const results = await Promise.allSettled(INSTANCES.map(async (url) => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 5000);
        const start = Date.now();
        try {
            const r = await fetch(`${url}api/v1/search?q=test`, { signal: ac.signal });
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return null;
            const json = await r.json();
            if (!Array.isArray(json)) return null;
            return { url, ms: Date.now() - start };
        } catch {
            return null;
        } finally {
            clearTimeout(t);
        }
    }));
    return results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .sort((a, b) => a.ms - b.ms)
        .map(r => r.url);
}

async function ping() {
    for (let i = 0; i <= 2; i++) {
        alive = await pingOnce();
        if (alive.length >= 3) break;
    }
    setAliveInstances(alive);
}

function scheduleNext() {
    const { hour, minute, second, ms } = nowJST();
    let next = Infinity;
    for (const h of CHECK_HOURS) {
        let wait = ((h - hour) * 3600 - minute * 60 - second) * 1000 - ms;
        if (wait <= 0) wait += 86400_000;
        if (wait < next) next = wait;
    }
    setTimeout(async () => { await ping(); scheduleNext(); }, next);
}

async function raceJson(path, validator) {
    if (alive.length === 0) throw new Error('no_alive');
    const shared = new AbortController();
    return await Promise.any(alive.map(async (inst) => {
        const r = await fetch(`${inst}${path}`, {
            signal: shared.signal,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        });
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        const json = await r.json();
        if (!validator(json)) throw new Error('Invalid');
        shared.abort();
        return json;
    }));
}

async function tryRaceJson(path, validator) {
    try { return await raceJson(path, validator); } catch { return null; }
}

function pickBestThumb(thumbs) {
    if (!Array.isArray(thumbs) || thumbs.length === 0) return '';
    const sorted = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
    const url = sorted[0].url || '';
    return url.startsWith('//') ? `https:${url}` : url;
}

function normalizeVideo(v) {
    return {
        id: v.videoId,
        title: v.title || '',
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        channelId: v.authorId || '',
        channelName: v.author || '',
        viewCount: v.viewCount || 0,
        published: typeof v.published === 'number' && Number.isFinite(v.published) ? v.published : 0,
        publishedText: v.publishedText || '',
        lengthSeconds: v.lengthSeconds || 0,
        liveNow: !!v.liveNow,
        isUpcoming: !!v.isUpcoming,
    };
}

app.get('/health', (_req, res) => res.send('ok'));

async function detectLive(id) {
    const cacheKey = `live:${id}`;
    const c = gcGet(cacheKey);
    if (c) return c;
    try {
        const data = await raceJson(
            `api/v1/videos/${encodeURIComponent(id)}?fields=liveNow,isUpcoming,lengthSeconds`,
            (j) => j && (j.liveNow !== undefined || j.isUpcoming !== undefined || j.lengthSeconds !== undefined)
        );
        const payload = {
            isLive: !!data.liveNow,
            isUpcoming: !!data.isUpcoming,
            lengthSeconds: data.lengthSeconds || 0,
        };
        gcSet(cacheKey, payload, 60 * 1000);
        return payload;
    } catch {
        return { isLive: false, isUpcoming: false, lengthSeconds: 0 };
    }
}

app.get('/api/resolve', rateLimit(40, 60_000), async (req, res) => {
    const { id } = req.query;
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return res.status(400).json({ error: '無効な動画IDです' });
    }

    const cached = resolveCacheGet(id);
    if (cached) return res.json(cached);

    try {
        const live = await detectLive(id);
        if (live.isLive || live.isUpcoming) {
            const payload = {
                type: 'youtube_embed',
                url: `https://www.youtube-nocookie.com/embed/${id}`,
                isLive: live.isLive,
                isUpcoming: live.isUpcoming,
                urls: [],
            };
            resolveCacheSet(id, payload);
            return res.json(payload);
        }

        const candidates = await getLinkCandidates(id, 4);
        if (candidates.length > 0) {
            const payload = {
                type: 'download',
                url: candidates[0],
                urls: candidates,
                isLive: false,
                isUpcoming: false,
            };
            resolveCacheSet(id, payload);
            return res.json(payload);
        }

        const url = await getLink(id);
        if (url) {
            const payload = { type: 'download', url, urls: [url], isLive: false, isUpcoming: false };
            resolveCacheSet(id, payload);
            return res.json(payload);
        }

        return res.json({
            type: 'youtube_embed',
            url: `https://www.youtube-nocookie.com/embed/${id}`,
            isLive: false,
            isUpcoming: false,
            urls: [],
        });
    } catch {
        return res.json({
            type: 'youtube_embed',
            url: `https://www.youtube-nocookie.com/embed/${id}`,
            isLive: false,
            isUpcoming: false,
            urls: [],
        });
    }
});

app.get('/api/search', rateLimit(30, 60_000), async (req, res) => {
    const q = req.query.q?.trim();
    if (!q) return res.status(400).json({ error: '検索ワードを入力してください' });
    if (alive.length === 0) return res.status(503).json({ error: '現在検索できるサーバーがありません' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    // #11: 1件余分に取得して hasMore を正確に判定する
    const SEARCH_PAGE_SIZE = 20;

    try {
        const json = await raceJson(
            `api/v1/search?q=${encodeURIComponent(q)}&page=${page}&type=video&hl=ja&region=JP`,
            (d) => Array.isArray(d)
        );
        const videos = json.filter(v => v.type === 'video' && v.videoId).map(normalizeVideo);
        const hasMore = videos.length >= SEARCH_PAGE_SIZE;
        return res.json({ videos, hasMore });
    } catch {
        return res.status(503).json({ error: '検索できるサーバーがありません。しばらくしてから再試行してください。' });
    }
});

app.get('/api/channel/info', rateLimit(30, 60_000), async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'チャンネルIDが必要です' });
    if (alive.length === 0) return res.status(503).json({ error: '現在検索できるサーバーがありません' });

    const cacheKey = `chinfo:${id}`;
    const c = gcGet(cacheKey);
    if (c) return res.json(c);

    try {
        const data = await raceJson(
            `api/v1/channels/${encodeURIComponent(id)}`,
            (j) => !!(j && j.author)
        );
        const payload = {
            id: data.authorId || id,
            name: data.author || '',
            verified: data.authorVerified || false,
            subscribers: data.subCount || 0,
            thumbnail: pickBestThumb(data.authorThumbnails),
        };
        gcSet(cacheKey, payload, 30 * 60 * 1000);
        return res.json(payload);
    } catch {
        return res.status(503).json({ error: 'チャンネル情報を取得できませんでした。' });
    }
});

app.get('/api/channel/videos', rateLimit(50, 60_000), async (req, res) => {
    const { id, type = 'videos', sort = 'newest', continuation } = req.query;
    if (!id) return res.status(400).json({ error: 'チャンネルIDが必要です' });
    if (alive.length === 0) return res.status(503).json({ error: '現在検索できるサーバーがありません' });

    const ep = type === 'shorts' ? 'shorts' : type === 'live' ? 'streams' : 'videos';

    const cacheKey = continuation ? null : `chvids:${id}:${ep}:${sort}`;
    if (cacheKey) {
        const c = gcGet(cacheKey);
        if (c) return res.json(c);
    }

    try {
        const data = await raceJson(
            `api/v1/channels/${encodeURIComponent(id)}/${ep}?${(() => {
                const p = new URLSearchParams({ sort_by: sort });
                if (continuation) p.set('continuation', continuation);
                return p.toString();
            })()}`,
            (j) => Array.isArray(j.videos)
        );

        const rawVideos = data.videos || [];
        const nextContinuation = data.continuation ?? data.continuationData ?? null;

        const payload = {
            videos: rawVideos.map(v => ({
                id: v.videoId,
                title: v.title || '',
                thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                viewCount: v.viewCount || 0,
                published: typeof v.published === 'number' && Number.isFinite(v.published) ? v.published : 0,
                publishedText: v.publishedText || '',
                lengthSeconds: v.lengthSeconds || 0,
                liveNow: !!v.liveNow,
                isUpcoming: !!v.isUpcoming,
            })),
            continuation: typeof nextContinuation === 'string' ? nextContinuation : null,
        };
        if (cacheKey) gcSet(cacheKey, payload, 5 * 60 * 1000);
        return res.json(payload);
    } catch {
        return res.status(503).json({ error: '動画一覧を取得できませんでした。' });
    }
});

app.get('/api/channel/playlists', rateLimit(30, 60_000), async (req, res) => {
    const { id, continuation } = req.query;
    if (!id) return res.status(400).json({ error: 'チャンネルIDが必要です' });
    if (alive.length === 0) return res.status(503).json({ error: '現在検索できるサーバーがありません' });

    const cacheKey = continuation ? null : `chpl:${id}`;
    if (cacheKey) {
        const c = gcGet(cacheKey);
        if (c) return res.json(c);
    }

    try {
        const params = new URLSearchParams();
        if (continuation) params.set('continuation', continuation);
        const data = await raceJson(
            `api/v1/channels/${encodeURIComponent(id)}/playlists${params.toString() ? '?' + params.toString() : ''}`,
            (j) => Array.isArray(j.playlists)
        );
        const next = data.continuation ?? null;
        const payload = {
            playlists: (data.playlists || []).map(p => {
                const firstId = p.videos?.[0]?.videoId || '';
                const fromInv = pickBestThumb(p.playlistThumbnails);
                const thumb = firstId
                    ? `https://i.ytimg.com/vi/${firstId}/hqdefault.jpg`
                    : (fromInv || '');
                return {
                    id: p.playlistId,
                    title: p.title || '',
                    thumbnail: thumb,
                    videoCount: p.videoCount || 0,
                    firstVideoId: firstId,
                };
            }),
            continuation: typeof next === 'string' ? next : null,
        };
        if (cacheKey) gcSet(cacheKey, payload, 10 * 60 * 1000);
        return res.json(payload);
    } catch {
        return res.status(503).json({ error: '再生リストを取得できませんでした。' });
    }
});

app.get('/api/playlist', rateLimit(30, 60_000), async (req, res) => {
    const { id, continuation } = req.query;
    if (!id) return res.status(400).json({ error: '再生リストIDが必要です' });
    if (alive.length === 0) return res.status(503).json({ error: '現在情報を取得できるサーバーがありません' });

    const cacheKey = continuation ? null : `pl:${id}`;
    if (cacheKey) {
        const c = gcGet(cacheKey);
        if (c) return res.json(c);
    }

    try {
        const params = new URLSearchParams();
        if (continuation) params.set('continuation', continuation);
        const data = await raceJson(
            `api/v1/playlists/${encodeURIComponent(id)}${params.toString() ? '?' + params.toString() : ''}`,
            (j) => !!(j && Array.isArray(j.videos))
        );

        const videos = (data.videos || [])
            .filter(v => v && v.videoId)
            .map(v => ({
                id: v.videoId,
                title: v.title || '',
                thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                channelId: v.authorId || '',
                channelName: v.author || '',
                lengthSeconds: v.lengthSeconds || 0,
                index: v.index || 0,
            }));

        const payload = {
            id: data.playlistId || id,
            title: data.title || '',
            author: data.author || '',
            authorId: data.authorId || '',
            videoCount: data.videoCount || videos.length,
            thumbnail: videos[0] ? videos[0].thumbnail : '',
            videos,
            continuation: typeof data.continuation === 'string' ? data.continuation : null,
        };
        if (cacheKey) gcSet(cacheKey, payload, 10 * 60 * 1000);
        return res.json(payload);
    } catch {
        return res.status(503).json({ error: '再生リストを取得できませんでした。' });
    }
});

app.get('/api/video-info', rateLimit(60, 60_000), async (req, res) => {
    const { id } = req.query;
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return res.status(400).json({ error: '無効な動画IDです' });
    }
    if (alive.length === 0) return res.status(503).json({ error: '現在情報を取得できるサーバーがありません' });

    const cacheKey = `vinfo:${id}`;
    const c = gcGet(cacheKey);
    if (c) return res.json(c);

    try {
        const data = await raceJson(
            `api/v1/videos/${id}?hl=ja&region=JP&fields=title,author,authorId,recommendedVideos,liveNow,isUpcoming,published,publishedText,lengthSeconds`,
            (j) => !!(j && (j.title || j.author))
        );

        const recommended = (data.recommendedVideos || [])
            .filter(v => v && v.videoId)
            .slice(0, 25)
            .map(v => ({
                id: v.videoId,
                title: v.title || '',
                thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
                channelId: v.authorId || '',
                channelName: v.author || '',
                viewCount: v.viewCount || 0,
                published: typeof v.published === 'number' && Number.isFinite(v.published) ? v.published : 0,
                publishedText: v.publishedText || '',
                lengthSeconds: v.lengthSeconds || 0,
                liveNow: !!v.liveNow,
            }));

        const payload = {
            id,
            title: data.title || '',
            channelId: data.authorId || '',
            channelName: data.author || '',
            published: typeof data.published === 'number' && Number.isFinite(data.published) ? data.published : 0,
            publishedText: data.publishedText || '',
            lengthSeconds: data.lengthSeconds || 0,
            liveNow: !!data.liveNow,
            isUpcoming: !!data.isUpcoming,
            recommended,
        };
        gcSet(cacheKey, payload, 5 * 60 * 1000);
        return res.json(payload);
    } catch {
        return res.status(503).json({ error: '動画情報を取得できませんでした。' });
    }
});

const HOME_TRENDING_TYPES = ['', 'music', 'gaming', 'movies', 'news'];
const HOME_TTL = 5 * 60 * 1000;

async function fetchHomeFeed(region) {
    const cacheKey = `home:${region}`;
    const cached = gcGet(cacheKey);
    if (cached) return cached;

    const buckets = await Promise.all([
        ...HOME_TRENDING_TYPES.map(t =>
            tryRaceJson(
                `api/v1/trending?region=${encodeURIComponent(region)}&hl=ja${t ? `&type=${t}` : ''}`,
                (j) => Array.isArray(j)
            )
        ),
        tryRaceJson(`api/v1/popular`, (j) => Array.isArray(j)),
    ]);

    const all = [];
    for (const b of buckets) if (Array.isArray(b)) all.push(...b);

    const seen = new Set();
    const deduped = [];
    for (const v of all) {
        if (!v || !v.videoId) continue;
        if (v.liveNow || v.isUpcoming) continue;
        if (seen.has(v.videoId)) continue;
        seen.add(v.videoId);
        deduped.push(normalizeVideo(v));
    }

    gcSet(cacheKey, deduped, HOME_TTL);
    return deduped;
}

app.get('/api/home', rateLimit(60, 60_000), async (req, res) => {
    if (alive.length === 0) return res.status(503).json({ error: '現在情報を取得できるサーバーがありません' });

    const region = (req.query.region || 'JP').toString().slice(0, 4);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(60, Math.max(6, parseInt(req.query.pageSize, 10) || 24));

    try {
        const list = await fetchHomeFeed(region);

        const start = (page - 1) * pageSize;
        const slice = list.slice(start, start + pageSize);
        const hasMore = start + pageSize < list.length;

        return res.json({ videos: slice, hasMore, total: list.length });
    } catch {
        return res.status(503).json({ error: 'ホーム情報を取得できませんでした。' });
    }
});

const PORT = process.env.PORT || 3000;
ping().then(() => {
    scheduleNext();
    const server = app.listen(PORT);

    // #2: グレースフルシャットダウン — 処理中リクエストを完了させてから終了
    const shutdown = () => {
        server.close(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT',  shutdown);
});