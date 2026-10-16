/**
 * 📱 Telegram Mini App (Web App) Sunucusu & REST API
 * 
 * Özellikler:
 * - Kullanıcı Bilgileri & Canlı Bakiye (GET /api/webapp/user)
 * - 🎁 Günlük Giriş Ödülü Sistemi (POST /api/webapp/daily-reward)
 * - 🛒 Gelişmiş Yıldız Marketi Kataloğu (GET /api/webapp/market)
 * - ⭐ Telegram Stars Fatura Oluşturma (POST /api/webapp/create-invoice)
 * - 🎡 Şans Çarkı Döndürme (POST /api/webapp/spin)
 * - 📁 Kategori & Sekme Listesi (GET /api/webapp/categories)
 * - Statik Dosyalar (index.html, css, js)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const db = require('./db');
const recovery = require('./recovery');

const PUBLIC_DIR = path.join(__dirname, 'public');

// ⭐ Özel Yıldızlı Sekme Fiyatlandırmaları
const STAR_CATEGORIES = {
    cat_1: { videoPrice: 2, photoPrice: 1 },  // Ensest
    cat_3: { videoPrice: 5, photoPrice: 1 },  // İfsa
    cat_5: { videoPrice: 10, photoPrice: 3 }, // Onlyfans
    cat_8: { videoPrice: 2, photoPrice: 1 }   // Gizli Çekim IPCAM
};

// 🛒 Gelişmiş Market Paketleri Kataloğu
const MARKET_PACKAGES = [
    // --- VIP Üyelikler ---
    {
        id: 'vip_1_day',
        category: 'vip',
        badge: '⚡ HIZLI VIP',
        title: '1 Günlük VIP',
        desc: '24 saat sınırsız indirme ve kredisiz havuz erişimi.',
        perks: ['Sınırsız Video & Fotoğraf İndirme', 'Bekleme Süresi Yok', '+1 Şans Çarkı Hediyesi 🎡'],
        stars: 100,
        payload: 'vip_1_day'
    },
    {
        id: 'vip_3_days',
        category: 'vip',
        badge: '👑 EN ÇOK TERCİH EDİLEN',
        title: '3 Günlük VIP',
        desc: '72 saat boyunca kesintisiz sınırsız indirme.',
        perks: ['Sınırsız Video & Fotoğraf', 'Öncelikli Medya Kuyruğu', '+2 Şans Çarkı Hediyesi 🎡'],
        stars: 250,
        payload: 'vip_3_days'
    },
    {
        id: 'vip_unlimited',
        category: 'vip',
        badge: '💎 ÖMÜR BOYU VIP',
        title: 'Sınırsız VIP Üyelik',
        desc: 'Kalıcı VIP statüsü, ömür boyu indirme özgürlüğü.',
        perks: ['Süresiz Sınırsız İndirme', 'Tüm Standart Sekmelere Erişim', '+5 Şans Çarkı Hediyesi 🎡'],
        stars: 450,
        payload: 'vip_unlimited'
    },

    // --- Video Kredisi Paketleri ---
    {
        id: 'pkg_video_5',
        category: 'video',
        badge: 'BAŞLANGIÇ',
        title: '5 Video Kredisi',
        desc: 'Havuzdan dilediğiniz 5 videoyu hemen izleyin.',
        perks: ['5 Video İndirme/İzleme', 'Tüm Sekmelerde Geçerli'],
        stars: 5,
        payload: 'pkg_video_5'
    },
    {
        id: 'pkg_video_15',
        category: 'video',
        badge: '⚡ %20 İNDİRİM',
        title: '15 Video Kredisi',
        desc: 'En popüler video paketi.',
        perks: ['15 Video İndirme/İzleme', 'Anında Hesaba Teslim'],
        stars: 12,
        payload: 'pkg_video_15'
    },
    {
        id: 'pkg_video_50',
        category: 'video',
        badge: '🔥 MEGA PAKET',
        title: '50 Video Kredisi',
        desc: 'Büyük arşivciler için en avantajlı video paketi.',
        perks: ['50 Video İndirme/İzleme', '%30 Tasarruf', '+1 Şans Çarkı Hediyesi 🎡'],
        stars: 35,
        payload: 'pkg_video_50'
    },
    {
        id: 'pkg_video_120',
        category: 'video',
        badge: '🚀 ULTRA %40 İNDİRİM',
        title: '120 Video Kredisi',
        desc: 'Maksimum video kredisi paketi.',
        perks: ['120 Video İndirme/İzleme', 'En Düşük Birim Fiyat', '+2 Şans Çarkı Hediyesi 🎡'],
        stars: 75,
        payload: 'pkg_video_120'
    },

    // --- Fotoğraf Kredisi Paketleri ---
    {
        id: 'pkg_photo_10',
        category: 'photo',
        badge: 'EKONOMİK',
        title: '10 Fotoğraf Kredisi',
        desc: '10 adet yüksek çözünürlüklü fotoğraf hakkı.',
        perks: ['10 Fotoğraf İndirme', 'Anında Bakiye'],
        stars: 5,
        payload: 'pkg_photo_10'
    },
    {
        id: 'pkg_photo_30',
        category: 'photo',
        badge: 'AVANTAJ',
        title: '30 Fotoğraf Kredisi',
        desc: 'Geniş fotoğraf arşivi için ideal.',
        perks: ['30 Fotoğraf İndirme', 'Tüm Sekmelerde Geçerli'],
        stars: 12,
        payload: 'pkg_photo_30'
    },
    {
        id: 'pkg_photo_100',
        category: 'photo',
        badge: '📸 MEGA FOTO',
        title: '100 Fotoğraf Kredisi',
        desc: '100 adet fotoğraf paketi.',
        perks: ['100 Fotoğraf İndirme', 'Süper İndirimli Fiyat'],
        stars: 30,
        payload: 'pkg_photo_100'
    },

    // --- Şans Çarkı Hakları ---
    {
        id: 'pkg_wheel_1',
        category: 'wheel',
        badge: 'ŞANSINI DENE',
        title: '1 Çark Çevirme',
        desc: '10 Krediye kadar jackpot kazanma şansı.',
        perks: ['1 Çevirme Hakkı (5 Yıldız)', 'Jackpot: 10 Video Kredisi'],
        stars: 5,
        payload: 'pkg_wheel_1'
    },
    {
        id: 'pkg_wheel_5',
        category: 'wheel',
        badge: '🎯 5x ÇEVİRME',
        title: '5 Çark Çevirme',
        desc: '5 kat daha fazla kazanma şansı.',
        perks: ['5 Çevirme Hakkı', 'Yüksek Kazanç Olasılığı'],
        stars: 20,
        payload: 'pkg_wheel_5'
    },
    {
        id: 'pkg_wheel_10',
        category: 'wheel',
        badge: '🎡 10x SÜPER',
        title: '10 Çark Çevirme',
        desc: 'Mega şans çarkı paketi.',
        perks: ['10 Çevirme Hakkı', 'Çoklu Jackpot İhtimali'],
        stars: 35,
        payload: 'pkg_wheel_10'
    },

    // --- Kombo Hibrit Paket ---
    {
        id: 'pkg_combo_20',
        category: 'combo',
        badge: '💎 HİBRİT KOMBO',
        title: 'Mega Kombo Paket',
        desc: 'Hem Video, hem Fotoğraf hem de Çark bir arada!',
        perks: ['20 Video Kredisi', '20 Fotoğraf Kredisi', '+3 Şans Çarkı Hakkı 🎁'],
        stars: 40,
        payload: 'pkg_combo_20'
    }
];

// 🔗 Telegram Dosya Linki Önbelleği & Güçlü Çoklu Token Çözücü
const fileLinkCache = new Map();
let fallbackTelegrafInstance = null;
function getFallbackBot() {
    if (!fallbackTelegrafInstance) {
        try {
            fallbackTelegrafInstance = new Telegraf('8151413936:AAFbhwQNpaGkW1CdShixrq2PJMNzC7jamjM');
        } catch (_) {}
    }
    return fallbackTelegrafInstance;
}

async function resolveTelegramFileLink(fileId, activeBot) {
    if (!fileId) return null;
    const now = Date.now();
    const cached = fileLinkCache.get(fileId);
    if (cached && cached.expiresAt > now) {
        return cached.link;
    }

    let link = null;
    // 1. Önce aktif bot örneği
    if (activeBot) {
        try { link = await activeBot.telegram.getFileLink(fileId); } catch (_) {}
    }
    // 2. Fallback Telegraf örneği (8151413936)
    if (!link) {
        try {
            const fb = getFallbackBot();
            if (fb) link = await fb.telegram.getFileLink(fileId);
        } catch (_) {}
    }
    // 3. process.env.BOT_TOKEN
    if (!link && process.env.BOT_TOKEN) {
        try {
            const envBot = new Telegraf(process.env.BOT_TOKEN);
            link = await envBot.telegram.getFileLink(fileId);
        } catch (_) {}
    }

    if (link) {
        const linkStr = typeof link === 'object' && link.href ? link.href : String(link);
        fileLinkCache.set(fileId, { link: linkStr, expiresAt: now + (30 * 60 * 1000) });
        return linkStr;
    }
    return null;
}

// 🚀 Evrensel Cross-Bot Güvenli Medya Gönderici (Hem aktif bot hem fallback bot garantili)
async function sendTelegramMediaUniversal(targetBot, recipientId, media, options = {}) {
    if (!media || !media.fileId) throw new Error('Medya veya fileId bulunamadı');
    const isVideo = media.type === 'video';
    const fileId = media.fileId;

    // 1. Önce doğrudan hedef bot ile fileId gönderimi dene
    if (targetBot) {
        try {
            if (isVideo) {
                return await targetBot.telegram.sendVideo(recipientId, fileId, options);
            } else {
                return await targetBot.telegram.sendPhoto(recipientId, fileId, options);
            }
        } catch (err) {
            // Cross-bot (wrong file_id) durumunda Telegram CDN linkiyle hedef bot üzerinden gönder
            if (err.message && (err.message.includes('wrong file_id') || err.message.includes('file is temporarily unavailable') || err.message.includes('400'))) {
                try {
                    const fb = getFallbackBot();
                    if (fb) {
                        const link = await fb.telegram.getFileLink(fileId);
                        const linkUrl = typeof link === 'object' && link.href ? link.href : String(link);
                        if (isVideo) {
                            return await targetBot.telegram.sendVideo(recipientId, { url: linkUrl }, options);
                        } else {
                            return await targetBot.telegram.sendPhoto(recipientId, { url: linkUrl }, options);
                        }
                    }
                } catch (urlErr) {
                    console.warn('URL ile hedef bot gönderimi başarısız:', urlErr.message);
                }
            }
        }
    }

    // 2. Fallback bot (8151413936) ile doğrudan dene
    const fb = getFallbackBot();
    if (fb && fb !== targetBot) {
        try {
            if (isVideo) {
                return await fb.telegram.sendVideo(recipientId, fileId, options);
            } else {
                return await fb.telegram.sendPhoto(recipientId, fileId, options);
            }
        } catch (fbErr) {
            console.error('Fallback bot gönderim hatası:', fbErr.message);
            throw fbErr;
        }
    }
}

function createWebAppServer(options = {}) {
    const ADMIN_IDS = ['8633136500'];
    const isAdminUser = options.isAdminUser || ((id) => String(id) === '8633136500');
    const botInstance = options.bot || (process.env.BOT_TOKEN ? new Telegraf(process.env.BOT_TOKEN) : null);

    const server = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            return res.end();
        }

        // ==========================================
        // 1. API: KULLANICI BİLGİLERİ & GÜNLÜK ÖDÜL
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/user' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            const firstName = parsedUrl.searchParams.get('firstName') || '';
            const username = parsedUrl.searchParams.get('username') || '';
            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'userId parametresi gerekli' }));
            }

            let user = db.getUser(userId);
            if (!user) {
                const resCreated = db.getOrCreateUser({ id: userId, first_name: firstName, username: username });
                user = resCreated.user;
            } else if (firstName || username) {
                if (firstName && user.firstName !== firstName) user.firstName = firstName;
                if (username && user.username !== username) user.username = username;
                db.saveDb && db.saveDb();
            }

            const vip = db.isUserVip(userId);
            const isAdmin = isAdminUser(userId);
            const dailyStatus = db.getDailyRewardStatus ? db.getDailyRewardStatus(userId) : { available: true };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
                id: user.id,
                photoCredits: user.photoCredits || 0,
                videoCredits: user.videoCredits || 0,
                wheelSpins: user.wheelSpins || 0,
                videoProgress: user.videoProgress || 0,
                photoProgress: user.photoProgress || 0,
                uploadedCount: user.uploadedCount || 0,
                receivedCount: user.receivedCount || 0,
                isVip: vip.isVip,
                isAdmin: isAdmin,
                dailyReward: dailyStatus
            }));
        }

        // ==========================================
        // 2. API: GÜNLÜK GİRİŞ ÖDÜLÜ TALEBİ
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/daily-reward' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const userId = String(data.userId || '');
                    if (!userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Geçersiz kullanıcı' }));
                    }

                    const result = db.claimDailyReward ? db.claimDailyReward(userId) : { success: false, message: 'Servis hazır değil' };
                    res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 3. API: GELİŞMİŞ MARKET KATALOĞU
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/market' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(MARKET_PACKAGES));
        }

        // ==========================================
        // 4. API: TELEGRAM STARS FATURA LİNKİ OLUŞTURMA
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/create-invoice' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const userId = String(data.userId || '');
                    const { pkgId, catId, type } = data;

                    if (!userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Kullanıcı ID gerekli' }));
                    }

                    if (!botInstance) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Bot bağlantısı aktif değil' }));
                    }

                    let title = '';
                    let description = '';
                    let payload = '';
                    let stars = 1;

                    // 1. Durum: Market Paketi Satın Alma
                    if (pkgId) {
                        const pkg = MARKET_PACKAGES.find(p => p.id === pkgId);
                        if (!pkg) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ success: false, message: 'Paket bulunamadı' }));
                        }
                        title = pkg.title;
                        description = pkg.desc;
                        payload = pkg.payload;
                        stars = pkg.stars;
                    }
                    // 2. Durum: Yıldızlı Özel Sekme İçeriği Satın Alma
                    else if (catId) {
                        const cat = db.getCategory(catId);
                        const starCfg = STAR_CATEGORIES[catId];
                        if (!starCfg) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ success: false, message: 'Bu sekme yıldızlı değil' }));
                        }
                        const isVideo = type === 'video';
                        stars = isVideo ? starCfg.videoPrice : starCfg.photoPrice;
                        title = `⭐ [${cat ? cat.key : ''}] ${cat ? cat.name : 'Özel'} ${isVideo ? 'Video' : 'Fotoğraf'}`;
                        description = `${cat ? cat.name : 'Özel'} sekmesinden 1 adet ${isVideo ? 'video' : 'fotoğraf'} hakkı.`;
                        payload = `cat_star_${catId}_${type}`;
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Geçersiz satın alma talebi' }));
                    }

                    // Telegram Stars Fatura Linki Oluştur
                    const invoiceLink = await botInstance.telegram.createInvoiceLink({
                        title: title.slice(0, 32),
                        description: description.slice(0, 255),
                        payload: payload,
                        provider_token: '',
                        currency: 'XTR',
                        prices: [{ label: `${stars} Yıldız ⭐`, amount: stars }]
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        invoiceLink,
                        title,
                        stars
                    }));
                } catch (e) {
                    console.error('Fatura linki oluşturma hatası:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 5. API: KATEGORİLER LİSTESİ
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/categories' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            const isAdmin = userId ? isAdminUser(userId) : false;

            const allCats = db.getCategories();
            // cat_11 (Genel) sekmesi sadece yöneticilere görünür
            const visibleCats = allCats.filter(c => c.id !== 'cat_11' || isAdmin);

            const result = visibleCats.map(c => {
                const stats = db.getCategoryStats(c.id);
                return {
                    id: c.id,
                    key: c.key,
                    name: c.name,
                    starCfg: STAR_CATEGORIES[c.id] || null,
                    stats: {
                        approvedPhotos: stats.approvedPhotos,
                        approvedVideos: stats.approvedVideos
                    }
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // ==========================================
        // 6. API: ŞANS ÇARKI ÇEVİRME
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/spin' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const userId = String(data.userId || '');
                    if (!userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Geçersiz kullanıcı' }));
                    }

                    const user = db.getUser(userId);
                    const spins = user ? (user.wheelSpins || 0) : 0;
                    if (spins <= 0) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Çevirme hakkınız kalmadı.' }));
                    }

                    // Çark çevirme olasılıkları (1-10 Video & 20 Fotoğraf Kredisi)
                    // Dilimler: 1 Video, 2 Video, 3 Video, 20 Fotoğraf, 5 Video, 1 Video, 10 Video, 2 Video
                    const wheelOptions = [
                        { type: 'video', amount: 1 },
                        { type: 'video', amount: 2 },
                        { type: 'video', amount: 3 },
                        { type: 'photo', amount: 20 },
                        { type: 'video', amount: 5 },
                        { type: 'video', amount: 1 },
                        { type: 'video', amount: 10 },
                        { type: 'video', amount: 2 }
                    ];
                    const prize = wheelOptions[Math.floor(Math.random() * wheelOptions.length)];
                    const wonAmount = prize.amount;
                    const prizeType = prize.type;

                    // Çark hakkını düşür ve kazanılan krediyi ekle
                    const remaining = db.useWheelSpin(userId);
                    let newCredits = 0;
                    if (prizeType === 'photo') {
                        db.updateCredits(userId, 'photo', wonAmount);
                        newCredits = (db.getUser(userId)?.photoCredits) || wonAmount;
                    } else {
                        db.updateCredits(userId, 'video', wonAmount);
                        newCredits = (db.getUser(userId)?.videoCredits) || wonAmount;
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        wonAmount,
                        prizeType,
                        remainingSpins: remaining,
                        newCredits
                    }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 7. API: KREDİLİ MEDYA TALEBİ (Mini App'ten)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/take-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const userId = String(data.userId || '');
                    const { catId, type } = data;
                    if (!userId || !catId || !type) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Eksik parametre' }));
                    }

                    const vip = db.isUserVip(userId);
                    const user = db.getUser(userId) || {};
                    const isVideo = type === 'video';
                    const credits = isVideo ? (user.videoCredits || 0) : (user.photoCredits || 0);

                    if (!vip.isVip && credits <= 0) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: `Yetersiz ${isVideo ? 'video' : 'resim'} kredisi` }));
                    }

                    const media = db.getRandomMedia(userId, type, catId);
                    if (!media) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Bu sekmede henüz izlemediğiniz içerik kalmadı.' }));
                    }

                    // Kredi düş (VIP değilse)
                    if (!vip.isVip) {
                        db.updateCredits(userId, type, -1);
                    }

                    // Telegram sohbetine gönder
                    if (botInstance) {
                        const cat = db.getCategory(catId);
                        const caption = `📁 <b>[${cat ? cat.key : ''}] ${cat ? cat.name : 'Sekme'} İçeriği</b>\n\n` +
                            `🎉 <i>Mini App üzerinden talep edildi. İyi seyirler!</i>`;
                        try {
                            await sendTelegramMediaUniversal(botInstance, userId, media, {
                                caption,
                                parse_mode: 'HTML',
                                protect_content: true
                            });
                        } catch (e) {
                            console.error('Mini App medya gönderim hatası:', e.message);
                        }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'İçerik bot sohbetinize gönderildi!' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 8. API: KULLANICININ ALDIĞI MEDYALAR (Video & Fotoğraf)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/received-media' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            const type = parsedUrl.searchParams.get('type') || 'all'; // 'video' | 'photo' | 'all'
            const categoryId = parsedUrl.searchParams.get('categoryId') || 'all';
            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'userId parametresi gerekli' }));
            }

            const result = db.getUserReceivedMedia 
                ? db.getUserReceivedMedia(userId, type, categoryId) 
                : { total: 0, totalVideos: 0, totalPhotos: 0, items: [] };

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // Geriye dönük uyumluluk
        if (parsedUrl.pathname === '/api/webapp/received-videos' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            const categoryId = parsedUrl.searchParams.get('categoryId') || 'all';
            const result = db.getUserReceivedVideos ? db.getUserReceivedVideos(userId, categoryId) : { total: 0, videos: [] };
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // ==========================================
        // 9. API: VİDEO & FOTOĞRAF İZLEME / STREAMING PROXY (HTTP Range & Redirect Destekli)
        // ==========================================
        if ((parsedUrl.pathname.startsWith('/api/webapp/stream/') || parsedUrl.pathname.startsWith('/api/webapp/photo/')) && (req.method === 'GET' || req.method === 'HEAD')) {
            const mediaId = parsedUrl.pathname.replace('/api/webapp/stream/', '').replace('/api/webapp/photo/', '').split('?')[0];
            const media = db.getMedia(mediaId);

            if (!media) {
                res.writeHead(404, { 
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                return res.end('Medya bulunamadı');
            }

            const isVideo = media.type === 'video';
            const defaultContentType = isVideo ? 'video/mp4' : 'image/jpeg';

            const fileLink = await resolveTelegramFileLink(media.fileId, botInstance);

            if (!fileLink) {
                res.writeHead(502, { 
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                return res.end('Medya kaynağına erişilemedi (Telegram sınırı veya dosya silinmiş)');
            }

            // HTTP Range ve Stream Desteği (Redirect ve CORS tam destekli)
            const https = require('https');
            const targetUrlStr = typeof fileLink === 'object' && fileLink.href ? fileLink.href : String(fileLink);

            function streamFromUrl(urlStr, redirectCount = 0) {
                if (redirectCount > 5) {
                    res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
                    return res.end('Too many redirects');
                }

                try {
                    const urlObj = new URL(urlStr);
                    const reqHeaders = {};
                    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

                    const clientReq = https.get(urlObj, { headers: reqHeaders }, (telegramRes) => {
                        // 301, 302, 307, 308 Redirect Takibi
                        if (telegramRes.statusCode >= 300 && telegramRes.statusCode < 400 && telegramRes.headers.location) {
                            telegramRes.resume();
                            return streamFromUrl(telegramRes.headers.location, redirectCount + 1);
                        }

                        if (telegramRes.statusCode >= 400) {
                            res.writeHead(telegramRes.statusCode, { 
                                'Content-Type': 'text/plain; charset=utf-8',
                                'Access-Control-Allow-Origin': '*' 
                            });
                            return res.end('Telegram stream hatası: ' + telegramRes.statusCode);
                        }

                        const responseHeaders = {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type, Range',
                            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
                            'Content-Type': defaultContentType,
                            'Accept-Ranges': 'bytes',
                            'Cache-Control': 'public, max-age=86400',
                            'Content-Disposition': 'inline'
                        };

                        if (telegramRes.headers['content-length']) {
                            responseHeaders['Content-Length'] = telegramRes.headers['content-length'];
                        }
                        if (telegramRes.headers['content-range']) {
                            responseHeaders['Content-Range'] = telegramRes.headers['content-range'];
                        }

                        res.writeHead(telegramRes.statusCode || 200, responseHeaders);

                        if (req.method === 'HEAD') {
                            telegramRes.destroy();
                            return res.end();
                        }

                        telegramRes.pipe(res);
                    });

                    clientReq.on('error', (err) => {
                        console.error('Medya stream pipe hatası:', err.message);
                        if (!res.headersSent) {
                            res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
                            res.end('Stream hatası: ' + err.message);
                        }
                    });
                } catch (urlErr) {
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
                        res.end('URL parse hatası');
                    }
                }
            }

            streamFromUrl(targetUrlStr, 0);
            return;
        }

        // ==========================================
        // 10. API: MEDYA YÜKLEME (ONAY BEKLEYEN MEDYA)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/upload' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const userId = String(data.userId || '');
                    const { categoryId, mediaType, fileData, fileName } = data;

                    if (!userId || !categoryId || !fileData) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Eksik parametreler (userId, categoryId, fileData gereklidir).' }));
                    }

                    if (db.isUserBanned(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Hesabınız banlanmıştır, yükleme yapamazsınız.' }));
                    }

                    // Base64 verisini çözümle
                    const base64Data = fileData.replace(/^data:.*?;base64,/, '');
                    const buffer = Buffer.from(base64Data, 'base64');
                    const isVideo = mediaType === 'video';
                    const typeLabel = isVideo ? 'Video' : 'Fotoğraf';

                    const cat = db.getCategory(categoryId) || { name: 'Genel', key: 'K' };
                    const user = db.getUser(userId) || { id: userId, first_name: 'Kullanıcı' };
                    const targetAdminId = ADMIN_IDS[0] || '8633136500';

                    // Benzersiz ID üret
                    const tempMediaId = 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

                    let tgRes = null;
                    if (botInstance) {
                        const caption = `🔔 <b>YENİ MEDYA YÜKLEMESİ (ONAY BEKLİYOR)</b>\n\n` +
                            `👤 <b>Yükleyen:</b> ${user.first_name || 'Kullanıcı'} (<code>${userId}</code>)\n` +
                            `📁 <b>Hedef Sekme:</b> [${cat.key}] <b>${cat.name}</b>\n` +
                            `🎬 <b>Tür:</b> ${typeLabel}\n` +
                            `📦 <b>Boyut:</b> ${(buffer.length / (1024 * 1024)).toFixed(2)} MB\n\n` +
                            `⏳ <b>DURUM:</b> Onay Bekliyor (Admin onay verene kadar kullanıcıya kredi verilmez!)`;

                        const keyboard = {
                            inline_keyboard: [
                                [
                                    { text: '✅ Onayla (+1 Kredi Ver)', callback_data: `admin_app_${tempMediaId}` },
                                    { text: '❌ Reddet', callback_data: `admin_rej_${tempMediaId}` }
                                ]
                            ]
                        };

                        try {
                            if (isVideo) {
                                tgRes = await botInstance.telegram.sendVideo(targetAdminId, { source: buffer, filename: fileName || 'video.mp4' }, {
                                    caption,
                                    parse_mode: 'HTML',
                                    reply_markup: keyboard
                                });
                            } else {
                                tgRes = await botInstance.telegram.sendPhoto(targetAdminId, { source: buffer, filename: fileName || 'photo.jpg' }, {
                                    caption,
                                    parse_mode: 'HTML',
                                    reply_markup: keyboard
                                });
                            }
                        } catch (sendErr) {
                            console.error('Admin bildirim hatası:', sendErr.message);
                        }
                    }

                    // Telegram fileId tespit et
                    let fileId = '';
                    let fileUniqueId = '';
                    if (tgRes) {
                        if (isVideo && tgRes.video) {
                            fileId = tgRes.video.file_id;
                            fileUniqueId = tgRes.video.file_unique_id;
                        } else if (!isVideo && tgRes.photo) {
                            const best = tgRes.photo[tgRes.photo.length - 1];
                            fileId = best.file_id;
                            fileUniqueId = best.file_unique_id;
                        }
                    }

                    // Medyayı PENDING olarak kaydet (KREDİ VERİLMEZ!)
                    const dbData = db.loadDb();
                    const newMedia = {
                        id: tempMediaId,
                        type: isVideo ? 'video' : 'photo',
                        fileId: fileId || tempMediaId,
                        fileUniqueId: fileUniqueId || null,
                        fileSize: buffer.length,
                        categoryId: categoryId,
                        uploadedBy: String(userId),
                        status: 'pending', // ⚠️ ONAY BEKLİYOR!
                        reports: 0,
                        reporters: [],
                        createdAt: new Date().toISOString()
                    };
                    dbData.media.push(newMedia);
                    db.saveDb();

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        message: 'Medyanız başarıyla yüklendi ve yönetici onayına iletildi! Admin onayladıktan sonra hesabınıza +1 Kredi tanımlanacaktır.',
                        mediaId: tempMediaId
                    }));

                } catch (e) {
                    console.error('Yükleme hatası:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 10B. API: 2 GB'A KADAR AKIŞLI (STREAMING) YÜKLEME (ZIP, VİDEO, FOTO)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/upload-stream' && req.method === 'POST') {
            const userId = req.headers['x-user-id'] || '';
            const categoryId = req.headers['x-category-id'] || 'cat_1';
            const mediaType = req.headers['x-media-type'] || 'video'; // 'zip' | 'video' | 'photo'
            const rawFileName = req.headers['x-file-name'] || (mediaType === 'zip' ? 'arsiv.zip' : (mediaType === 'video' ? 'video.mp4' : 'photo.jpg'));
            const fileName = decodeURIComponent(rawFileName);

            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'userId header gerekli' }));
            }

            if (db.isUserBanned(userId)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Hesabınız banlanmıştır.' }));
            }

            const tempDir = path.join(__dirname, 'temp_uploads');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const safeBaseName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const tempFilePath = path.join(tempDir, `up_${Date.now()}_${Math.floor(Math.random() * 1000)}_${safeBaseName}`);
            const writeStream = fs.createWriteStream(tempFilePath);

            let totalBytes = 0;
            let limitExceeded = false;
            const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB sınır!

            req.on('data', chunk => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_SIZE && !limitExceeded) {
                    limitExceeded = true;
                    req.destroy();
                    writeStream.destroy();
                    try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Dosya boyutu 2 GB sınırını aşıyor!' }));
                }
            });

            req.pipe(writeStream);

            writeStream.on('finish', async () => {
                if (limitExceeded) return;

                try {
                    const isZip = mediaType === 'zip' || fileName.toLowerCase().endsWith('.zip') || fileName.toLowerCase().endsWith('.rar') || fileName.toLowerCase().endsWith('.7z');
                    const isVideo = mediaType === 'video' || (!isZip && (fileName.toLowerCase().endsWith('.mp4') || fileName.toLowerCase().endsWith('.mov') || fileName.toLowerCase().endsWith('.mkv')));
                    const isPhoto = !isZip && !isVideo;
                    const cat = db.getCategory(categoryId) || { name: 'Genel', key: 'K' };
                    const user = db.getUser(userId) || { id: userId, firstName: 'Kullanıcı' };
                    const targetAdminId = ADMIN_IDS[0] || '8633136500';
                    const tempMediaId = 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                    const sizeMb = (totalBytes / (1024 * 1024)).toFixed(2);

                    let tgRes = null;

                    // 1. ZIP Dosyası İse
                    if (isZip) {
                        if (isAdminUser(userId)) {
                            if (botInstance) {
                                try {
                                    tgRes = await botInstance.telegram.sendDocument(targetAdminId, { source: tempFilePath, filename: fileName }, {
                                        caption: `🗂️ <b>YENİ 2 GB ZIP ARŞİVİ (Mini App'ten Eklendi)</b>\n\n` +
                                            `📦 <b>Dosya:</b> ${fileName}\n` +
                                            `📊 <b>Boyut:</b> ${sizeMb} MB\n` +
                                            `⭐ <b>Fiyat:</b> 100 Yıldız (VIP Hariç)\n\n` +
                                            `✅ <i>Arşiv otomatik olarak 100 Yıldız ile ZIP marketine eklenmiştir.</i>`,
                                        parse_mode: 'HTML'
                                    });
                                } catch (tgErr) {
                                    console.error('Admin ZIP gönderme hatası:', tgErr.message);
                                }
                            }

                            const fileId = tgRes?.document?.file_id || tempMediaId;
                            const addedZip = db.addZip(fileName, 'Özel 2 GB Arşiv Paketi (VIP Dahil Değil - 100 Yıldız)', fileId, totalBytes, userId);

                            try { fs.unlinkSync(tempFilePath); } catch (_) {}

                            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                            return res.end(JSON.stringify({
                                success: true,
                                message: `ZIP arşivi başarıyla yüklendi (${sizeMb} MB) ve 100 Yıldız satış fiyatıyla markete eklendi!`,
                                zip: addedZip
                            }));
                        } else {
                            try { fs.unlinkSync(tempFilePath); } catch (_) {}
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ success: false, message: 'ZIP arşivleri yalnızca yönetici tarafından yüklenebilir.' }));
                        }
                    }

                    // 2. Video veya Fotoğraf İse (Onay Bekleyen Medya)
                    if (botInstance) {
                        const typeLabel = isVideo ? 'Video' : 'Fotoğraf';
                        const caption = `🔔 <b>YENİ 2 GB MEDYA YÜKLEMESİ (ONAY BEKLİYOR)</b>\n\n` +
                            `👤 <b>Yükleyen:</b> ${user.firstName || 'Kullanıcı'} (<code>${userId}</code>)\n` +
                            `📁 <b>Hedef Sekme:</b> [${cat.key}] <b>${cat.name}</b>\n` +
                            `🎬 <b>Tür:</b> ${typeLabel}\n` +
                            `📦 <b>Boyut:</b> ${sizeMb} MB\n\n` +
                            `⏳ <b>DURUM:</b> Onay Bekliyor (Admin onay verene kadar kullanıcıya kredi verilmez!)`;

                        const keyboard = {
                            inline_keyboard: [
                                [
                                    { text: '✅ Onayla (+1 Kredi Ver)', callback_data: `admin_app_${tempMediaId}` },
                                    { text: '❌ Reddet', callback_data: `admin_rej_${tempMediaId}` }
                                ]
                            ]
                        };

                        try {
                            if (isVideo) {
                                tgRes = await botInstance.telegram.sendVideo(targetAdminId, { source: tempFilePath, filename: fileName }, {
                                    caption,
                                    parse_mode: 'HTML',
                                    reply_markup: keyboard
                                });
                            } else {
                                tgRes = await botInstance.telegram.sendPhoto(targetAdminId, { source: tempFilePath, filename: fileName }, {
                                    caption,
                                    parse_mode: 'HTML',
                                    reply_markup: keyboard
                                });
                            }
                        } catch (sendErr) {
                            console.error('Admin medya gönderme hatası:', sendErr.message);
                            if (isVideo) {
                                try {
                                    tgRes = await botInstance.telegram.sendDocument(targetAdminId, { source: tempFilePath, filename: fileName }, {
                                        caption,
                                        parse_mode: 'HTML',
                                        reply_markup: keyboard
                                    });
                                } catch (_) {}
                            }
                        }
                    }

                    let fileId = '';
                    let fileUniqueId = '';
                    if (tgRes) {
                        if (tgRes.video) {
                            fileId = tgRes.video.file_id;
                            fileUniqueId = tgRes.video.file_unique_id;
                        } else if (tgRes.photo) {
                            const best = tgRes.photo[tgRes.photo.length - 1];
                            fileId = best.file_id;
                            fileUniqueId = best.file_unique_id;
                        } else if (tgRes.document) {
                            fileId = tgRes.document.file_id;
                            fileUniqueId = tgRes.document.file_unique_id;
                        }
                    }

                    const dbData = db.loadDb();
                    const newMedia = {
                        id: tempMediaId,
                        type: isVideo ? 'video' : 'photo',
                        fileId: fileId || tempMediaId,
                        fileUniqueId: fileUniqueId || null,
                        fileSize: totalBytes,
                        categoryId: categoryId,
                        uploadedBy: String(userId),
                        status: 'pending',
                        reports: 0,
                        reporters: [],
                        createdAt: new Date().toISOString()
                    };
                    dbData.media.push(newMedia);
                    db.saveDb();

                    try { fs.unlinkSync(tempFilePath); } catch (_) {}

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        message: `Medyanız (${sizeMb} MB) başarıyla yüklendi ve yönetici onayına sunuldu! Admin onaylayınca +1 Krediniz tanımlanacaktır.`,
                        mediaId: tempMediaId
                    }));

                } catch (procErr) {
                    console.error('Streaming upload işleme hatası:', procErr.message);
                    try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: procErr.message }));
                }
            });

            writeStream.on('error', err => {
                console.error('WriteStream hatası:', err.message);
                try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
                if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Dosya yazma hatası' }));
            });

            return;
        }

        // ==========================================
        // 11. API: ZIP ARŞİV LİSTESİ (100 Yıldız - VIP Hariç)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/zips' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            const allZips = db.getAllZips ? db.getAllZips() : [];
            const isAdmin = isAdminUser(userId);
            const userZips = (!isAdmin && userId && db.getUserPurchasedZips) ? db.getUserPurchasedZips(userId) : [];
            const purchasedZipIds = new Set(userZips.map(z => z.id));

            const list = allZips.map(zip => {
                const bytes = zip.fileSize || 0;
                const mb = (bytes / (1024 * 1024)).toFixed(2);
                const formatted = zip.fileSizeFormatted || (bytes >= 1024 * 1024 * 1024 
                    ? (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' 
                    : `${mb} MB`);
                const zipName = zip.name || zip.title || 'Özel ZIP Arşivi';
                return {
                    id: zip.id,
                    name: zipName,
                    title: zipName,
                    description: zip.description || `${zipName} • ${formatted} Özel Arşiv Paketi`,
                    fileSize: bytes,
                    fileSizeFormatted: formatted,
                    priceStars: 100,
                    isPurchased: isAdmin || purchasedZipIds.has(zip.id),
                    createdAt: zip.createdAt,
                    uploadedBy: zip.uploadedBy
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, zips: list }));
        }

        // ==========================================
        // 12. API: ZIP FATURASI OLUŞTURMA (100 Yıldız)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/create-zip-invoice' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, zipId } = data;
                    if (!userId || !zipId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'userId ve zipId gereklidir' }));
                    }

                    // Admin için ödemesiz doğrudan teslimat
                    if (isAdminUser(userId)) {
                        const zip = db.getZip(zipId);
                        if (zip && botInstance && zip.fileId) {
                            try {
                                await botInstance.telegram.sendDocument(userId, zip.fileId, {
                                    caption: `👑 <b>YÖNETİCİ ZIP ARŞİVİ TESLİMATI</b>\n\n🗂️ <b>Arşiv:</b> ${zip.name}\n📦 <b>Boyut:</b> ${zip.fileSizeFormatted || ''}\n✨ <i>Yönetici hesabınızla sınırsız ve ücretsiz teslim edildi.</i>`,
                                    parse_mode: 'HTML'
                                });
                            } catch (e) {
                                console.error('Admin ZIP gönderme hatası:', e.message);
                            }
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({ success: true, invoiceLink: null, alreadyUnlocked: true, message: 'Yönetici olarak arşiv sohbete gönderildi.' }));
                    }

                    const zip = db.getZip(zipId);
                    if (!zip) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'ZIP arşivi bulunamadı' }));
                    }

                    if (!botInstance) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Bot bağlantısı yok' }));
                    }

                    const invoiceLink = await botInstance.telegram.createInvoiceLink({
                        title: `🗂️ ${(zip.name || 'Özel ZIP Paketi').substring(0, 30)}`,
                        description: `100 Yıldız Özel 2 GB Arşiv Paketi (${zip.fileSizeFormatted || ''}). VIP hariç tek tek satılır. Satın alma sonrası anında teslim edilir.`,
                        payload: `zip_buy_${zip.id}`,
                        provider_token: '',
                        currency: 'XTR',
                        prices: [{ label: '100 Yıldız Arşiv Paketi', amount: 100 }]
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, invoiceLink }));
                } catch (e) {
                    console.error('ZIP fatura hatası:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 13. API: KULLANICININ SATIN ALDIĞI ZIPLER
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/user-zips' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            if (!userId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'userId gereklidir' }));
            }
            let zips = [];
            if (isAdminUser(userId)) {
                zips = db.getAllZips ? db.getAllZips() : [];
            } else {
                zips = db.getUserPurchasedZips ? db.getUserPurchasedZips(userId) : [];
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, zips }));
        }

        // ==========================================
        // 14. API: SATIN ALINMIŞ ZIP'İ TELEGRAM'A TEKRAR GÖNDER
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/resend-zip' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, zipId } = data;
                    if (!userId || !zipId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'userId ve zipId gereklidir' }));
                    }

                    const isAdmin = isAdminUser(userId);
                    let purchased = null;
                    if (isAdmin) {
                        purchased = (db.getAllZips ? db.getAllZips() : []).find(z => z.id === zipId);
                    } else {
                        const userZips = db.getUserPurchasedZips(userId);
                        purchased = userZips.find(z => z.id === zipId);
                    }
                    if (!purchased) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Bu arşivi satın almamışsınız.' }));
                    }

                    if (botInstance && purchased.fileId) {
                        await botInstance.telegram.sendDocument(userId, purchased.fileId, {
                            caption: `🗂️ <b>${purchased.name || 'Özel ZIP Arşivi'}</b>\n\n⭐ <i>Arşiv dosyanız Telegram sohbete teslim edildi.</i>`,
                            parse_mode: 'HTML',
                            protect_content: false
                        });
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'ZIP dosyası Telegram sohbetinize gönderildi!' }));
                } catch (e) {
                    console.error('ZIP resend hatası:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14B. API: DOĞRUDAN TELEFONA ZIP İNDİR (TARAYICI İNDİRMESİ)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/download-zip-file' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            const zipId = parsedUrl.searchParams.get('zipId');

            if (!userId || !zipId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'userId ve zipId gereklidir' }));
            }

            const isAdmin = isAdminUser(userId);
            let purchased = null;
            if (isAdmin) {
                purchased = (db.getAllZips ? db.getAllZips() : []).find(z => z.id === zipId);
            } else {
                const userZips = db.getUserPurchasedZips ? db.getUserPurchasedZips(userId) : [];
                purchased = userZips.find(z => z.id === zipId);
            }

            if (!purchased) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Bu ZIP arşivi henüz satın alınmamış veya erişim izniniz yok.');
            }

            try {
                let fileLink = null;
                if (botInstance && purchased.fileId) {
                    fileLink = await botInstance.telegram.getFileLink(purchased.fileId);
                }
                if (!fileLink) {
                    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                    return res.end('Arşiv dosyasına Telegram üzerinden erişilemedi.');
                }

                const https = require('https');
                const safeName = (purchased.name || 'arsiv').replace(/[^a-zA-Z0-9_\-\.]/g, '_');
                res.writeHead(200, {
                    'Content-Type': 'application/zip',
                    'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}.zip"`
                });

                https.get(fileLink.href, (tgStream) => {
                    tgStream.pipe(res);
                }).on('error', (err) => {
                    console.error('ZIP download hatası:', err.message);
                    if (!res.headersSent) res.writeHead(500);
                    res.end();
                });
                return;
            } catch (err) {
                console.error('ZIP doğrudan indirme hatası:', err.message);
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('İndirme sırasında sunucu hatası oluştu: ' + err.message);
            }
        }

        // ==========================================
        // 14C. API: RAPORLANAN İÇERİKLER LİSTESİ (ADMİN İNCELEME)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/reported-media' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            if (!isAdminUser(userId)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim. Tek yönetici: 8633136500' }));
            }

            const list = db.getReportedMediaList ? db.getReportedMediaList() : [];
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, reportedMedia: list }));
        }

        // ==========================================
        // 14D. API: RAPORLANAN MEDYANIN YERİNİ/SEKMESİNİ DEĞİŞTİR
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/change-media-category' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId, targetCategoryId } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const resDb = db.changeMediaCategory(mediaId, targetCategoryId);
                    if (!resDb.success) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify(resDb));
                    }

                    // Admin doğru yere taşıdığı için raporu temizle
                    db.dismissReportsForMedia(mediaId);

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: `Medya başarıyla [${resDb.newCategory.name}] sekmesine aktarıldı!` }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14E. API: RAPORLANAN MEDYAYI TAMAMEN SİL
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/delete-reported-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId, reason } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const m = db.getMedia(mediaId);
                    db.deleteMedia(mediaId);
                    db.dismissReportsForMedia(mediaId);

                    if (botInstance && m?.uploadedBy) {
                        botInstance.telegram.sendMessage(
                            m.uploadedBy,
                            `⚠️ Gönderdiğiniz bir içerik kullanıcı şikayetleri ve yönetici incelemesi sonucunda sistemden kaldırılmıştır.${reason ? `\n\n<b>Sebep:</b> ${reason}` : ''}`,
                            { parse_mode: 'HTML' }
                        ).catch(() => {});
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'Şikayet edilen medya havuzdan tamamen silindi!' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14F. API: RAPORU KAPAT / GÜVENLİ (MEDYAYI KORU)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/dismiss-report' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    db.dismissReportsForMedia(mediaId);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'Rapor kapatıldı ve içerik güvenli olarak işaretlendi.' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14G. API: TÜM YÜKLEMELER & KİM NE YÜKLEDİ LİSTESİ
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/all-uploads' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            if (!isAdminUser(userId)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim.' }));
            }

            const uploads = db.getAllUploadsWithUsers ? db.getAllUploadsWithUsers(150) : [];
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, uploads }));
        }

        // ==========================================
        // 14H. API: KATEGORİ İÇERİK LİSTESİ (TÜM KULLANICILAR İÇİN DOSYA İÇİNDE İZLEME)
        // ==========================================
        if ((parsedUrl.pathname === '/api/webapp/admin/category-media' || parsedUrl.pathname === '/api/webapp/category-media') && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            const categoryId = parsedUrl.searchParams.get('categoryId');
            const typeFilter = parsedUrl.searchParams.get('type') || 'all';
            const isAdmin = isAdminUser(userId);

            const dbData = db.loadDb();
            const cats = db.getCategories();
            const cat = cats.find(c => c.id === categoryId) || { id: categoryId, name: 'Kategori', key: 'K' };

            const allCategoryMedia = (dbData.media || []).filter(m => m.categoryId === categoryId);
            const totalVideos = allCategoryMedia.filter(m => m.type === 'video').length;
            const totalPhotos = allCategoryMedia.filter(m => m.type === 'photo').length;
            const totalAdmin = allCategoryMedia.filter(m => String(m.uploadedBy) === '8633136500').length;

            let filtered = allCategoryMedia;
            if (typeFilter === 'video') {
                filtered = filtered.filter(m => m.type === 'video');
            } else if (typeFilter === 'photo') {
                filtered = filtered.filter(m => m.type === 'photo');
            }

            const uploaderFilter = parsedUrl.searchParams.get('uploader') || 'all';
            if (uploaderFilter === 'admin') {
                filtered = filtered.filter(m => String(m.uploadedBy) === '8633136500');
            } else if (uploaderFilter && uploaderFilter !== 'all') {
                filtered = filtered.filter(m => String(m.uploadedBy) === String(uploaderFilter));
            }

            const sortOrder = parsedUrl.searchParams.get('sort') || 'desc'; // 'desc' | 'asc' | 'size'
            if (sortOrder === 'asc') {
                filtered = filtered.slice().sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
            } else if (sortOrder === 'size') {
                filtered = filtered.slice().sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0));
            } else {
                // desc: en yeni önce
                filtered = filtered.slice().reverse();
            }

            const searchKw = (parsedUrl.searchParams.get('search') || '').toLowerCase().trim();
            if (searchKw) {
                filtered = filtered.filter(m => {
                    const uploader = dbData.users ? dbData.users[String(m.uploadedBy)] : null;
                    const uName = (uploader?.firstName || '').toLowerCase();
                    const uUser = (uploader?.username || '').toLowerCase();
                    const idStr = String(m.id || '').toLowerCase();
                    const idxStr = String(m.orderIndex || '');
                    return idStr.includes(searchKw) || idxStr === searchKw || uName.includes(searchKw) || uUser.includes(searchKw);
                });
            }

            const items = filtered.map((m, idx) => {
                const uploader = dbData.users ? dbData.users[String(m.uploadedBy)] : null;
                const isSuperAdmin = String(m.uploadedBy) === '8633136500';
                return {
                    id: m.id,
                    seqNumber: idx + 1,
                    orderIndex: m.orderIndex || (idx + 1),
                    type: m.type,
                    categoryId: m.categoryId,
                    fileSize: m.fileSize || 0,
                    status: m.status || 'approved',
                    uploadedBy: m.uploadedBy,
                    isAdminUpload: isSuperAdmin,
                    uploaderName: uploader?.firstName ? (isSuperAdmin ? `${uploader.firstName} (Admin)` : uploader.firstName) : (isSuperAdmin ? 'Ömer (Admin)' : 'Kullanıcı'),
                    uploaderUsername: uploader?.username ? `@${uploader.username.replace('@', '')}` : null,
                    reports: m.reports || 0,
                    createdAt: m.createdAt
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
                success: true,
                category: cat,
                categories: cats,
                total: allCategoryMedia.length,
                totalVideos,
                totalPhotos,
                totalAdmin,
                items
            }));
        }

        // ==========================================
        // 14H2. API: KREDİ İLE GEÇİCİ KRALLIK (VIP) SATIN ALMA
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/buy-vip-with-credits' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, plan = '3_days' } = data;

                    if (!userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Kullanıcı ID gerekli.' }));
                    }

                    let days = data.days || 3;
                    let creditCost = data.creditCost || 25;
                    if (plan === '1_day') { days = 1; creditCost = 10; }
                    else if (plan === '3_days') { days = 3; creditCost = 25; }
                    else if (plan === '7_days') { days = 7; creditCost = 50; }

                    const resDb = db.buyVipWithCredits(userId, days, creditCost);
                    res.writeHead(resDb.success ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify(resDb));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14I. API: ADMİN TOPLU MEDYA AKTARMA / TAŞIMA
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/bulk-move-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaIds, targetCategoryId } = data;

                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim.' }));
                    }

                    if (!Array.isArray(mediaIds) || mediaIds.length === 0 || !targetCategoryId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Geçersiz parametreler.' }));
                    }

                    const cats = db.getCategories();
                    const targetCat = cats.find(c => c.id === targetCategoryId);
                    if (!targetCat) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Hedef sekme bulunamadı.' }));
                    }

                    const dbData = db.loadDb();
                    const targetIds = new Set(mediaIds.map(String));
                    let movedCount = 0;

                    for (const m of (dbData.media || [])) {
                        if (targetIds.has(String(m.id))) {
                            m.categoryId = targetCategoryId;
                            movedCount++;
                        }
                    }

                    db.saveDb();

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        message: `${movedCount} adet medya '${targetCat.name}' kategorisine aktarıldı.`,
                        movedCount
                    }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14J. API: ADMİN TOPLU MEDYA SİLME
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/bulk-delete-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaIds } = data;

                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim.' }));
                    }

                    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Geçersiz parametreler.' }));
                    }

                    const dbData = db.loadDb();
                    const targetIds = new Set(mediaIds.map(String));
                    const initialCount = (dbData.media || []).length;

                    dbData.media = (dbData.media || []).filter(m => !targetIds.has(String(m.id)));
                    const deletedCount = initialCount - dbData.media.length;

                    db.saveDb();

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        message: `${deletedCount} adet medya sistemden silindi.`,
                        deletedCount
                    }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14K. API: ADMİN KURTARMA DURUMU & KONTROLÜ
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/recovery-status' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            if (!isAdminUser(userId)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim.' }));
            }

            const state = recovery.getRecoveryState();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, state }));
        }

        // ==========================================
        // 14L. API: ADMİN KURTARMA EYLEMİ (BAŞLAT / DEVAM ET / DURDUR / DÜZELT)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/recovery-action' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, action, targetCatId, limit } = data;

                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim.' }));
                    }

                    if (action === 'stop' || action === 'pause') {
                        recovery.stopRecovery();
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({ success: true, message: 'Kurtarma duraklatıldı.' }));
                    }

                    if (action === 'fix_categories') {
                        const result = recovery.fixAllCategories();
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({ success: true, message: `${result.movedCount} adet medya akıllı olarak uygun kategorilere dağıtıldı.`, ...result }));
                    }

                    const isResume = action === 'resume';
                    const runRes = await recovery.startRecovery({
                        bot: botInstance,
                        adminChatId: userId,
                        limit: limit ? parseInt(limit, 10) : null,
                        targetCatId: targetCatId || null,
                        resume: isResume
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify(runRes));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 14M. API: ADMİN TÜM MEDYALARI GENELE AKTAR (DİĞER SEKMELERİ BOŞALT)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/move-all-to-genel' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, targetCategoryId = 'cat_11' } = data;

                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim.' }));
                    }

                    const resDb = db.moveAllMediaToCategory(targetCategoryId);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        message: `Tüm ${resDb.count} adet medya başarıyla '${resDb.targetCategory.name}' sekmesine aktarıldı, diğer tüm sekmeler boşaltıldı!`,
                        count: resDb.count,
                        targetCategory: resDb.targetCategory
                    }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 15. API: TEK YÖNETİCİ ADMIN DASHBOARD (8633136500)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/dashboard' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            if (!isAdminUser(userId)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim. Tek yönetici: 8633136500' }));
            }

            const stats = db.getAdminStats ? db.getAdminStats() : {};
            const pendingMedia = db.getPendingMedia ? db.getPendingMedia() : [];
            const zips = db.getAllZips ? db.getAllZips() : [];

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
                success: true,
                stats,
                pendingMedia,
                zips
            }));
        }

        // ==========================================
        // 16. API: ADMİN MEDYA ONAYLAMA
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/approve-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const resDb = db.approveMedia(mediaId);
                    if (!resDb.success) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify(resDb));
                    }

                    // Kullanıcıya bildirim gönder
                    if (botInstance && resDb.media?.uploadedBy) {
                        const typeLabel = resDb.media.type === 'photo' ? 'Resim' : 'Video';
                        const newCredit = resDb.media.type === 'photo' ? resDb.user.photoCredits : resDb.user.videoCredits;
                        botInstance.telegram.sendMessage(
                            resDb.media.uploadedBy,
                            `🎉 <b>Tebrikler!</b> Gönderdiğiniz ${typeLabel.toLowerCase()} yönetici tarafından onaylandı ve takas havuzuna eklendi!\n\n💰 Hesabınıza <b>+1 ${typeLabel} Kredisi</b> yüklendi. (Mevcut: <code>${newCredit}</code>)`,
                            { parse_mode: 'HTML' }
                        ).catch(() => {});
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'Medya onaylandı ve kullanıcıya +1 kredi yüklendi!' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 17. API: ADMİN MEDYA REDDETME
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/reject-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId, reason } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const resDb = db.rejectMedia(mediaId);
                    if (!resDb.success) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify(resDb));
                    }

                    if (botInstance && resDb.media?.uploadedBy) {
                        botInstance.telegram.sendMessage(
                            resDb.media.uploadedBy,
                            `❌ Gönderdiğiniz medya yönetici incelemesinden geçemedi ve reddedildi.${reason ? `\n\n<b>Sebep:</b> ${reason}` : ''}`,
                            { parse_mode: 'HTML' }
                        ).catch(() => {});
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'Medya reddedildi.' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 18. API: ADMİN ZIP SİLME
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/delete-zip' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, zipId } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const resDb = db.deleteZip(zipId);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify(resDb));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 19. API: ADMİN KULLANICI KREDİSİ DÜZENLEME
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/set-credits' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, targetUserId, photoCredits, videoCredits } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const resDb = db.setUserCredits(targetUserId, photoCredits, videoCredits);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify(resDb));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 20. API: ADMİN TOPLU DUYURU (BROADCAST)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/broadcast' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, message } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }
                    if (!message || !message.trim()) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Duyuru metni boş olamaz.' }));
                    }

                    const dbData = db.loadDb();
                    const userIds = Object.keys(dbData.users || {});
                    let sentCount = 0;

                    for (const uid of userIds) {
                        try {
                            if (botInstance) {
                                await botInstance.telegram.sendMessage(uid, `📢 <b>SİSTEM DUYURUSU</b>\n\n${message}`, { parse_mode: 'HTML' });
                                sentCount++;
                            }
                        } catch (_) {}
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: `Duyuru ${sentCount} kullanıcıya başarıyla iletildi.` }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 21. API: ADMİN KATILAN KİŞİLER LİSTESİ
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/users' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            if (!isAdminUser(userId)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim. Sadece admin.' }));
            }

            const users = db.getAllUsersDetailed ? db.getAllUsersDetailed() : [];
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, users }));
        }

        // ==========================================
        // 22. API: ADMİN KULLANICI BANLA / BAN KALDIR
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/toggle-ban' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, targetUserId, reason } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const isBanned = db.isUserBanned(targetUserId);
                    if (isBanned) {
                        db.unbanUser(targetUserId);
                        if (botInstance) {
                            botInstance.telegram.sendMessage(targetUserId, '✅ <b>Hesap Engeliniz Kaldırıldı!</b>\nYönetici tarafından hesabınızın erişim engeli kaldırılmıştır.', { parse_mode: 'HTML' }).catch(() => {});
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({ success: true, isBanned: false, message: 'Kullanıcının banı kaldırıldı.' }));
                    } else {
                        db.banUser(targetUserId, reason || 'Yönetici tarafından engellendi');
                        if (botInstance) {
                            botInstance.telegram.sendMessage(targetUserId, `🚫 <b>Hesabınız Engellendi!</b>\nSebep: ${reason || 'Yönetici kararı'}`, { parse_mode: 'HTML' }).catch(() => {});
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({ success: true, isBanned: true, message: 'Kullanıcı başarıyla banlandı.' }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 23. API: ADMİN HIZLI KREDİ & VIP TANIMLAMA
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/quick-grant' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, targetUserId, type, amount } = data;
                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz işlem.' }));
                    }

                    const count = parseInt(amount, 10) || 5;
                    let msg = '';
                    if (type === 'video') {
                        db.updateCredits(targetUserId, 'video', count);
                        msg = `+${count} Video Kredisi eklendi.`;
                    } else if (type === 'photo') {
                        db.updateCredits(targetUserId, 'photo', count);
                        msg = `+${count} Fotoğraf Kredisi eklendi.`;
                    } else if (type === 'wheel') {
                        db.addWheelSpins(targetUserId, count);
                        msg = `+${count} Şans Çarkı Hakkı eklendi.`;
                    } else if (type === 'vip') {
                        db.addVipDays(targetUserId, 30);
                        msg = '30 Günlük VIP Üyelik tanımlandı.';
                    }

                    if (botInstance) {
                        botInstance.telegram.sendMessage(targetUserId, `🎁 <b>YÖNETİCİDEN HEDİYE!</b>\n\nYönetici hesabınıza <b>${msg}</b> tanımladı. Keyifli kullanımlar!`, { parse_mode: 'HTML' }).catch(() => {});
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: msg }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 24. API: MEDYA RAPOR ET / ŞİKAYET ET
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/report-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId, reason } = data;

                    if (!userId || !mediaId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'userId ve mediaId gereklidir' }));
                    }

                    const rep = db.reportMediaWithReason(mediaId, userId, reason || 'Genel Şikayet');
                    const media = db.getMedia(mediaId);

                    // Yöneticiye Telegram'dan anında şikayet alarmı gönder
                    if (botInstance) {
                        const targetAdminId = ADMIN_IDS[0] || '8633136500';
                        const typeLabel = media?.type === 'video' ? 'Video' : 'Fotoğraf';
                        botInstance.telegram.sendMessage(
                            targetAdminId,
                            `🚩 <b>YENİ İÇERİK ŞİKAYETİ / RAPOR</b>\n\n` +
                            `👤 <b>Şikayet Eden ID:</b> <code>${userId}</code>\n` +
                            `📂 <b>Medya ID:</b> <code>${mediaId}</code> (${typeLabel})\n` +
                            `⚠️ <b>Şikayet Sebebi:</b> <i>${reason || 'Belirtilmedi'}</i>\n` +
                            `📊 <b>Toplam Şikayet:</b> ${media?.reports || 1}\n\n` +
                            `<i>Gerekiyorsa admin panelinden medyayı kaldırabilir veya inceleyebilirsiniz.</i>`,
                            { parse_mode: 'HTML' }
                        ).catch(() => {});
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'Raporunuz yöneticiye iletildi. İnceleme yapılacaktır.' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 25. API: TELEFONA KAYDET / İNDİR FATURASI (Video: 25⭐ | Foto: 10⭐)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/create-download-invoice' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId } = data;

                    if (!userId || !mediaId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'userId ve mediaId gereklidir' }));
                    }

                    const media = db.getMedia(mediaId);
                    if (!media) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Medya bulunamadı' }));
                    }

                    const isVideo = media.type === 'video';
                    const typeLabel = isVideo ? 'Video' : 'Fotoğraf';
                    const priceStars = isVideo ? 25 : 10; // Video: 25 Yıldız, Fotoğraf: 10 Yıldız

                    // Yönetici veya daha önce indirme kilidini açmış kullanıcı için doğrudan ücretsiz indirme
                    const isUnlocked = db.isMediaDownloadUnlocked(userId, mediaId);
                    if (isAdminUser(userId) || isUnlocked) {
                        if (media.fileId) {
                            try {
                                const caption = `📥 <b>TELEFONA KAYDEDİLEBİLİR ${typeLabel.toUpperCase()}</b>\n\n✨ <i>Korumasız olarak gönderildi. Cihazınıza veya galerinize doğrudan kaydedebilirsiniz!</i>`;
                                await sendTelegramMediaUniversal(botInstance, userId, media, { caption, parse_mode: 'HTML', protect_content: false });
                            } catch (e) {
                                console.error('Medya teslim hatası:', e.message);
                            }
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({ success: true, alreadyUnlocked: true, message: `${typeLabel} Telegram sohbetinize korumasız olarak gönderildi!` }));
                    }

                    if (!botInstance) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Bot bağlantısı yok' }));
                    }

                    const title = `📥 ${typeLabel} Telefona Kaydet / İndir`;
                    const description = `${typeLabel} içeriğini korumasız olarak telefonunuza kaydetmek ve galerinize aktarmak için tek seferlik indirme kilidi.`;
                    const payload = `dl_media_${media.id}_${userId}_${Date.now()}`;
                    const prices = [{ label: `${typeLabel} İndirme & Kaydetme`, amount: priceStars }];

                    const invoiceLink = await botInstance.telegram.createInvoiceLink({
                        title,
                        description,
                        payload,
                        provider_token: '',
                        currency: 'XTR',
                        prices
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, invoiceLink, priceStars, alreadyUnlocked: false }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 26. API: KORUMASIZ MEDYAYI TELEGRAM'A GÖNDER (İndir / Kaydet)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/download-media' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId } = data;

                    if (!userId || !mediaId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'userId ve mediaId gereklidir' }));
                    }

                    const isUnlocked = db.isMediaDownloadUnlocked(userId, mediaId);
                    if (!isAdminUser(userId) && !isUnlocked) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Bu medyayı indirmek için önce indirme kilidini açmalısınız.' }));
                    }

                    const media = db.getMedia(mediaId);
                    if (!media) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Medya bulunamadı' }));
                    }

                    const isVideo = media.type === 'video';
                    const typeLabel = isVideo ? 'Video' : 'Fotoğraf';
                    const caption = `📥 <b>TELEFONA KAYDEDİLEBİLİR ${typeLabel.toUpperCase()}</b>\n\n✨ <i>Korumasız olarak gönderildi. Telefonunuzun galerisine veya dosyalarınıza kaydedebilirsiniz.</i>`;

                    await sendTelegramMediaUniversal(botInstance, userId, media, { caption, parse_mode: 'HTML', protect_content: false });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, message: 'İçerik Telegram sohbete korumasız teslim edildi.' }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 27. API: YILDIZ HEDİYE ET / BAHŞİŞ FATURASI
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/create-tip-invoice' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, mediaId, stars } = data;

                    if (!userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'userId gereklidir' }));
                    }

                    const starAmount = parseInt(stars, 10) || 5;

                    if (!botInstance) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Bot bağlantısı yok' }));
                    }

                    const title = `⭐ ${starAmount} Yıldız Hediye / Destek`;
                    const description = `İçeriğe ve bota ${starAmount} Telegram Yıldızı hediye ederek destek oluyorsunuz.`;
                    const payload = `tip_gift_${mediaId || 'bot'}_${starAmount}_${userId}_${Date.now()}`;
                    const prices = [{ label: 'Yıldız Hediyesi', amount: starAmount }];

                    const invoiceLink = await botInstance.telegram.createInvoiceLink({
                        title,
                        description,
                        payload,
                        provider_token: '',
                        currency: 'XTR',
                        prices
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, invoiceLink }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 27. 🤖 NOVA AI: AKILLI HATA TEŞHİS, KENDİ KENDİNİ ONARMA VE ADMİN BİLDİRİM MOTORU
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/ai-assistant' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId, action = 'diagnose', message = '', issueCategory = 'Genel' } = data;

                    if (!userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'userId parametresi zorunludur.' }));
                    }

                    const uid = String(userId);
                    const dbData = db.loadDb();
                    const user = dbData.users ? dbData.users[uid] : null;
                    const userName = user?.firstName || 'Kullanıcı';
                    const userUsername = user?.username || '';

                    // 1. OTOMATİK TEŞHİS VE KENDİ KENDİNİ ONARMA (DIAGNOSE)
                    if (action === 'diagnose') {
                        const healResult = db.autoHealUser ? db.autoHealUser(uid) : { healthy: true, fixes: [], fixedCount: 0 };
                        
                        let aiSummary = '';
                        if (healResult.fixedCount > 0) {
                            aiSummary = `⚡ <b>Teşhis Başarılı!</b> Sisteminizde ${healResult.fixedCount} adet tutarsızlık tespit edildi ve otonom olarak düzeltildi:\n• ` + healResult.fixes.join('\n• ');
                        } else {
                            aiSummary = `🟢 <b>Sistem Mükemmel!</b> Hesap verileriniz, kredileriniz ve medya senkronizasyonunuz tamamen sağlıklı çalışıyor.`;
                        }

                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({
                            success: true,
                            action: 'diagnose',
                            healed: healResult.fixedCount > 0,
                            fixedCount: healResult.fixedCount,
                            fixes: healResult.fixes,
                            aiMessage: aiSummary,
                            user: healResult.user || user
                        }));
                    }

                    // 2. YÖNETİCİYE DOĞRUDAN ESKALASYON / BİLDİRİM GÖNDERME (ESCALATE)
                    if (action === 'escalate') {
                        const healResult = db.autoHealUser ? db.autoHealUser(uid) : { healthy: true, fixes: [] };
                        const targetAdminId = ADMIN_IDS[0] || '8633136500';

                        if (botInstance) {
                            const adminAlertText = 
                                `🤖 <b>NOVA AI • HATA / DESTEK BİLDİRİMİ</b>\n` +
                                `━━━━━━━━━━━━━━━━━━━━\n` +
                                `👤 <b>Kullanıcı:</b> ${userName} ${userUsername ? '(@' + userUsername.replace('@', '') + ')' : ''}\n` +
                                `🆔 <b>Telegram ID:</b> <code>${uid}</code>\n` +
                                `🚨 <b>Kategori:</b> <code>${issueCategory}</code>\n\n` +
                                `📝 <b>Kullanıcı Şikayeti:</b>\n` +
                                `<i>"${message.trim() || 'Açıklama belirtilmedi'}"</i>\n\n` +
                                `🔍 <b>AI Canlı Teşhis Raporu:</b>\n` +
                                `• 🎬 Video Kredisi: <b>${user?.videoCredits ?? 0}</b> | 📷 Foto Kredisi: <b>${user?.photoCredits ?? 0}</b>\n` +
                                `• 👑 Krallık (VIP): <b>${user?.vipUntil && user.vipUntil > Date.now() ? 'Aktif' : 'Standart'}</b>\n` +
                                `• 🛠️ Otonom Onarım: ${healResult.fixes.length > 0 ? healResult.fixes.join(', ') : 'Denedi, manuel admin müdahalesi gerekebilir'}\n` +
                                `• ⏰ Zaman: <code>${new Date().toLocaleString('tr-TR')}</code>\n` +
                                `━━━━━━━━━━━━━━━━━━━━`;

                            botInstance.telegram.sendMessage(targetAdminId, adminAlertText, {
                                parse_mode: 'HTML',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: `💬 Kullanıcıya Telegram'dan Yaz`, url: `tg://user?id=${uid}` }],
                                        [{ text: `👑 Admin Panelini Aç`, callback_data: `admin_open_panel` }]
                                    ]
                                }
                            }).catch(err => {
                                console.error('Admin AI bildirim gönderim hatası:', err.message);
                            });
                        }

                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        return res.end(JSON.stringify({
                            success: true,
                            action: 'escalate',
                            escalated: true,
                            message: `🚨 Talebiniz ve teşhis raporu doğrudan Admin'e (Ömer) iletildi! Telegram üzerinden incelenip en kısa sürede çözülecektir.`
                        }));
                    }

                    // 3. AKILLI ETKİLEŞİMLİ SOHBET & OTOMATİK CEVAP (CHAT)
                    const lowerMsg = (message || '').toLowerCase();
                    let responseMsg = '';
                    let suggestedAction = null;
                    let shouldAutoHeal = false;

                    if (lowerMsg.includes('açılmıyor') || lowerMsg.includes('oynamıyor') || lowerMsg.includes('video') || lowerMsg.includes('fotoğraf') || lowerMsg.includes('siyah') || lowerMsg.includes('yüklenmiyor')) {
                        shouldAutoHeal = true;
                        responseMsg = `🎬 <b>Medya Oynatma Rehberi & Kontrol:</b>\nMedya sunucumuz HTTP Range akışıyla çalışmaktadır. İnternet hızınız düşükse video ilk birkaç saniye ara belleğe alınabilir. Arka planda medya indeksleriniz doğrulandı. Uygulamayı bir kez aşağı çekerek yenilemeyi veya tarayıcı önbelleğinizi temizlemeyi deneyin. Sorun devam ederse lütfen aşağıdaki <b>'🚨 Yetkiliye Bildir'</b> butonuna basarak doğrudan admine iletmemi sağlayın.`;
                        suggestedAction = 'verify_stream';
                    } else if (lowerMsg.includes('kredi') || lowerMsg.includes('bakiye') || lowerMsg.includes('gelmedi') || lowerMsg.includes('eksik') || lowerMsg.includes('yansı')) {
                        shouldAutoHeal = true;
                        responseMsg = `💎 <b>Kredi Bakiye Analizi:</b>\nSistemimiz '2 Yükle 1 Al' kuralıyla çalışır ve yüklediğiniz medyalar yöneticimiz tarafından onaylandığı anda otomatik tanımlanır. Hesabınız taranıp eksik kalan veya takılan haklarınız varsa hemen onarıldı.`;
                        suggestedAction = 'check_credits';
                    } else if (lowerMsg.includes('krallık') || lowerMsg.includes('vip') || lowerMsg.includes('yıldız') || lowerMsg.includes('paket')) {
                        responseMsg = `👑 <b>Geçici Krallık (VIP) Bilgisi:</b>\nKrallık üyeliği tüm sekmelerden kredisiz sınırsız izleme & çekme, ücretsiz doğrudan indirme ve +1 ile +5 arası Şans Çarkı Hediyesi kazandırır. Dilerseniz biriktirdiğiniz <b>Video/Foto kredilerinizle</b> (10, 25 veya 50 Kredi) dilerseniz <b>Telegram Yıldızları</b> ile anında başlatabilirsiniz!`;
                        suggestedAction = 'view_kingdom';
                    } else if (lowerMsg.includes('yetkili') || lowerMsg.includes('admin') || lowerMsg.includes('şikayet') || lowerMsg.includes('dolandır') || lowerMsg.includes('destek') || lowerMsg.includes('ömer')) {
                        responseMsg = `👨‍💼 <b>Yetkili Desteği Talebi:</b>\nTalebinizi ve sistem teşhis raporunuzu tek dokunuşla kurucumuz ve yöneticimiz Ömer'e iletebilirim. İletmemi ister misiniz?`;
                        suggestedAction = 'escalate_ready';
                    } else {
                        responseMsg = `🤖 <b>NOVA AI Çözüm Merkezi:</b>\nSorunuzu aldım. Hesabınızı ve sistem durumunu analiz ettim. Medya oynatma, kredi bakiyesi, indirme veya üyelik konularında anında işlem yapabilir veya doğrudan yöneticiye rapor gönderebilirim. Lütfen aşağıdaki hızlı butonlardan birini seçin:`;
                        suggestedAction = 'general_menu';
                    }

                    let healResult = null;
                    if (shouldAutoHeal) {
                        healResult = db.autoHealUser ? db.autoHealUser(uid) : null;
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({
                        success: true,
                        action: 'chat',
                        reply: responseMsg,
                        suggestedAction: suggestedAction,
                        healResult: healResult
                    }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 28. 🤖 NOVA AI: SİSTEMSEL GENEL BAKIM VE ONARIM (ADMIN ÖZEL)
        // ==========================================
        if (parsedUrl.pathname === '/api/webapp/admin/system-auto-heal' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body || '{}');
                    const { userId } = data;

                    if (!isAdminUser(userId)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Yetkisiz erişim. Tek yönetici: 8633136500' }));
                    }

                    const result = db.autoHealSystem ? db.autoHealSystem() : { healthy: true, fixes: [] };
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, result }));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: e.message }));
                }
            });
            return;
        }

        // ==========================================
        // 21. STATİK DOSYALAR (Mini App HTML/CSS/JS)
        // ==========================================
        let filePath = path.join(PUBLIC_DIR, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);

        // Güvenlik kontrolü (Path traversal engelleme)
        if (!filePath.startsWith(PUBLIC_DIR)) {
            res.writeHead(403);
            return res.end('Yasak');
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml'
            };
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            return fs.createReadStream(filePath).pipe(res);
        }

        // Bulunamazsa ana sayfaya yönlendir (SPA fallback)
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return fs.createReadStream(indexPath).pipe(res);
        }

        res.writeHead(404);
        res.end('Bulunamadı');
    });

    return server;
}

module.exports = { createWebAppServer, MARKET_PACKAGES, STAR_CATEGORIES };
