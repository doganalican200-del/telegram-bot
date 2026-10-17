const fs = require('fs');
const path = require('path');

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || (fs.existsSync('/data') ? '/data' : __dirname);
const DB_FILE = path.join(DB_DIR, 'database.json');

if (DB_DIR !== __dirname && !fs.existsSync(DB_FILE) && fs.existsSync(path.join(__dirname, 'database.json'))) {
    try {
        fs.copyFileSync(path.join(__dirname, 'database.json'), DB_FILE);
        console.log('✅ database.json kalıcı diske aktarıldı:', DB_FILE);
    } catch (e) {
        console.error('Kalıcı diske kopyalama hatası:', e.message);
    }
}

const SUPER_ADMIN_ID = '8633136500';
const ADMIN_IDS = [SUPER_ADMIN_ID];

function isSuperAdmin(userId) {
    if (!userId) return false;
    return String(userId) === SUPER_ADMIN_ID;
}

function isAssistantAdmin(userId) {
    if (!userId) return false;
    const db = loadDb();
    if (!Array.isArray(db.assistantAdmins)) return false;
    const uid = String(userId);
    return db.assistantAdmins.some(a => String(a.userId) === uid);
}

function isAdminOrAssistant(userId) {
    return isSuperAdmin(userId) || isAssistantAdmin(userId);
}

function isAdminUser(userId) {
    if (!userId) return false;
    return isAdminOrAssistant(userId);
}

const defaultCategories = [
    { id: 'cat_1', key: 'A', name: 'Ensest' },
    { id: 'cat_2', key: 'B', name: 'Gay' },
    { id: 'cat_3', key: 'C', name: 'İfsa' },
    { id: 'cat_4', key: 'D', name: 'Cucklod' },
    { id: 'cat_5', key: 'E', name: 'Onlyfans' },
    { id: 'cat_6', key: 'F', name: 'Tribute/cumtribute' },
    { id: 'cat_7', key: 'G', name: 'Ünlü' },
    { id: 'cat_8', key: 'H', name: 'GİZLİ ÇEKİM IPCAM' },
    { id: 'cat_9', key: 'I', name: 'Sosyal medya' },
    { id: 'cat_10', key: 'J', name: 'Porno' },
    { id: 'cat_11', key: 'K', name: 'Genel' }
];

const defaultData = {
    users: {},
    media: [],
    zips: [],
    assistantAdmins: [],
    categories: defaultCategories,
    settings: {
        starterPhotoCredits: 1,  // Yeni başlayan kullanıcıya hediye Resim Kredisi
        starterVideoCredits: 1,  // Yeni başlayan kullanıcıya hediye Video Kredisi
        refBonusPhotoCredits: 2, // Davet eden kişiye Resim Kredisi (+2)
        refBonusVideoCredits: 2, // Davet eden kişiye Video Kredisi (+2)
        minReportsToBan: 3       // 3 şikayet alan medyayı otomatik kaldır
    }
};

let dbCache = null;

function loadDb() {
    if (dbCache) return dbCache;
    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf-8');
            dbCache = JSON.parse(raw);
            // Geriye dönük uyumluluk migrasyonu
            if (!dbCache.settings) {
                dbCache.settings = JSON.parse(JSON.stringify(defaultData.settings));
            }
            dbCache.settings.refBonusPhotoCredits = 2;
            dbCache.settings.refBonusVideoCredits = 2;
            dbCache.settings.hourlyPromoEnabled = false;

            for (const uid in dbCache.users) {
                const u = dbCache.users[uid];
                if (u.photoCredits === undefined || u.photoCredits === null) {
                    u.photoCredits = (u.uploadedPhotos && u.uploadedPhotos > 0) ? u.uploadedPhotos : (u.credits !== undefined ? u.credits : 5);
                    delete u.credits;
                }
                if (u.videoCredits === undefined || u.videoCredits === null) {
                    u.videoCredits = (u.uploadedVideos && u.uploadedVideos > 0) ? u.uploadedVideos : (u.credits !== undefined ? u.credits : 5);
                    delete u.credits;
                }
                if (u.vipUntil === undefined) {
                    u.vipUntil = null;
                }
                if (u.uploadedPhotos === undefined) u.uploadedPhotos = u.uploadedCount || 0;
                if (u.uploadedVideos === undefined) u.uploadedVideos = u.uploadedCount || 0;
                if (u.receivedPhotos === undefined) u.receivedPhotos = u.receivedCount || 0;
                if (u.receivedVideos === undefined) u.receivedVideos = u.receivedCount || 0;
                if (u.isBanned === undefined) u.isBanned = false;
                if (u.bannedReason === undefined) u.bannedReason = null;
                if (u.warnings === undefined) u.warnings = 0;
                if (u.activeUploadCategory === undefined) u.activeUploadCategory = null;
                if (u.wheelSpins === undefined) u.wheelSpins = 0;
                if (u.photoProgress === undefined || typeof u.photoProgress !== 'number' || isNaN(u.photoProgress) || u.photoProgress < 0 || u.photoProgress >= 2) {
                    u.photoProgress = Math.max(0, parseInt(u.photoProgress, 10) || 0) % 2;
                }
                if (u.videoProgress === undefined || typeof u.videoProgress !== 'number' || isNaN(u.videoProgress) || u.videoProgress < 0 || u.videoProgress >= 2) {
                    u.videoProgress = Math.max(0, parseInt(u.videoProgress, 10) || 0) % 2;
                }
            }

            // Kategori kontrolü ve migrasyonu
            if (!dbCache.categories || !Array.isArray(dbCache.categories) || dbCache.categories.length === 0) {
                dbCache.categories = JSON.parse(JSON.stringify(defaultCategories));
            }

            // Genel sekmesi (cat_11) yoksa ekle
            if (!dbCache.categories.some(c => c.id === 'cat_11')) {
                dbCache.categories.push({ id: 'cat_11', key: 'K', name: '📥 Genel' });
            }

            if (Array.isArray(dbCache.media)) {
                for (const m of dbCache.media) {
                    if (!m.categoryId) m.categoryId = 'cat_1';
                }
            }

            if (!Array.isArray(dbCache.processedTransactions)) {
                dbCache.processedTransactions = [];
            }

            if (!Array.isArray(dbCache.zips)) {
                dbCache.zips = [];
            }

            if (!Array.isArray(dbCache.assistantAdmins)) {
                dbCache.assistantAdmins = [];
            }
        } else {
            dbCache = JSON.parse(JSON.stringify(defaultData));
            dbCache.processedTransactions = [];
            saveDb();
        }
    } catch (err) {
        console.error('Veritabanı okuma hatası:', err);
        dbCache = JSON.parse(JSON.stringify(defaultData));
    }
    return dbCache;
}

let isSaving = false;
let pendingSave = false;
let saveDebounceTimer = null;

let categoryStatsCache = null;
let categoryStatsCacheTime = 0;
let adminStatsCache = null;
let adminStatsCacheTime = 0;
let duplicateStatsCache = null;
let duplicateStatsCacheTime = 0;

function invalidateMediaCaches() {
    categoryStatsCache = null;
    adminStatsCache = null;
    duplicateStatsCache = null;
}

function flushSaveSync() {
    if (!dbCache) return;
    if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
    }
    try {
        const tmpFile = DB_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(dbCache), 'utf-8');
        fs.copyFileSync(tmpFile, DB_FILE);
        try { fs.unlinkSync(tmpFile); } catch (_) {}
    } catch (err) {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(dbCache), 'utf-8');
        } catch (e2) {
            console.error('Kritik save hatası:', e2);
        }
    }
}

function triggerAsyncSave() {
    if (isSaving) {
        pendingSave = true;
        return;
    }
    isSaving = true;
    pendingSave = false;

    let payload;
    try {
        payload = JSON.stringify(dbCache);
    } catch (e) {
        console.error('JSON stringify hatası:', e);
        isSaving = false;
        return;
    }

    const tmpFile = DB_FILE + '.tmp';
    fs.writeFile(tmpFile, payload, 'utf-8', (err) => {
        if (err) {
            console.error('Asenkron dosya yazma hatası:', err);
            isSaving = false;
            if (pendingSave) triggerAsyncSave();
            return;
        }
        fs.copyFile(tmpFile, DB_FILE, (copyErr) => {
            try { fs.unlink(tmpFile, () => {}); } catch (_) {}
            isSaving = false;
            if (copyErr) {
                console.error('Dosya kopyalama hatası:', copyErr);
            }
            if (pendingSave) {
                triggerAsyncSave();
            }
        });
    });
}

function saveDb(immediate = false) {
    if (!dbCache) return;
    if (immediate) {
        flushSaveSync();
        return;
    }
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        saveDebounceTimer = null;
        triggerAsyncSave();
    }, 250);
}

function debouncedSaveDb(delay = 250) {
    saveDb(false);
}

try {
    process.once('beforeExit', () => flushSaveSync());
    process.once('SIGINT', () => { flushSaveSync(); process.exit(0); });
    process.once('SIGTERM', () => { flushSaveSync(); process.exit(0); });
} catch (_) {}

// Kullanıcıyı getir veya oluştur
function getOrCreateUser(fromUser, refId = null) {
    const db = loadDb();
    const userId = String(fromUser.id);

    if (!db.users[userId]) {
        let photoCredits = db.settings.starterPhotoCredits;
        let videoCredits = db.settings.starterVideoCredits;
        let validRef = null;

        if (refId && String(refId) !== userId && db.users[String(refId)]) {
            validRef = String(refId);
            db.users[validRef].photoCredits += db.settings.refBonusPhotoCredits;
            db.users[validRef].videoCredits += db.settings.refBonusVideoCredits;
        }

        db.users[userId] = {
            id: userId,
            username: fromUser.username || null,
            firstName: fromUser.first_name || '',
            photoCredits: photoCredits,
            videoCredits: videoCredits,
            vipUntil: null,
            uploadedPhotos: 0,
            uploadedVideos: 0,
            photoProgress: 0,
            videoProgress: 0,
            wheelSpins: 0,
            receivedPhotos: 0,
            receivedVideos: 0,
            seenMedia: [],
            refBy: validRef,
            isBanned: false,
            bannedReason: null,
            bannedAt: null,
            warnings: 0,
            createdAt: new Date().toISOString()
        };
        saveDb();
        return { user: db.users[userId], isNew: true, refGivenTo: validRef };
    }

    db.users[userId].username = fromUser.username || null;
    db.users[userId].firstName = fromUser.first_name || '';
    saveDb();

    return { user: db.users[userId], isNew: false, refGivenTo: null };
}

function getUser(userId) {
    const db = loadDb();
    return db.users[String(userId)] || null;
}

// VIP Kontrolü (Yönetici Her Zaman Sınırsız VIP'dir)
function isUserVip(userId) {
    if (isAdminUser(userId)) {
        return { isVip: true, isUnlimited: true, remainingHours: 999999, until: 'Sınırsız (Admin/Yönetici)', untilTimestamp: null };
    }
    const db = loadDb();
    const user = db.users[String(userId)];
    if (!user || !user.vipUntil) return { isVip: false, isUnlimited: false, remainingHours: 0, untilTimestamp: null };
    
    const vipTime = typeof user.vipUntil === 'string' ? new Date(user.vipUntil).getTime() : Number(user.vipUntil);
    const now = Date.now();
    if (vipTime > now) {
        const remainingHours = Math.ceil((vipTime - now) / (1000 * 60 * 60));
        return { 
            isVip: true, 
            isUnlimited: false, 
            remainingHours, 
            until: new Date(vipTime).toLocaleString('tr-TR'),
            untilTimestamp: vipTime 
        };
    }
    return { isVip: false, isUnlimited: false, remainingHours: 0, untilTimestamp: null };
}

// VIP Üyeliği Sonlandır / Bitir
function cancelUserVip(userId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return { success: false, message: 'Kullanıcı bulunamadı.' };
    user.vipUntil = null;
    saveDb();
    return { success: true, message: 'VIP üyeliğiniz başarıyla sonlandırıldı.' };
}

// VIP Üyeliği Ekstra Saat Uzat (+1 Saat)
function extendUserVipHour(userId, hours = 1) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return { success: false, message: 'Kullanıcı bulunamadı.' };
    
    const now = Date.now();
    const currentVip = user.vipUntil ? (typeof user.vipUntil === 'string' ? new Date(user.vipUntil).getTime() : Number(user.vipUntil)) : now;
    const base = currentVip > now ? currentVip : now;
    const durationMs = hours * 60 * 60 * 1000;
    const newVipTime = base + durationMs;
    
    user.vipUntil = new Date(newVipTime).toISOString();
    saveDb();
    return {
        success: true,
        message: `VIP üyeliğiniz başarıyla +${hours} saat uzatıldı!`,
        vipUntil: new Date(newVipTime).toLocaleString('tr-TR'),
        vipUntilTimestamp: newVipTime
    };
}

// ==========================================
// 👑 YÖNETİCİ VIP UZATMA / KISALTMA / YÖNETİM FONKSİYONLARI
// ==========================================

function modifyUserVip(targetUserId, action, value = 1) {
    const db = loadDb();
    const uid = String(targetUserId);
    const user = db.users[uid];
    if (!user) return { success: false, message: 'Kullanıcı bulunamadı.' };

    const now = Date.now();
    let currentVip = user.vipUntil ? (typeof user.vipUntil === 'string' ? new Date(user.vipUntil).getTime() : Number(user.vipUntil)) : 0;
    let baseTime = currentVip > now ? currentVip : now;
    let newVipTime = currentVip;
    let desc = '';

    if (action === 'extend_hours') {
        const addedMs = Number(value || 1) * 60 * 60 * 1000;
        newVipTime = baseTime + addedMs;
        user.vipUntil = new Date(newVipTime).toISOString();
        user.isUnlimitedVip = false;
        desc = `+${value} Saat Uzatıldı`;
    } else if (action === 'shorten_hours') {
        const subMs = Number(value || 1) * 60 * 60 * 1000;
        if (currentVip > now) {
            newVipTime = currentVip - subMs;
            if (newVipTime <= now) {
                user.vipUntil = null;
                desc = `-${value} Saat Kısaltıldı (Süre Doldu)`;
            } else {
                user.vipUntil = new Date(newVipTime).toISOString();
                desc = `-${value} Saat Kısaltıldı`;
            }
        } else {
            user.vipUntil = null;
            desc = `Aktif süresi yoktu, sıfırlandı`;
        }
    } else if (action === 'extend_days') {
        const addedMs = Number(value || 1) * 24 * 60 * 60 * 1000;
        newVipTime = baseTime + addedMs;
        user.vipUntil = new Date(newVipTime).toISOString();
        user.isUnlimitedVip = false;
        desc = `+${value} Gün Uzatıldı`;
    } else if (action === 'shorten_days') {
        const subMs = Number(value || 1) * 24 * 60 * 60 * 1000;
        if (currentVip > now) {
            newVipTime = currentVip - subMs;
            if (newVipTime <= now) {
                user.vipUntil = null;
                desc = `-${value} Gün Kısaltıldı (Süre Doldu)`;
            } else {
                user.vipUntil = new Date(newVipTime).toISOString();
                desc = `-${value} Gün Kısaltıldı`;
            }
        } else {
            user.vipUntil = null;
            desc = `Aktif süresi yoktu, sıfırlandı`;
        }
    } else if (action === 'cancel') {
        user.vipUntil = null;
        user.isUnlimitedVip = false;
        desc = 'VIP Üyeliği Sonlandırıldı / Sıfırlandı';
    } else if (action === 'set_unlimited') {
        user.isUnlimitedVip = !user.isUnlimitedVip;
        if (user.isUnlimitedVip) {
            desc = 'Ömür Boyu Sınırsız VIP Yapıldı';
        } else {
            user.vipUntil = null;
            desc = 'Sınırsız VIP Kaldırıldı';
        }
    } else {
        return { success: false, message: 'Geçersiz eylem: ' + action };
    }

    saveDb();

    // Güncel VIP durumunu hesapla
    const updatedVip = isUserVip(uid);

    return {
        success: true,
        message: `${user.firstName || 'Kullanıcı'} (${uid}) için VIP ${desc}!`,
        desc,
        user: {
            id: uid,
            firstName: user.firstName || user.first_name || 'Kullanıcı',
            username: user.username || '',
            vipUntil: updatedVip.until,
            vipUntilTimestamp: updatedVip.untilTimestamp,
            isVip: updatedVip.isVip,
            isUnlimited: updatedVip.isUnlimited || false,
            remainingHours: updatedVip.remainingHours || 0
        }
    };
}

function getAllVipUsers() {
    const db = loadDb();
    const users = db.users || {};
    const transactions = Array.isArray(db.transactionHistory) ? db.transactionHistory : [];
    const vipList = [];
    const now = Date.now();

    // Yıldız ile VIP satın alanları haritala
    const starVipBuyers = new Map();
    transactions.forEach(t => {
        const payload = String(t.payload || '');
        if (payload.includes('vip') || payload.startsWith('vip_')) {
            const uid = String(t.userId);
            const prev = starVipBuyers.get(uid) || { amount: 0, count: 0, lastDate: t.processedAt, payload };
            prev.amount += (Number(t.amount) || 0);
            prev.count += 1;
            prev.lastDate = t.processedAt || prev.lastDate;
            prev.payload = payload;
            starVipBuyers.set(uid, prev);
        }
    });

    for (const [uid, user] of Object.entries(users)) {
        if (!user) continue;
        const vipInfo = isUserVip(uid);
        const starBuyInfo = starVipBuyers.get(uid);
        const hasVipRecord = !!(user.vipUntil || user.isUnlimitedVip || vipInfo.isVip || starBuyInfo);

        if (hasVipRecord) {
            let untilTs = 0;
            if (user.vipUntil) {
                untilTs = typeof user.vipUntil === 'string' ? new Date(user.vipUntil).getTime() : Number(user.vipUntil);
                if (isNaN(untilTs)) untilTs = 0;
            }
            const isUnlimited = !!(user.isUnlimitedVip || vipInfo.isUnlimited);
            const isActive = isUnlimited || (untilTs > now);
            
            let endDateStr = '-';
            if (isUnlimited) {
                endDateStr = 'Ömür Boyu (Sınırsız)';
            } else if (untilTs > 0) {
                endDateStr = new Date(untilTs).toLocaleString('tr-TR');
            }

            vipList.push({
                id: uid,
                firstName: user.firstName || user.first_name || 'Kullanıcı',
                username: user.username || '',
                isVip: isActive,
                isUnlimited,
                remainingHours: vipInfo.remainingHours || 0,
                vipUntil: endDateStr,
                vipUntilTimestamp: untilTs,
                boughtWithStars: !!starBuyInfo,
                starsSpent: starBuyInfo ? starBuyInfo.amount : 0,
                starVipCount: starBuyInfo ? starBuyInfo.count : 0,
                starPayload: starBuyInfo ? starBuyInfo.payload : null,
                photoCredits: user.photoCredits || 0,
                videoCredits: user.videoCredits || 0,
                wheelSpins: user.wheelSpins || 0,
                createdAt: user.createdAt || null
            });
        }
    }

    vipList.sort((a, b) => {
        if (a.isUnlimited && !b.isUnlimited) return -1;
        if (!a.isUnlimited && b.isUnlimited) return 1;
        if (a.isVip && !b.isVip) return -1;
        if (!a.isVip && b.isVip) return 1;
        if (a.boughtWithStars && !b.boughtWithStars) return -1;
        if (!a.boughtWithStars && b.boughtWithStars) return 1;
        return (b.vipUntilTimestamp || 0) - (a.vipUntilTimestamp || 0);
    });

    return vipList;
}

// VIP Tanımla
function addVipDays(userId, days) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return null;

    const durationMs = Number(days || 1) * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let base = now;
    if (user.vipUntil) {
        const cur = typeof user.vipUntil === 'string' ? new Date(user.vipUntil).getTime() : Number(user.vipUntil);
        if (!isNaN(cur) && cur > now) base = cur;
    }

    user.vipUntil = new Date(base + durationMs).toISOString();
    user.isUnlimitedVip = (days >= 3650);
    saveDb();
    return user.vipUntil;
}

// Kredi güncelle
function updateCredits(userId, type, amount) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (user) {
        if (type === 'photo') {
            user.photoCredits = Math.max(0, (user.photoCredits || 0) + amount);
            saveDb();
            return user.photoCredits;
        } else if (type === 'video') {
            user.videoCredits = Math.max(0, (user.videoCredits || 0) + amount);
            saveDb();
            return user.videoCredits;
        }
    }
    return 0;
}

// Yıldız / Ödeme İşlemleri Takibi (Tekrar yükleme ve kaçak önleme)
function isTransactionProcessed(txId) {
    if (!txId) return false;
    const db = loadDb();
    if (!Array.isArray(db.processedTransactions)) {
        db.processedTransactions = [];
    }
    return db.processedTransactions.includes(String(txId));
}

function markTransactionProcessed(txId, meta = {}) {
    if (!txId) return;
    const db = loadDb();
    if (!Array.isArray(db.processedTransactions)) {
        db.processedTransactions = [];
    }
    const idStr = String(txId);
    if (!db.processedTransactions.includes(idStr)) {
        db.processedTransactions.push(idStr);
        if (!Array.isArray(db.transactionHistory)) {
            db.transactionHistory = [];
        }
        db.transactionHistory.push({
            id: idStr,
            userId: meta.userId ? String(meta.userId) : null,
            payload: meta.payload || null,
            amount: meta.amount || null,
            processedAt: new Date().toISOString()
        });
        saveDb();
    }
}

// Bot Ayarları
function getSettings() {
    const db = loadDb();
    if (!db.settings) db.settings = {};
    if (db.settings.hourlyPromoEnabled === undefined) db.settings.hourlyPromoEnabled = true;
    return db.settings;
}

function updateSettings(patch = {}) {
    const db = loadDb();
    if (!db.settings) db.settings = {};
    Object.assign(db.settings, patch);
    saveDb();
    return db.settings;
}

// Şans Çarkı (Wheel of Fortune) İşlemleri
function addWheelSpins(userId, count = 1) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (user) {
        user.wheelSpins = (user.wheelSpins || 0) + count;
        saveDb();
        return user.wheelSpins;
    }
    return 0;
}

function useWheelSpin(userId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (user && user.wheelSpins > 0) {
        user.wheelSpins--;
        saveDb();
        return { success: true, remaining: user.wheelSpins };
    }
    return { success: false, remaining: user ? (user.wheelSpins || 0) : 0 };
}

// Medya onaya ekle (pending)
function addPendingMedia(userId, fileId, fileUniqueId, type, categoryId = 'cat_1') {
    const db = loadDb();
    const uid = String(userId);

    const mediaItem = {
        id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        type: type,
        fileId: fileId,
        fileUniqueId: fileUniqueId || null,
        categoryId: categoryId || 'cat_1',
        uploadedBy: uid,
        status: 'pending',
        reports: 0,
        reporters: [],
        createdAt: new Date().toISOString()
    };

    db.media.push(mediaItem);
    invalidateMediaCaches();
    saveDb();
    return mediaItem;
}

// Medyayı otomatik onaylı olarak doğrudan ekle
function addApprovedMedia(userId, fileId, fileUniqueId, type, categoryId = 'cat_1') {
    const db = loadDb();
    const uid = String(userId);

    const mediaItem = {
        id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        type: type,
        fileId: fileId,
        fileUniqueId: fileUniqueId || null,
        categoryId: categoryId || 'cat_1',
        uploadedBy: uid,
        status: 'approved',
        likes: [],
        dislikes: [],
        reports: 0,
        reporters: [],
        createdAt: new Date().toISOString()
    };

    db.media.push(mediaItem);

    const user = db.users[uid];
    let creditAwarded = false;
    let currentProgress = 0;

    if (user) {
        if (type === 'photo') {
            user.uploadedPhotos = (user.uploadedPhotos || 0) + 1;
            user.photoProgress = (user.photoProgress || 0) + 1;
            if (user.photoProgress >= 2) {
                user.photoCredits = (user.photoCredits || 0) + 1;
                user.photoProgress = 0;
                creditAwarded = true;
            }
            currentProgress = user.photoProgress;
        } else if (type === 'video') {
            user.uploadedVideos = (user.uploadedVideos || 0) + 1;
            user.videoProgress = (user.videoProgress || 0) + 1;
            if (user.videoProgress >= 2) {
                user.videoCredits = (user.videoCredits || 0) + 1;
                user.videoProgress = 0;
                creditAwarded = true;
            }
            currentProgress = user.videoProgress;
        }
    }

    invalidateMediaCaches();
    saveDb();
    return { media: mediaItem, user, creditAwarded, currentProgress, needed: 2 };
}

// Aynı medya daha önce yüklendi mi kontrol et (fileUniqueId veya fileId ile)
function findDuplicateMedia(fileUniqueId, fileId) {
    const db = loadDb();
    return db.media.find(m => 
        m.status !== 'rejected' && (
            (fileUniqueId && m.fileUniqueId && m.fileUniqueId === fileUniqueId) ||
            (fileId && m.fileId && m.fileId === fileId)
        )
    ) || null;
}

// Sistemdeki mevcut kopya / mükerrer ve benzer medyaları sil (Resim ve Video Destekli)
function cleanDuplicateMedia(filterType = null) {
    const db = loadDb();
    const seenUniqueIds = new Set();
    const seenFileIds = new Set();
    const seenMediaSizes = new Map(); // type_fileSize -> firstMediaItem
    const initialCount = (db.media || []).length;

    const filteredMedia = [];
    const deletedItems = [];

    for (const item of (db.media || [])) {
        if (filterType && item.type !== filterType) {
            filteredMedia.push(item);
            continue;
        }

        let isDuplicate = false;
        let dupReason = '';
        const sizeKey = `${item.type || 'media'}_${item.fileSize}`;

        if (item.fileUniqueId && seenUniqueIds.has(item.fileUniqueId)) {
            isDuplicate = true;
            dupReason = 'Aynı fileUniqueId';
        } else if (item.fileId && seenFileIds.has(item.fileId)) {
            isDuplicate = true;
            dupReason = 'Aynı fileId';
        } else if (item.fileSize && item.fileSize > 10000 && seenMediaSizes.has(sizeKey)) {
            isDuplicate = true;
            dupReason = `Aynı dosya boyutu (${item.fileSize} byte)`;
        }

        if (isDuplicate) {
            deletedItems.push({
                id: item.id,
                type: item.type,
                uploadedBy: item.uploadedBy,
                reason: dupReason
            });
        } else {
            if (item.fileUniqueId) seenUniqueIds.add(item.fileUniqueId);
            if (item.fileId) seenFileIds.add(item.fileId);
            if (item.fileSize && item.fileSize > 10000) seenMediaSizes.set(sizeKey, item);
            filteredMedia.push(item);
        }
    }

    // Sıralı indeksleri 1'den N'e yeniden düzenle
    filteredMedia.forEach((item, idx) => {
        item.orderIndex = idx + 1;
    });

    db.media = filteredMedia;

    // Silinen medyaları kullanıcıların seenMedia, favorites ve received listelerinden de temizle
    const deletedIds = new Set(deletedItems.map(d => d.id));
    if (db.users) {
        for (const uid in db.users) {
            const u = db.users[uid];
            if (Array.isArray(u.seenMedia)) {
                u.seenMedia = u.seenMedia.filter(mid => !deletedIds.has(mid));
            }
            if (Array.isArray(u.favorites)) {
                u.favorites = u.favorites.filter(mid => !deletedIds.has(mid));
            }
        }
    }
    if (db.received) {
        for (const uid in db.received) {
            if (Array.isArray(db.received[uid])) {
                db.received[uid] = db.received[uid].filter(mid => !deletedIds.has(mid));
            }
        }
    }

    invalidateMediaCaches();
    saveDb();

    const deletedVideos = deletedItems.filter(x => x.type === 'video').length;
    const deletedPhotos = deletedItems.filter(x => x.type === 'photo').length;

    return {
        initialCount,
        remainingCount: db.media.length,
        deletedCount: deletedItems.length,
        deletedVideos,
        deletedPhotos,
        deletedItems
    };
}

// Sistemdeki mevcut kopya / mükerrer medya istatistiklerini hesapla (Silmeden denetle)
function getDuplicateStats(filterType = null) {
    const now = Date.now();
    if (!filterType && duplicateStatsCache && (now - duplicateStatsCacheTime < 15000)) {
        return duplicateStatsCache;
    }

    const db = loadDb();
    const seenUniqueIds = new Set();
    const seenFileIds = new Set();
    const seenMediaSizes = new Map();
    let dupPhotos = 0;
    let dupVideos = 0;
    let totalDups = 0;

    for (const item of (db.media || [])) {
        if (filterType && item.type !== filterType) continue;

        let isDuplicate = false;
        const sizeKey = `${item.type || 'media'}_${item.fileSize}`;

        if (item.fileUniqueId && seenUniqueIds.has(item.fileUniqueId)) {
            isDuplicate = true;
        } else if (item.fileId && seenFileIds.has(item.fileId)) {
            isDuplicate = true;
        } else if (item.fileSize && item.fileSize > 10000 && seenMediaSizes.has(sizeKey)) {
            isDuplicate = true;
        }

        if (isDuplicate) {
            totalDups++;
            if (item.type === 'video') dupVideos++;
            else if (item.type === 'photo') dupPhotos++;
        } else {
            if (item.fileUniqueId) seenUniqueIds.add(item.fileUniqueId);
            if (item.fileId) seenFileIds.add(item.fileId);
            if (item.fileSize && item.fileSize > 10000) seenMediaSizes.set(sizeKey, item);
        }
    }

    const result = {
        totalMedia: (db.media || []).length,
        duplicateCount: totalDups,
        duplicatePhotos: dupPhotos,
        duplicateVideos: dupVideos,
        uniqueCount: (db.media || []).length - totalDups
    };

    if (!filterType) {
        duplicateStatsCache = result;
        duplicateStatsCacheTime = now;
    }

    return result;
}

// Sistemdeki mevcut kopya / mükerrer ve benzer medyaları listele (Resim & Video Önizleme)
function findDuplicateMediaList(filterType = null) {
    const db = loadDb();
    const mediaList = filterType ? db.media.filter(m => m.type === filterType && m.status !== 'rejected') : db.media.filter(m => m.status !== 'rejected');
    const seenUnique = new Map();
    const seenFile = new Map();
    const seenSize = new Map();

    const duplicates = [];

    for (const item of mediaList) {
        let isDup = false;
        let originalItem = null;
        let reason = '';
        const sizeKey = `${item.type || 'media'}_${item.fileSize}`;

        if (item.fileUniqueId && seenUnique.has(item.fileUniqueId)) {
            isDup = true;
            originalItem = seenUnique.get(item.fileUniqueId);
            reason = 'Aynı İçerik Parmak İzi (fileUniqueId)';
        } else if (item.fileId && seenFile.has(item.fileId)) {
            isDup = true;
            originalItem = seenFile.get(item.fileId);
            reason = 'Aynı Telegram fileId';
        } else if (item.fileSize && seenSize.has(sizeKey)) {
            isDup = true;
            originalItem = seenSize.get(sizeKey);
            reason = `Birebir Aynı Dosya Boyutu (${item.fileSize} byte)`;
        }

        if (isDup) {
            duplicates.push({
                item,
                originalItem,
                reason
            });
        } else {
            if (item.fileUniqueId) seenUnique.set(item.fileUniqueId, item);
            if (item.fileId) seenFile.set(item.fileId, item);
            if (item.fileSize) seenSize.set(sizeKey, item);
        }
    }

    return {
        total: mediaList.length,
        duplicateCount: duplicates.length,
        duplicates
    };
}

// Medyayı tamamen sil (Resim & Video)
function deleteMedia(mediaId) {
    const db = loadDb();
    const idx = (db.media || []).findIndex(m => m.id === mediaId);
    if (idx === -1) return { success: false, message: 'Medya bulunamadı.' };
    const [deleted] = db.media.splice(idx, 1);

    // Kalan medyaların orderIndex değerlerini yeniden sırala
    (db.media || []).forEach((m, i) => {
        m.orderIndex = i + 1;
    });

    // Kullanıcıların izleme geçmişi ve favorilerinden temizle
    if (db.users) {
        for (const uid in db.users) {
            const u = db.users[uid];
            if (Array.isArray(u.seenMedia)) {
                u.seenMedia = u.seenMedia.filter(id => id !== mediaId);
            }
            if (Array.isArray(u.favorites)) {
                u.favorites = u.favorites.filter(id => id !== mediaId);
            }
        }
    }
    if (db.received) {
        for (const uid in db.received) {
            if (Array.isArray(db.received[uid])) {
                db.received[uid] = db.received[uid].filter(id => id !== mediaId);
            }
        }
    }
    if (db.downloads) {
        for (const uid in db.downloads) {
            if (db.downloads[uid] && db.downloads[uid][mediaId]) {
                delete db.downloads[uid][mediaId];
            }
        }
    }

    invalidateMediaCaches();
    saveDb();
    return { success: true, media: deleted };
}

// Toplu Medya Silme Fonksiyonu (Kategori, Tür veya Sayı Bazlı)
function bulkDeleteMedia(options = {}) {
    const {
        categoryId = null,  // 'cat_11' or any cat id, null for all
        type = null,        // 'photo', 'video', or null for all
        count = null,       // number of items to delete, or null for all matching
        order = 'desc'      // 'desc' (newest first) or 'asc' (oldest first)
    } = options;

    const db = loadDb();
    const media = db.media || [];
    const targetToDelete = [];
    const targetIds = new Set();

    // Match items
    for (let i = (order === 'desc' ? media.length - 1 : 0); 
         (order === 'desc' ? i >= 0 : i < media.length); 
         (order === 'desc' ? i-- : i++)) {
        
        const m = media[i];
        if (categoryId && m.categoryId !== categoryId) continue;
        if (type && m.type !== type) continue;

        targetToDelete.push(m);
        targetIds.add(m.id);

        if (count && targetToDelete.length >= count) {
            break;
        }
    }

    if (targetIds.size === 0) {
        return {
            success: true,
            deletedCount: 0,
            remainingCount: media.length,
            message: 'Silinecek medya bulunamadı.'
        };
    }

    // Filter media
    db.media = media.filter(m => !targetIds.has(m.id));

    // Re-index remaining orderIndex
    db.media.forEach((m, idx) => {
        m.orderIndex = idx + 1;
    });

    // Clean user references
    if (db.users) {
        for (const uid in db.users) {
            const u = db.users[uid];
            if (Array.isArray(u.seenMedia)) {
                u.seenMedia = u.seenMedia.filter(id => !targetIds.has(id));
            }
            if (Array.isArray(u.favorites)) {
                u.favorites = u.favorites.filter(id => !targetIds.has(id));
            }
        }
    }
    if (db.received) {
        for (const uid in db.received) {
            if (Array.isArray(db.received[uid])) {
                db.received[uid] = db.received[uid].filter(id => !targetIds.has(id));
            }
        }
    }
    if (db.downloads) {
        for (const uid in db.downloads) {
            for (const id of targetIds) {
                delete db.downloads[uid][id];
            }
        }
    }

    invalidateMediaCaches();
    saveDb();

    const deletedPhotos = targetToDelete.filter(m => m.type === 'photo').length;
    const deletedVideos = targetToDelete.filter(m => m.type === 'video').length;

    return {
        success: true,
        deletedCount: targetIds.size,
        deletedPhotos,
        deletedVideos,
        remainingCount: db.media.length,
        message: `${targetIds.size} adet medya başarıyla silindi.`
    };
}

// Aynı medya daha önce yüklendi mi kontrol et
function findMediaByUniqueId(fileUniqueId) {
    if (!fileUniqueId) return null;
    const db = loadDb();
    return db.media.find(m => m.fileUniqueId === fileUniqueId && m.status !== 'rejected');
}

// Kullanıcıya uyarı ekle
function addWarning(userId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (user) {
        user.warnings = (user.warnings || 0) + 1;
        saveDb();
        return user.warnings;
    }
    return 1;
}

// Kullanıcıyı Banla
// Kullanıcıyı Banla (Yönetici Asla Banlanamaz)
function banUser(userId, reason = 'Kural ihlali (Kopya veya uygunsuz içerik)') {
    if (isAdminUser(userId)) {
        return null; // YÖNETİCİ ASLA BANLANAMAZ!
    }
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return null;

    user.isBanned = true;
    user.bannedReason = reason;
    user.bannedAt = new Date().toISOString();
    saveDb();
    return user;
}

// Kullanıcı Banını Kaldır
function unbanUser(userId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return null;

    user.isBanned = false;
    user.bannedReason = null;
    user.bannedAt = null;
    user.warnings = 0;
    saveDb();
    return user;
}

// Tüm Banları ve Uyarıları Temizle
function unbanAllUsers() {
    const db = loadDb();
    let count = 0;
    for (const uid in db.users) {
        const user = db.users[uid];
        if (user.isBanned || (user.warnings && user.warnings > 0)) {
            user.isBanned = false;
            user.bannedReason = null;
            user.bannedAt = null;
            user.warnings = 0;
            count++;
        }
    }
    saveDb();
    return count;
}

// Kullanıcı Banlı mı kontrol et (Admin asla banlı olamaz)
function isUserBanned(userId) {
    if (isAdminUser(userId)) return false;
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    return !!(user && user.isBanned);
}

// Banlı kullanıcıları getir
function getBannedUsers() {
    const db = loadDb();
    return Object.values(db.users).filter(u => u.isBanned);
}

// Medyayı onayla (2 Yükle 1 Al kuralı: Her 2 resim için 1 resim kredisi, her 2 video için 1 video kredisi)
function approveMedia(mediaId) {
    const db = loadDb();
    const item = db.media.find(m => m.id === mediaId);
    if (!item) return { success: false, message: 'Medya bulunamadı.' };
    if (item.status === 'approved') return { success: false, message: 'Zaten onaylanmış.' };

    item.status = 'approved';

    let user = db.users[item.uploadedBy];
    if (!user) {
        const res = getOrCreateUser({ id: item.uploadedBy, first_name: 'Kullanıcı' });
        user = res.user;
    }
    let creditAwarded = false;
    let currentProgress = 0;

    if (user) {
        if (item.type === 'photo') {
            user.uploadedPhotos = (user.uploadedPhotos || 0) + 1;
            user.photoProgress = (user.photoProgress || 0) + 1;
            if (user.photoProgress >= 2) {
                user.photoCredits = (user.photoCredits || 0) + 1;
                user.photoProgress = 0;
                creditAwarded = true;
            }
            currentProgress = user.photoProgress;
        } else if (item.type === 'video') {
            user.uploadedVideos = (user.uploadedVideos || 0) + 1;
            user.videoProgress = (user.videoProgress || 0) + 1;
            if (user.videoProgress >= 2) {
                user.videoCredits = (user.videoCredits || 0) + 1;
                user.videoProgress = 0;
                creditAwarded = true;
            }
            currentProgress = user.videoProgress;
        }

        item.creditAwarded = creditAwarded;

        // Onaylanan medyasını kullanıcının kendi arşivinde (Aldıklarım) görebilmesi için seenMedia'ya ekle
        if (!Array.isArray(user.seenMedia)) user.seenMedia = [];
        if (!user.seenMedia.includes(item.id)) {
            user.seenMedia.push(item.id);
        }
    }

    invalidateMediaCaches();
    saveDb();
    return { success: true, media: item, user, creditAwarded, currentProgress };
}

// Medyayı reddet
function rejectMedia(mediaId) {
    const db = loadDb();
    const item = db.media.find(m => m.id === mediaId);
    if (!item) return { success: false, message: 'Medya bulunamadı.' };

    item.status = 'rejected';
    invalidateMediaCaches();
    saveDb();
    return { success: true, media: item, user: db.users[item.uploadedBy] };
}

// ↩️ Medya Onayını Geri Al (Krediyi Geri Çek ve Beklemeye Al)
function undoApproveMedia(mediaId) {
    const db = loadDb();
    const item = db.media.find(m => m.id === mediaId);
    if (!item) return { success: false, message: 'Medya bulunamadı.' };

    item.status = 'pending';

    let user = db.users[item.uploadedBy];
    if (user) {
        if (item.type === 'photo') {
            user.uploadedPhotos = Math.max(0, (user.uploadedPhotos || 0) - 1);
            if (item.creditAwarded) {
                user.photoCredits = Math.max(0, (user.photoCredits || 0) - 1);
                user.photoProgress = 1;
            } else {
                user.photoProgress = Math.max(0, (user.photoProgress || 0) - 1);
            }
        } else if (item.type === 'video') {
            user.uploadedVideos = Math.max(0, (user.uploadedVideos || 0) - 1);
            if (item.creditAwarded) {
                user.videoCredits = Math.max(0, (user.videoCredits || 0) - 1);
                user.videoProgress = 1;
            } else {
                user.videoProgress = Math.max(0, (user.videoProgress || 0) - 1);
            }
        }
        item.creditAwarded = false;
        if (Array.isArray(user.seenMedia)) {
            user.seenMedia = user.seenMedia.filter(id => id !== item.id);
        }
    }

    invalidateMediaCaches();
    saveDb();
    return { success: true, media: item, user };
}

// ↩️ Medya Reddetmesini Geri Al (Yeniden İnceleme Beklemesine Al)
function undoRejectMedia(mediaId) {
    const db = loadDb();
    const item = db.media.find(m => m.id === mediaId);
    if (!item) return { success: false, message: 'Medya bulunamadı.' };

    item.status = 'pending';
    invalidateMediaCaches();
    saveDb();
    return { success: true, media: item, user: db.users[item.uploadedBy] };
}

// Tüm bekleyen medyaları toplu onayla
function approveAllPending(userId = null) {
    const db = loadDb();
    let pendingList = db.media.filter(m => m.status === 'pending');
    if (userId) {
        pendingList = pendingList.filter(m => String(m.uploadedBy) === String(userId));
    }

    if (pendingList.length === 0) {
        return { count: 0, photos: 0, videos: 0, affectedUsers: {} };
    }

    let photoCount = 0;
    let videoCount = 0;
    const affectedUsers = {}; // { [userId]: { photos, videos, photoCredits, videoCredits } }

    for (const item of pendingList) {
        item.status = 'approved';
        const uid = String(item.uploadedBy);
        const user = db.users[uid];
        if (user) {
            if (!affectedUsers[uid]) {
                affectedUsers[uid] = { photos: 0, videos: 0, photoCredits: 0, videoCredits: 0 };
            }
            if (item.type === 'photo') {
                user.uploadedPhotos = (user.uploadedPhotos || 0) + 1;
                user.photoProgress = (user.photoProgress || 0) + 1;
                if (user.photoProgress >= 2) {
                    user.photoCredits = (user.photoCredits || 0) + 1;
                    user.photoProgress = 0;
                    affectedUsers[uid].photoCredits++;
                }
                photoCount++;
                affectedUsers[uid].photos++;
            } else if (item.type === 'video') {
                user.uploadedVideos = (user.uploadedVideos || 0) + 1;
                user.videoProgress = (user.videoProgress || 0) + 1;
                if (user.videoProgress >= 2) {
                    user.videoCredits = (user.videoCredits || 0) + 1;
                    user.videoProgress = 0;
                    affectedUsers[uid].videoCredits++;
                }
                videoCount++;
                affectedUsers[uid].videos++;
            }
        }
    }

    invalidateMediaCaches();
    saveDb();
    return {
        count: pendingList.length,
        photos: photoCount,
        videos: videoCount,
        affectedUsers
    };
}

// Tüm bekleyen medyaları toplu reddet
function rejectAllPending(userId = null) {
    const db = loadDb();
    let pendingList = db.media.filter(m => m.status === 'pending');
    if (userId) {
        pendingList = pendingList.filter(m => String(m.uploadedBy) === String(userId));
    }

    for (const item of pendingList) {
        item.status = 'rejected';
    }

    invalidateMediaCaches();
    saveDb();
    return { count: pendingList.length };
}

// Kategorileri getir
function getCategories() {
    const db = loadDb();
    if (!db.categories || !Array.isArray(db.categories) || db.categories.length === 0) {
        db.categories = JSON.parse(JSON.stringify(defaultCategories));
        saveDb();
    }
    return db.categories;
}

// Belirli bir kategoriyi bul (id veya key ile)
function getCategory(catIdOrKey) {
    const cats = getCategories();
    if (!catIdOrKey) return cats[0];
    const q = String(catIdOrKey).trim().toUpperCase();
    return cats.find(c => 
        c.id === catIdOrKey || 
        c.key.toUpperCase() === q || 
        String(c.id.replace('cat_', '')) === q
    ) || cats[0];
}

// Kategori ismini güncelle (Yönetici için)
function updateCategoryName(catIdOrKey, newName) {
    const db = loadDb();
    const target = getCategory(catIdOrKey);
    if (!target) return null;

    const catInDb = db.categories.find(c => c.id === target.id);
    if (catInDb) {
        catInDb.name = newName.trim();
        saveDb();
        return catInDb;
    }
    return null;
}

// ⭐ Dinamik Yıldızlı Sekme Fiyatlandırmalarını Veritabanından Getir
function getStarCategories() {
    const cats = getCategories();
    const result = {};
    cats.forEach(c => {
        if (c.starCfg && (c.starCfg.videoPrice > 0 || c.starCfg.photoPrice > 0)) {
            result[c.id] = {
                videoPrice: parseInt(c.starCfg.videoPrice, 10) || 1,
                photoPrice: parseInt(c.starCfg.photoPrice, 10) || 1
            };
        }
    });
    return result;
}

// 💳 Sekmenin Kredi Kesinti Miktarını Getir (Varsayılan 1 Kredi)
function getCategoryCreditCost(catId, type) {
    if (!catId) return 1;
    const cat = getCategory(catId);
    if (!cat || !cat.creditCfg) return 1;
    const cost = type === 'video' ? cat.creditCfg.videoCost : cat.creditCfg.photoCost;
    return Math.max(1, parseInt(cost, 10) || 1);
}

// 📤 Kullanıcının bu kategoriye yükleme yapma izni var mı?
function isCategoryUploadEnabled(catId, userId) {
    if (userId && isAdminUser(userId)) return true;
    const cat = getCategory(catId);
    if (!cat) return true;
    return cat.uploadsEnabled !== false;
}

// 🔄 Sekme Yükleme İznini Aç / Kapat (Toggle)
function toggleCategoryUpload(catId, enabled = null) {
    const db = loadDb();
    const cat = db.categories.find(c => c.id === catId);
    if (!cat) return null;
    if (enabled === null) {
        cat.uploadsEnabled = (cat.uploadsEnabled === false) ? true : false;
    } else {
        cat.uploadsEnabled = !!enabled;
    }
    saveDb();
    return cat;
}

// 💰 Sekme Fiyatlandırmasını Güncelle (Yıldızlı vs Kredili)
function updateCategoryPricing(catId, starCfg = null, creditCfg = null) {
    const db = loadDb();
    const cat = db.categories.find(c => c.id === catId);
    if (!cat) return null;

    if (!starCfg || (!starCfg.videoPrice && !starCfg.photoPrice)) {
        cat.starCfg = null;
    } else {
        cat.starCfg = {
            videoPrice: Math.max(1, parseInt(starCfg.videoPrice, 10) || 1),
            photoPrice: Math.max(1, parseInt(starCfg.photoPrice, 10) || 1)
        };
    }

    if (creditCfg) {
        cat.creditCfg = {
            videoCost: Math.max(1, parseInt(creditCfg.videoCost, 10) || 1),
            photoCost: Math.max(1, parseInt(creditCfg.photoCost, 10) || 1)
        };
    }

    saveDb();
    return cat;
}

// ➕ Yeni Sekme Oluştur
function addCategory({ name, key, uploadsEnabled = true, starCfg = null, creditCfg = null }) {
    const db = loadDb();
    if (!db.categories) db.categories = [];

    // Kısayol harfi belirle (A-Z)
    let targetKey = (key || '').trim().toUpperCase();
    if (!targetKey) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const usedKeys = new Set(db.categories.map(c => (c.key || '').toUpperCase()));
        for (const char of alphabet) {
            if (!usedKeys.has(char)) {
                targetKey = char;
                break;
            }
        }
        if (!targetKey) targetKey = 'S' + (db.categories.length + 1);
    }

    // ID otomatik oluştur (cat_12, cat_13, ...)
    let maxNum = 0;
    db.categories.forEach(c => {
        const m = String(c.id).match(/^cat_(\d+)$/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
    const newId = `cat_${maxNum + 1}`;

    const newCat = {
        id: newId,
        key: targetKey,
        name: (name || 'Yeni Sekme').trim(),
        uploadsEnabled: uploadsEnabled !== false,
        starCfg: starCfg && (starCfg.videoPrice > 0 || starCfg.photoPrice > 0) ? {
            videoPrice: Math.max(1, parseInt(starCfg.videoPrice, 10) || 1),
            photoPrice: Math.max(1, parseInt(starCfg.photoPrice, 10) || 1)
        } : null,
        creditCfg: creditCfg ? {
            videoCost: Math.max(1, parseInt(creditCfg.videoCost, 10) || 1),
            photoCost: Math.max(1, parseInt(creditCfg.photoCost, 10) || 1)
        } : { videoCost: 1, photoCost: 1 }
    };

    db.categories.push(newCat);
    saveDb();
    return newCat;
}

// ✏️ Sekme Bilgilerini Güncelle (İsim, Harf, Yükleme Durumu, Yıldız Fiyatı, Kredi Ücreti)
function updateCategory(catId, updates = {}) {
    const db = loadDb();
    const cat = db.categories.find(c => c.id === catId);
    if (!cat) return null;

    if (updates.name !== undefined) cat.name = updates.name.trim();
    if (updates.key !== undefined) cat.key = updates.key.trim().toUpperCase();
    if (updates.uploadsEnabled !== undefined) cat.uploadsEnabled = !!updates.uploadsEnabled;
    if (updates.starCfg !== undefined) {
        if (!updates.starCfg || (!updates.starCfg.videoPrice && !updates.starCfg.photoPrice)) {
            cat.starCfg = null;
        } else {
            cat.starCfg = {
                videoPrice: Math.max(1, parseInt(updates.starCfg.videoPrice, 10) || 1),
                photoPrice: Math.max(1, parseInt(updates.starCfg.photoPrice, 10) || 1)
            };
        }
    }
    if (updates.creditCfg !== undefined) {
        if (!updates.creditCfg) {
            cat.creditCfg = { videoCost: 1, photoCost: 1 };
        } else {
            cat.creditCfg = {
                videoCost: Math.max(1, parseInt(updates.creditCfg.videoCost, 10) || 1),
                photoCost: Math.max(1, parseInt(updates.creditCfg.photoCost, 10) || 1)
            };
        }
    }

    saveDb();
    return cat;
}

// 🗑️ Sekme Sil (İçindeki medyaları güvenle Genel sekmesine taşır)
function deleteCategory(catId) {
    const db = loadDb();
    const idx = db.categories.findIndex(c => c.id === catId);
    if (idx === -1) return { success: false, message: 'Sekme bulunamadı.' };

    const removed = db.categories.splice(idx, 1)[0];

    // Bu sekmedeki medyaları Genel (cat_11) sekmesine aktar
    const fallbackCat = db.categories.find(c => c.id === 'cat_11') || db.categories[0];
    let movedMediaCount = 0;
    if (fallbackCat) {
        db.media.forEach(m => {
            if (m.categoryId === catId) {
                m.categoryId = fallbackCat.id;
                movedMediaCount++;
            }
        });
    }

    saveDb();
    return { success: true, removed, movedMediaCount };
}

// Kullanıcının aktif yükleme kategorisini ayarla
function setUserActiveCategory(userId, catId) {
    const db = loadDb();
    const user = db.users[String(userId)];
    if (user) {
        user.activeUploadCategory = catId;
        saveDb();
    }
}

// Kullanıcının aktif yükleme kategorisini getir
function getUserActiveCategory(userId) {
    const db = loadDb();
    const user = db.users[String(userId)];
    return user?.activeUploadCategory || 'cat_1';
}

// 📊 Kategori istatistiklerini tek geçişte hesapla (Yüksek Performans & 3 sn Önbellek)
function getAllCategoryStats() {
    const now = Date.now();
    if (categoryStatsCache && (now - categoryStatsCacheTime < 3000)) {
        return categoryStatsCache;
    }

    const db = loadDb();
    const statsMap = {};
    for (const cat of (db.categories || [])) {
        statsMap[cat.id] = { approvedPhotos: 0, approvedVideos: 0, pendingMedia: 0, total: 0 };
    }

    for (const m of (db.media || [])) {
        const catId = m.categoryId || 'cat_1';
        if (!statsMap[catId]) {
            statsMap[catId] = { approvedPhotos: 0, approvedVideos: 0, pendingMedia: 0, total: 0 };
        }
        const s = statsMap[catId];
        if (m.status === 'approved') {
            if (m.type === 'photo') s.approvedPhotos++;
            else if (m.type === 'video') s.approvedVideos++;
            s.total++;
        } else if (m.status === 'pending') {
            s.pendingMedia++;
        }
    }

    categoryStatsCache = statsMap;
    categoryStatsCacheTime = now;
    return statsMap;
}

// Kategori istatistikleri
function getCategoryStats(catId) {
    const all = getAllCategoryStats();
    return all[catId] || { approvedPhotos: 0, approvedVideos: 0, pendingMedia: 0, total: 0 };
}

// Kategoriye ait onaylı medyaları getir
function getCategoryMedia(catId, type = null) {
    const db = loadDb();
    return (db.media || []).filter(m => m.categoryId === catId && m.status === 'approved' && (!type || m.type === type));
}

// Kullanıcının bu sekmede henüz almadığı (görmediği) medya sayıları (O(1) Set & Tek Geçiş)
function getUserCategoryUnseenCount(userId, catId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    const seenSet = new Set(user?.seenMedia || []);

    let unseenPhotos = 0;
    let unseenVideos = 0;

    for (const m of (db.media || [])) {
        if (m.categoryId === catId && m.status === 'approved' && !seenSet.has(m.id)) {
            if (m.type === 'photo') unseenPhotos++;
            else if (m.type === 'video') unseenVideos++;
        }
    }

    return { unseenPhotos, unseenVideos };
}

// Medyayı görülenlerden çıkar (Gönderim hatası durumunda)
function removeSeenMedia(userId, mediaId) {
    const db = loadDb();
    const user = db.users[String(userId)];
    if (user && user.seenMedia) {
        user.seenMedia = user.seenMedia.filter(id => id !== mediaId);
        saveDb();
    }
}

// 🤖 NOVA AI • AKILLI AL ROBOTU & TERCİH ÖĞRENME MOTORU (Yüksek Performans & O(1) Set)
function getRandomMedia(userId, type, categoryId = null, skipCreditDeduct = false) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return null;

    const seenSet = new Set(user.seenMedia || []);

    // Özel sekmeler (İfsa ve Onlyfans) genel havuzdan rastgele çekilemez
    const isExcludedFromGeneral = (m) => (!categoryId && (m.categoryId === 'cat_3' || m.categoryId === 'cat_5'));

    // KESİN KURAL 1: Kullanıcının gördüğü medyalar ASLA tekrar gönderilemez (!seenSet.has(m.id))
    // Tek geçişte hem başka kullanıcıların hem de tüm henüz görülmemiş medyaları topla:
    const otherEligible = [];
    const allEligible = [];

    for (const m of (db.media || [])) {
        if (m.status !== 'approved' || m.type !== type) continue;
        if (categoryId ? m.categoryId !== categoryId : isExcludedFromGeneral(m)) continue;
        if (seenSet.has(m.id)) continue;

        if (m.uploadedBy !== uid) {
            otherEligible.push(m);
        }
        allEligible.push(m);
    }

    const eligible = otherEligible.length > 0 ? otherEligible : allEligible;

    // Eğer henüz görülmemiş medya kalmadıysa KESİNLİKLE null dön (Aynı medya ASLA tekrar gönderilmez!)
    if (eligible.length === 0) {
        return null;
    }

    // 🧠 AI Ağırlıklı Akıllı Seçim Algoritması:
    const userPrefs = user.learnedPreferences || {};
    let totalWeight = 0;
    const now = Date.now();
    const len = eligible.length;
    const weightedItems = new Array(len);

    for (let i = 0; i < len; i++) {
        const m = eligible[i];
        let weight = 100;
        // Puanlama ve yıldız katkısı
        if (m.rating && m.rating > 0) weight += m.rating * 20;
        if (m.stars && m.stars > 0) weight += m.stars * 10;
        // Şikayet cezası
        if (m.reports && m.reports > 0) weight = Math.max(10, weight - (m.reports * 40));
        // Kullanıcı tercih ettiği kategori ise bonus
        if (m.categoryId && userPrefs[m.categoryId]) {
            weight += Math.min(100, userPrefs[m.categoryId] * 15);
        }
        // Tazelik bonusu (Son 7 gün)
        const ageHours = (now - (m.createdAt ? new Date(m.createdAt).getTime() : 0)) / 3600000;
        if (ageHours < 168) weight += 25;

        totalWeight += weight;
        weightedItems[i] = { media: m, weight };
    }

    let selected = null;
    let rnd = Math.random() * totalWeight;
    for (let i = 0; i < len; i++) {
        const item = weightedItems[i];
        if (rnd < item.weight) {
            selected = item.media;
            break;
        }
        rnd -= item.weight;
    }
    if (!selected) {
        selected = eligible[Math.floor(Math.random() * eligible.length)];
    }

    // Görülenler listesine ekle - Bir daha asla bu kullanıcıya gönderilemez!
    if (!user.seenMedia) user.seenMedia = [];
    if (!seenSet.has(selected.id)) {
        user.seenMedia.push(selected.id);
    }

    // 🎓 Tercih Öğrenme: Kullanıcının aldığı kategorinin ilgi puanını artır
    if (selected.categoryId) {
        if (!user.learnedPreferences) user.learnedPreferences = {};
        user.learnedPreferences[selected.categoryId] = (user.learnedPreferences[selected.categoryId] || 0) + 1;
    }
    user.alRobotInteractions = (user.alRobotInteractions || 0) + 1;

    // SAYIDAN DÜŞME: VIP üyeliği yoksa ve skipCreditDeduct false ise kategorinin kredi ücreti kadar düşülür
    const effectiveCatId = categoryId || selected.categoryId;
    const creditCost = getCategoryCreditCost(effectiveCatId, type);
    const vipStatus = isUserVip(uid);
    if (!vipStatus.isVip && !skipCreditDeduct) {
        if (type === 'photo') {
            user.photoCredits = Math.max(0, (user.photoCredits || 0) - creditCost);
            user.receivedPhotos = (user.receivedPhotos || 0) + 1;
        } else if (type === 'video') {
            user.videoCredits = Math.max(0, (user.videoCredits || 0) - creditCost);
            user.receivedVideos = (user.receivedVideos || 0) + 1;
        }
    } else {
        if (type === 'photo') user.receivedPhotos = (user.receivedPhotos || 0) + 1;
        if (type === 'video') user.receivedVideos = (user.receivedVideos || 0) + 1;
    }

    saveDb();
    return selected;
}

// Şikayet et
function reportMedia(mediaId, reporterUserId) {
    const db = loadDb();
    const media = db.media.find(m => m.id === mediaId);
    if (!media) return { success: false, message: 'Medya bulunamadı.' };

    const rUid = String(reporterUserId);
    if (!media.reporters) media.reporters = [];
    if (media.reporters.includes(rUid)) {
        return { success: false, message: 'Bu medyayı zaten daha önce şikayet ettiniz.' };
    }

    media.reporters.push(rUid);
    media.reports += 1;

    let isBanned = false;
    if (media.reports >= db.settings.minReportsToBan) {
        media.status = 'rejected';
        isBanned = true;
    }

    saveDb();
    return { success: true, isBanned: isBanned, reports: media.reports, media: media };
}

// Medyaya bahşiş / yıldız ekle
function addMediaStars(mediaId, starCount) {
    const db = loadDb();
    const media = db.media.find(m => m.id === mediaId);
    if (media) {
        media.stars = (media.stars || 0) + starCount;
        saveDb();
        return media.stars;
    }
    return 0;
}

// Medyayı ID ile getir (Esnek eşleşme: id, m_ id, fileId, fileUniqueId veya orderIndex)
function getMedia(mediaId) {
    if (!mediaId) return null;
    const db = loadDb();
    const idStr = String(mediaId).trim();
    return db.media.find(m => 
        m.id === idStr || 
        m.id === 'm_' + idStr || 
        ('m_' + m.id) === idStr ||
        m.fileId === idStr || 
        m.fileUniqueId === idStr ||
        String(m.orderIndex) === idStr
    ) || null;
}

// Medyayı oyla (İyi / Kötü)
function rateMedia(mediaId, userId, rating) {
    const db = loadDb();
    const media = db.media.find(m => m.id === mediaId);
    if (!media) return { success: false, message: 'Medya bulunamadı.' };

    const uid = String(userId);
    if (!Array.isArray(media.likes)) media.likes = [];
    if (!Array.isArray(media.dislikes)) media.dislikes = [];

    let action = '';
    if (rating === 'good') {
        media.dislikes = media.dislikes.filter(id => id !== uid);
        if (!media.likes.includes(uid)) {
            media.likes.push(uid);
            action = 'liked';
        } else {
            action = 'already_liked';
        }
    } else if (rating === 'bad') {
        media.likes = media.likes.filter(id => id !== uid);
        if (!media.dislikes.includes(uid)) {
            media.dislikes.push(uid);
            action = 'disliked';
        } else {
            action = 'already_disliked';
        }
    }

    saveDb();
    return {
        success: true,
        action,
        likesCount: media.likes.length,
        dislikesCount: media.dislikes.length,
        userRating: rating
    };
}

// Medyanın kategorisini/sekmesini değiştir
function changeMediaCategory(mediaId, newCategoryId) {
    const db = loadDb();
    const media = db.media.find(m => m.id === mediaId);
    if (!media) return { success: false, message: 'Medya bulunamadı.' };

    const oldCat = getCategory(media.categoryId);
    const newCat = getCategory(newCategoryId);
    if (!newCat) return { success: false, message: 'Geçersiz hedef sekme.' };

    const oldCatId = media.categoryId;
    media.categoryId = newCat.id;
    debouncedSaveDb();
    return {
        success: true,
        media,
        oldCategory: oldCat,
        newCategory: newCat,
        changed: oldCatId !== newCat.id
    };
}

// Tüm medyaları tek bir kategoriye (varsayılan Genel: cat_11) taşı ve diğer sekmeleri boşalt
function moveAllMediaToCategory(targetCategoryId = 'cat_11') {
    const db = loadDb();
    const targetCat = getCategory(targetCategoryId);
    if (!targetCat) return { success: false, message: 'Geçersiz hedef sekme.' };

    let count = 0;
    (db.media || []).forEach(m => {
        m.categoryId = targetCat.id;
        count++;
    });
    saveDb();
    return {
        success: true,
        count,
        targetCategory: targetCat
    };
}

// Genel sekmesindeki (cat_11) medyaları diğer 10 kategoriye otomatik ve eşit olarak dağıt
function autoDistributeMedia(count = null, sourceCatId = 'cat_11') {
    const db = loadDb();
    const targetCats = (db.categories || defaultCategories).filter(c => c.id !== sourceCatId);
    if (targetCats.length === 0) return { success: false, message: 'Hedef sekme bulunamadı.' };

    const sourceMedia = (db.media || []).filter(m => m.categoryId === sourceCatId);
    if (sourceMedia.length === 0) return { success: true, count: 0, remaining: 0, message: 'Ayrıştırılacak medya kalmadı.' };

    const numToProcess = count ? Math.min(parseInt(count, 10), sourceMedia.length) : sourceMedia.length;
    const toProcess = sourceMedia.slice(0, numToProcess);
    let distributed = 0;

    toProcess.forEach((m, idx) => {
        const targetCat = targetCats[idx % targetCats.length];
        m.categoryId = targetCat.id;
        distributed++;
    });

    saveDb();
    return {
        success: true,
        count: distributed,
        remaining: sourceMedia.length - distributed,
        targetCategories: targetCats.map(c => c.name)
    };
}

// 👑 GEÇİCİ KRALLIK (VIP) SATIN ALMA (KREDİ İLE)
function buyVipWithCredits(userId, days = 3, creditCost = 25) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return { success: false, message: 'Kullanıcı bulunamadı.' };

    const totalCredits = (user.videoCredits || 0) + (user.photoCredits || 0);
    if (totalCredits < creditCost) {
        return { 
            success: false, 
            message: `Yetersiz kredi! ${days} Günlük Krallık için ${creditCost} kredi gereklidir. Mevcut toplam krediniz: ${totalCredits}` 
        };
    }

    // Kredilerden düş (önce video sonra foto)
    let remaining = creditCost;
    if ((user.videoCredits || 0) >= remaining) {
        user.videoCredits -= remaining;
        remaining = 0;
    } else {
        remaining -= (user.videoCredits || 0);
        user.videoCredits = 0;
        user.photoCredits = Math.max(0, (user.photoCredits || 0) - remaining);
    }

    const durationMs = days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const currentVipUntil = user.vipUntil && user.vipUntil > now ? user.vipUntil : now;
    user.vipUntil = currentVipUntil + durationMs;

    // Bonus 1 çark hakkı hediye
    user.wheelSpins = (user.wheelSpins || 0) + 1;

    saveDb();

    return {
        success: true,
        message: `👑 Tebrikler! ${days} Günlük Geçici Krallık (VIP) aktif edildi! +1 Çark Hediyesi eklendi.`,
        days,
        vipUntil: user.vipUntil,
        user: {
            videoCredits: user.videoCredits,
            photoCredits: user.photoCredits,
            wheelSpins: user.wheelSpins,
            isVip: true,
            vipUntil: user.vipUntil
        }
    };
}

// İstatistikler (Tek Geçiş)
function getStats() {
    const db = loadDb();
    const userList = Object.values(db.users || {});
    const totalUsers = userList.length;
    const now = Date.now();
    let vipUsers = 0;
    for (const u of userList) {
        if (u.vipUntil && u.vipUntil > now) vipUsers++;
    }

    const mediaList = db.media || [];
    let pendingMedia = 0;
    let approvedPhotos = 0;
    let approvedVideos = 0;
    let rejectedMedia = 0;

    for (const m of mediaList) {
        if (m.status === 'pending') {
            pendingMedia++;
        } else if (m.status === 'approved') {
            if (m.type === 'photo') approvedPhotos++;
            else if (m.type === 'video') approvedVideos++;
        } else if (m.status === 'rejected') {
            rejectedMedia++;
        }
    }

    return {
        totalUsers,
        vipUsers,
        totalMedia: mediaList.length,
        pendingMedia,
        approvedPhotos,
        approvedVideos,
        rejectedMedia
    };
}

// Tüm kullanıcı ID'leri (Duyuru için)
function getAllUserIds() {
    const db = loadDb();
    return Object.keys(db.users);
}

// Tüm kullanıcı objelerini getir
function getAllUsers() {
    const db = loadDb();
    return Object.values(db.users);
}

// Bir kullanıcının yüklediği aktif medyaları getir (resim / video)
function getUserMedia(userId, type = null) {
    const db = loadDb();
    const uid = String(userId);
    return db.media.filter(m => {
        if (String(m.uploadedBy) !== uid) return false;
        if (m.status === 'rejected') return false;
        if (type && m.type !== type) return false;
        return true;
    });
}

// Bir kullanıcının yüklediği aktif medya sayılarını getir
function getUserMediaCount(userId) {
    const db = loadDb();
    const uid = String(userId);
    let photos = 0;
    let videos = 0;
    for (const m of db.media) {
        if (String(m.uploadedBy) === uid && m.status !== 'rejected') {
            if (m.type === 'photo') photos++;
            else if (m.type === 'video') videos++;
        }
    }
    return { photos, videos, total: photos + videos };
}

module.exports = {
    loadDb,
    saveDb,
    getOrCreateUser,
    getUser,
    getAllUsers,
    getUserMedia,
    getUserMediaCount,
    isUserVip,
    addVipDays,
    updateCredits,
    addPendingMedia,
    findMediaByUniqueId,
    addWarning,
    banUser,
    unbanUser,
    unbanAllUsers,
    isUserBanned,
    getBannedUsers,
    approveMedia,
    rejectMedia,
    undoApproveMedia,
    undoRejectMedia,
    approveAllPending,
    rejectAllPending,
    getCategories,
    getCategory,
    updateCategoryName,
    getStarCategories,
    getCategoryCreditCost,
    isCategoryUploadEnabled,
    toggleCategoryUpload,
    updateCategoryPricing,
    addCategory,
    updateCategory,
    deleteCategory,
    setUserActiveCategory,
    getUserActiveCategory,
    getAllCategoryStats,
    getCategoryStats,
    getCategoryMedia,
    getUserCategoryUnseenCount,
    removeSeenMedia,
    getRandomMedia,
    reportMedia,
    getMedia,
    addMediaStars,
    rateMedia,
    changeMediaCategory,
    moveAllMediaToCategory,
    autoDistributeMedia,
    buyVipWithCredits,
    cancelUserVip,
    extendUserVipHour,
    modifyUserVip,
    getAllVipUsers,
    addApprovedMedia,
    findDuplicateMedia,
    findDuplicateMediaList,
    cleanDuplicateMedia,
    getDuplicateStats,
    deleteMedia,
    bulkDeleteMedia,
    getStats,
    getAllUserIds,
    isTransactionProcessed,
    markTransactionProcessed,
    getSettings,
    updateSettings,
    addWheelSpins,
    useWheelSpin,
    // Duyuru Panosu
    addAnnouncement,
    getAnnouncements,
    deleteAnnouncement,
    // Görüş ve Destek Sistemi
    addFeedback,
    getFeedbacks,
    markFeedbackReplied,
    // Günlük Giriş Ödülü
    getDailyRewardStatus,
    claimDailyReward,
    // Alınan Medyalar (Video & Fotoğraf)
    getUserReceivedVideos,
    getUserReceivedMedia,
    // ZIP Arşivleri (100 Yıldız - VIP Hariç)
    addZip,
    getAllZips,
    getZip,
    deleteZip,
    deleteAllZips,
    recordZipPurchase,
    getUserPurchasedZips,
    // Admin Kontrol Fonksiyonları
    getPendingMedia,
    getAdminStats,
    setUserCredits,
    isMediaDownloadUnlocked,
    unlockMediaDownload,
    getAllUsersDetailed,
    reportMediaWithReason,
    getReportedMediaList,
    dismissReportsForMedia,
    getAllUploadsWithUsers,
    ADMIN_IDS,
    SUPER_ADMIN_ID,
    isSuperAdmin,
    isAssistantAdmin,
    isAdminOrAssistant,
    getAssistantAdmins,
    addAssistantAdmin,
    removeAssistantAdmin,
    isAdminUser,
    autoHealUser,
    autoHealSystem,
    adminAdjustUserBalance,
    adminUndoUserAction,
    addUserNotification,
    getUserNotifications,
    markUserNotificationsRead,
    massDistributeRewards,
    undoLastMassReward
};

// ==========================================
// 📢 DUYURU PANOSU (ANNOUNCEMENTS) İŞLEMLERİ
// ==========================================

function addAnnouncement(title, body, authorId) {
    const db = loadDb();
    if (!Array.isArray(db.announcements)) db.announcements = [];
    const ann = {
        id: 'ann_' + Date.now(),
        title: title,
        body: body,
        authorId: String(authorId),
        createdAt: new Date().toISOString(),
        pinned: false
    };
    db.announcements.unshift(ann); // En yeni en üstte
    // Maksimum 20 duyuru tut
    if (db.announcements.length > 20) {
        db.announcements = db.announcements.slice(0, 20);
    }
    saveDb();
    return ann;
}

function getAnnouncements() {
    const db = loadDb();
    if (!Array.isArray(db.announcements)) db.announcements = [];
    return db.announcements;
}

function deleteAnnouncement(annId) {
    const db = loadDb();
    if (!Array.isArray(db.announcements)) return false;
    const idx = db.announcements.findIndex(a => a.id === annId);
    if (idx === -1) return false;
    db.announcements.splice(idx, 1);
    saveDb();
    return true;
}

// ==========================================
// 💬 GÖRÜŞ VE DESTEK / BİLDİRİM SİSTEMİ
// ==========================================

function addFeedback(feedbackData) {
    const db = loadDb();
    if (!Array.isArray(db.feedbacks)) db.feedbacks = [];
    const fb = {
        id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        userId: String(feedbackData.userId || ''),
        userName: feedbackData.userName || 'Kullanıcı',
        userUsername: feedbackData.userUsername || '',
        category: feedbackData.category || 'Genel',
        message: String(feedbackData.message || '').trim(),
        source: feedbackData.source || 'webapp',
        createdAt: new Date().toISOString(),
        replied: false,
        replyMessage: null,
        repliedAt: null
    };
    db.feedbacks.unshift(fb);
    // Maksimum 150 geri bildirim sakla
    if (db.feedbacks.length > 150) {
        db.feedbacks = db.feedbacks.slice(0, 150);
    }
    saveDb();
    return fb;
}

function getFeedbacks(limit = 50) {
    const db = loadDb();
    if (!Array.isArray(db.feedbacks)) db.feedbacks = [];
    return db.feedbacks.slice(0, limit);
}

function markFeedbackReplied(feedbackId, replyMessage) {
    const db = loadDb();
    if (!Array.isArray(db.feedbacks)) return false;
    const fb = db.feedbacks.find(f => f.id === feedbackId);
    if (!fb) return false;
    fb.replied = true;
    fb.replyMessage = replyMessage;
    fb.repliedAt = new Date().toISOString();
    saveDb();
    return true;
}

// ==========================================
// 🎁 GÜNLÜK GİRİŞ ÖDÜLÜ SİSTEMİ
// ==========================================

function getDailyRewardStatus(userId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    const cooldownMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (!user) {
        return {
            available: true,
            remainingMs: 0,
            streak: 0,
            nextStreak: 1,
            reward: { photoCredits: 1, videoCredits: 1, wheelSpins: 0 },
            lastDailyReward: 0,
            nextClaimTime: now
        };
    }

    const last = user.lastDailyReward || 0;
    const elapsed = now - last;
    const available = elapsed >= cooldownMs;
    const remainingMs = available ? 0 : (cooldownMs - elapsed);

    // Günlük streak kontrolü (48 saat içinde alınmazsa streak sıfırlanır)
    let streak = user.dailyStreak || 0;
    if (last > 0 && elapsed > (48 * 60 * 60 * 1000)) {
        streak = 0;
    }

    let nextStreak = streak + 1;
    let reward = { photoCredits: 1, videoCredits: 1, wheelSpins: 0 };
    if (nextStreak >= 7) {
        reward = { photoCredits: 5, videoCredits: 5, wheelSpins: 0 };
    } else if (nextStreak >= 3) {
        reward = { photoCredits: 2, videoCredits: 2, wheelSpins: 0 };
    }

    return {
        available,
        remainingMs,
        streak,
        nextStreak,
        reward,
        lastDailyReward: last,
        nextClaimTime: available ? now : (last + cooldownMs)
    };
}

function claimDailyReward(userId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) {
        return { success: false, message: 'Kullanıcı bulunamadı.' };
    }

    const status = getDailyRewardStatus(uid);
    if (!status.available) {
        return {
            success: false,
            message: 'Bugünkü ödülünüzü zaten aldınız.',
            remainingMs: status.remainingMs,
            nextClaimTime: status.nextClaimTime
        };
    }

    const now = Date.now();
    const reward = status.reward;

    user.photoCredits = (user.photoCredits || 0) + reward.photoCredits;
    user.videoCredits = (user.videoCredits || 0) + reward.videoCredits;
    user.wheelSpins = (user.wheelSpins || 0) + (reward.wheelSpins || 0);
    user.lastDailyReward = now;
    user.dailyStreak = status.nextStreak;

    saveDb();

    return {
        success: true,
        message: `Tebrikler! Günlük giriş ödülünüz tanımlandı: +${reward.photoCredits} Foto, +${reward.videoCredits} Video!`,
        reward,
        streak: user.dailyStreak,
        user: {
            photoCredits: user.photoCredits,
            videoCredits: user.videoCredits,
            wheelSpins: user.wheelSpins
        },
        nextClaimTime: now + (24 * 60 * 60 * 1000)
    };
}

// ==========================================
// 📦 KULLANICININ ALDIĞI MEDYALAR (VİDEO & FOTOĞRAF)
// ==========================================

function getUserReceivedMedia(userId, type = 'all', categoryId = 'all', options = {}) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    const seenIds = new Set(user?.seenMedia || []);
    const isSuper = isAdminUser(uid);

    const mediaList = db.media || [];
    const cats = db.categories || defaultCategories;
    const catMap = new Map(cats.map(c => [c.id, c]));
    const defaultCat = { name: 'Genel', key: 'K' };

    const matchedItems = [];
    let totalVideos = 0;
    let totalPhotos = 0;

    // Normal kullanıcılar kendi yüklediklerini görebilir; ancak Süper Adminin bota yüklediği 10.000+ medya
    // kişisel "Aldıklarım" kutusunu kilitlememesi için sadece bizzat aldığı/izlediği (seenMedia) gösterilir.
    for (let i = mediaList.length - 1; i >= 0; i--) {
        const m = mediaList[i];
        if (m.status !== 'approved') continue;
        const isSeen = seenIds.has(m.id);
        const isMyUpload = !isSuper && String(m.uploadedBy) === uid;
        if (!isSeen && !isMyUpload) continue;

        if (m.type === 'video') totalVideos++;
        if (m.type === 'photo') totalPhotos++;

        if (type === 'all' || m.type === type) {
            if (!categoryId || categoryId === 'all' || m.categoryId === categoryId) {
                matchedItems.push(m);
            }
        }
    }

    const total = matchedItems.length;
    const limit = options.limit !== undefined ? Math.max(1, parseInt(options.limit, 10) || 40) : 40;
    const offset = Math.max(0, parseInt(options.offset, 10) || 0);
    const paged = matchedItems.slice(offset, offset + limit);

    const items = paged.map(m => {
        const cat = catMap.get(m.categoryId) || defaultCat;
        return {
            id: m.id,
            type: m.type,
            categoryId: m.categoryId,
            categoryName: cat.name,
            categoryKey: cat.key,
            fileSize: m.fileSize || 0,
            isMyUpload: String(m.uploadedBy) === uid,
            isDownloadUnlocked: isMediaDownloadUnlocked(userId, m.id),
            createdAt: m.createdAt
        };
    });

    return {
        total,
        totalVideos,
        totalPhotos,
        hasMore: total > (offset + limit),
        offset,
        limit,
        items
    };
}

function getUserReceivedVideos(userId, categoryId = null) {
    const res = getUserReceivedMedia(userId, 'video', categoryId);
    return { total: res.total, videos: res.items };
}

// ==========================================
// 📦 ZIP ARŞİVİ YÖNETİMİ (100 YILDIZ - VIP HARİÇ)
// ==========================================

function addZip(title, description, fileId, fileSize, uploaderId) {
    const db = loadDb();
    if (!Array.isArray(db.zips)) db.zips = [];

    const bytes = fileSize || 0;
    let formattedSize = '0 MB';
    if (bytes >= 1024 * 1024 * 1024) {
        formattedSize = (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    } else if (bytes > 0) {
        formattedSize = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    const cleanName = (title || 'Özel ZIP Arşivi').trim();

    const newZip = {
        id: 'zip_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        title: cleanName,
        name: cleanName,
        description: description || `${cleanName} • ${formattedSize} Özel ZIP Paketi (100 Yıldız)`,
        fileId: fileId,
        fileSize: bytes,
        fileSizeFormatted: formattedSize,
        starsPrice: 100, // Daima 100 Yıldız!
        uploadedBy: String(uploaderId || '8633136500'),
        createdAt: new Date().toISOString()
    };

    db.zips.push(newZip);
    saveDb();
    return newZip;
}

function getAllZips() {
    const db = loadDb();
    return (db.zips || []).map(z => {
        const bytes = z.fileSize || 0;
        const formattedSize = z.fileSizeFormatted || (bytes >= 1024 * 1024 * 1024 
            ? (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' 
            : (bytes / (1024 * 1024)).toFixed(2) + ' MB');
        const name = z.name || z.title || 'Özel ZIP Arşivi';
        return {
            ...z,
            name,
            title: name,
            fileSizeFormatted: formattedSize
        };
    });
}

function getZip(zipId) {
    const db = loadDb();
    const z = (db.zips || []).find(x => x.id === zipId) || null;
    if (!z) return null;
    const bytes = z.fileSize || 0;
    const formattedSize = z.fileSizeFormatted || (bytes >= 1024 * 1024 * 1024 
        ? (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' 
        : (bytes / (1024 * 1024)).toFixed(2) + ' MB');
    const name = z.name || z.title || 'Özel ZIP Arşivi';
    return {
        ...z,
        name,
        title: name,
        fileSizeFormatted: formattedSize
    };
}

function deleteZip(zipId) {
    const db = loadDb();
    if (!Array.isArray(db.zips)) return false;
    const initialLen = db.zips.length;
    db.zips = db.zips.filter(z => z.id !== zipId);
    if (db.zips.length !== initialLen) {
        saveDb();
        return true;
    }
    return false;
}

function deleteAllZips() {
    const db = loadDb();
    const count = (db.zips || []).length;
    db.zips = [];
    saveDb();
    return count;
}

function recordZipPurchase(userId, zipId) {
    const db = loadDb();
    const uid = String(userId);
    let user = db.users[uid];
    if (!user) {
        user = getOrCreateUser({ id: uid, first_name: 'Kullanıcı' }).user;
    }
    if (!Array.isArray(user.purchasedZips)) user.purchasedZips = [];
    if (!user.purchasedZips.includes(zipId)) {
        user.purchasedZips.push(zipId);
        saveDb();
    }
    return user;
}

function getUserPurchasedZips(userId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    const purchased = new Set(user?.purchasedZips || []);
    return (db.zips || []).filter(z => purchased.has(z.id)).map(z => {
        const bytes = z.fileSize || 0;
        const formattedSize = z.fileSizeFormatted || (bytes >= 1024 * 1024 * 1024 
            ? (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' 
            : (bytes / (1024 * 1024)).toFixed(2) + ' MB');
        const name = z.name || z.title || 'Özel ZIP Arşivi';
        return {
            ...z,
            name,
            title: name,
            fileSizeFormatted: formattedSize
        };
    });
}

// ==========================================
// 👑 ADMİN KONTROL FONKSİYONLARI
// ==========================================

function getPendingMedia() {
    const db = loadDb();
    const cats = db.categories || defaultCategories;
    const catMap = new Map(cats.map(c => [c.id, c]));
    const defaultCat = { name: 'Genel', key: 'K' };
    const result = [];

    for (const m of (db.media || [])) {
        if (m.status !== 'pending') continue;
        const cat = catMap.get(m.categoryId) || defaultCat;
        const u = db.users[m.uploadedBy] || {};
        result.push({
            id: m.id,
            type: m.type,
            categoryId: m.categoryId,
            categoryName: cat.name,
            categoryKey: cat.key,
            fileSize: m.fileSize || 0,
            uploadedBy: m.uploadedBy,
            uploaderName: u.firstName ? (isAdminUser(m.uploadedBy) ? `${u.firstName} (Admin)` : u.firstName) : (isAdminUser(m.uploadedBy) ? 'Admin' : 'Kullanıcı'),
            uploaderUsername: u.username ? '@' + u.username.replace('@', '') : null,
            createdAt: m.createdAt
        });
    }

    return result;
}

function getAdminStats() {
    const now = Date.now();
    if (adminStatsCache && (now - adminStatsCacheTime < 3000)) {
        return adminStatsCache;
    }

    const db = loadDb();
    const users = Object.values(db.users || {});
    const media = db.media || [];
    const zips = db.zips || [];

    let approvedMedia = 0;
    let pendingMedia = 0;
    let rejectedMedia = 0;
    let totalVideos = 0;
    let totalPhotos = 0;

    for (const m of media) {
        if (m.status === 'approved') approvedMedia++;
        else if (m.status === 'pending') pendingMedia++;
        else if (m.status === 'rejected') rejectedMedia++;

        if (m.type === 'video') totalVideos++;
        else if (m.type === 'photo') totalPhotos++;
    }

    let vipUsers = 0;
    for (const u of users) {
        if (isUserVip(u.id).isVip) vipUsers++;
    }

    const result = {
        totalUsers: users.length,
        totalMedia: media.length,
        approvedMedia,
        pendingMedia,
        rejectedMedia,
        totalVideos,
        totalPhotos,
        totalZips: zips.length,
        vipUsers
    };

    adminStatsCache = result;
    adminStatsCacheTime = now;
    return result;
}

function setUserCredits(userId, videoCredits, photoCredits, isVip = false) {
    const db = loadDb();
    const uid = String(userId);
    let user = db.users[uid];
    if (!user) {
        user = getOrCreateUser({ id: uid, first_name: 'Kullanıcı' }).user;
    }
    if (videoCredits !== undefined && videoCredits !== null) user.videoCredits = parseInt(videoCredits, 10);
    if (photoCredits !== undefined && photoCredits !== null) user.photoCredits = parseInt(photoCredits, 10);
    if (isVip) {
        user.vipUntil = new Date(Date.now() + 36500 * 24 * 60 * 60 * 1000).toISOString();
    }
    saveDb();
    return user;
}

function isMediaDownloadUnlocked(userId, mediaId) {
    if (isAdminUser(userId) || isUserVip(userId).isVip) return true;
    const db = loadDb();
    if (!db.downloads) db.downloads = {};
    const uid = String(userId);
    return !!(db.downloads[uid] && db.downloads[uid][String(mediaId)]);
}

function unlockMediaDownload(userId, mediaId) {
    const db = loadDb();
    if (!db.downloads) db.downloads = {};
    const uid = String(userId);
    if (!db.downloads[uid]) db.downloads[uid] = {};
    db.downloads[uid][String(mediaId)] = Date.now();
    saveDb();
}

function getAllUsersDetailed() {
    const db = loadDb();
    const users = Object.values(db.users || {});
    const transactions = Array.isArray(db.transactionHistory) ? db.transactionHistory : [];
    
    const starsPerUser = new Map();
    transactions.forEach(t => {
        const uid = String(t.userId);
        const cur = starsPerUser.get(uid) || 0;
        starsPerUser.set(uid, cur + (Number(t.amount) || 0));
    });

    return users.map(u => {
        const uid = String(u.id);
        const vip = isUserVip(uid);
        let untilTs = 0;
        if (u.vipUntil) {
            untilTs = typeof u.vipUntil === 'string' ? new Date(u.vipUntil).getTime() : Number(u.vipUntil);
            if (isNaN(untilTs)) untilTs = 0;
        }
        const createdTs = u.createdAt ? new Date(u.createdAt).getTime() : 0;
        const totalStars = starsPerUser.get(uid) || 0;

        return {
            id: uid,
            user_id: uid,
            firstName: u.firstName || 'İsimsiz',
            first_name: u.firstName || 'İsimsiz',
            username: u.username || null,
            photoCredits: u.photoCredits || 0,
            photo_credits: u.photoCredits || 0,
            videoCredits: u.videoCredits || 0,
            video_credits: u.videoCredits || 0,
            wheelSpins: u.wheelSpins || 0,
            wheel_spins: u.wheelSpins || 0,
            isVip: vip.isVip,
            is_vip: vip.isVip,
            vipUntil: vip.until || (untilTs > 0 ? new Date(untilTs).toLocaleString('tr-TR') : null),
            vipUntilTimestamp: untilTs,
            isSuperAdmin: isSuperAdmin(uid),
            isAssistantAdmin: isAssistantAdmin(uid),
            isBanned: !!u.isBanned,
            is_banned: !!u.isBanned,
            bannedReason: u.bannedReason || null,
            uploadedPhotos: u.uploadedPhotos || 0,
            uploadedVideos: u.uploadedVideos || 0,
            receivedPhotos: u.receivedPhotos || 0,
            receivedVideos: u.receivedVideos || 0,
            totalStarsSpent: totalStars,
            boughtWithStars: totalStars > 0,
            createdAt: u.createdAt || new Date().toISOString(),
            created_at: u.createdAt || new Date().toISOString(),
            createdTimestamp: createdTs
        };
    }).sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
}

// ==========================================
// 🎁 ADMİN KULLANICI ÖDÜL & BAKİYE YÖNETİMİ + GERİ ALMA (UNDO)
// ==========================================
function adminAdjustUserBalance(targetUserId, changes = {}, reason = 'Yönetici İşlemi') {
    const db = loadDb();
    const uid = String(targetUserId);
    const user = db.users[uid];
    if (!user) return { success: false, message: 'Kullanıcı bulunamadı.' };

    if (!db.adminActionLogs) db.adminActionLogs = [];

    // Önceki durumu tam olarak kaydet (Geri alma / Undo için)
    const previousState = {
        photoCredits: user.photoCredits || 0,
        videoCredits: user.videoCredits || 0,
        wheelSpins: user.wheelSpins || 0,
        vipUntil: user.vipUntil || null
    };

    // 1. Fotoğraf Kredisi Değişikliği
    if (typeof changes.setPhotoCredits === 'number') {
        user.photoCredits = Math.max(0, changes.setPhotoCredits);
    } else if (typeof changes.photoCredits === 'number') {
        user.photoCredits = Math.max(0, (user.photoCredits || 0) + changes.photoCredits);
    }

    // 2. Video Kredisi Değişikliği
    if (typeof changes.setVideoCredits === 'number') {
        user.videoCredits = Math.max(0, changes.setVideoCredits);
    } else if (typeof changes.videoCredits === 'number') {
        user.videoCredits = Math.max(0, (user.videoCredits || 0) + changes.videoCredits);
    }

    // 3. Çark Hakkı Değişikliği
    if (typeof changes.setWheelSpins === 'number') {
        user.wheelSpins = Math.max(0, changes.setWheelSpins);
    } else if (typeof changes.wheelSpins === 'number') {
        user.wheelSpins = Math.max(0, (user.wheelSpins || 0) + changes.wheelSpins);
    }

    // 4. VIP Günleri / Kaldırma
    if (changes.removeVip) {
        user.vipUntil = null;
    } else if (typeof changes.vipDays === 'number') {
        const now = Date.now();
        const currentVip = user.vipUntil ? new Date(user.vipUntil).getTime() : now;
        const base = currentVip > now ? currentVip : now;
        const newVip = base + (changes.vipDays * 24 * 60 * 60 * 1000);
        if (changes.vipDays < 0 && newVip <= now) {
            user.vipUntil = null;
        } else {
            user.vipUntil = new Date(newVip).toISOString();
        }
    }

    const logEntry = {
        id: 'act_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        targetUserId: uid,
        reason,
        changes,
        previousState,
        newState: {
            photoCredits: user.photoCredits,
            videoCredits: user.videoCredits,
            wheelSpins: user.wheelSpins,
            vipUntil: user.vipUntil
        },
        timestamp: new Date().toISOString()
    };

    db.adminActionLogs.push(logEntry);
    if (db.adminActionLogs.length > 200) {
        db.adminActionLogs = db.adminActionLogs.slice(-200);
    }

    saveDb();
    const vipStatus = isUserVip(uid);
    return {
        success: true,
        user: {
            id: uid,
            firstName: user.firstName,
            username: user.username,
            photoCredits: user.photoCredits,
            videoCredits: user.videoCredits,
            wheelSpins: user.wheelSpins,
            isVip: vipStatus.isVip,
            vipUntil: vipStatus.until
        },
        action: logEntry
    };
}

// ↩️ Kullanıcının Son İşlemini Geri Al (Undo)
function adminUndoUserAction(targetUserId) {
    const db = loadDb();
    const uid = String(targetUserId);
    const user = db.users[uid];
    if (!user) return { success: false, message: 'Kullanıcı bulunamadı.' };

    if (!Array.isArray(db.adminActionLogs) || db.adminActionLogs.length === 0) {
        return { success: false, message: 'Geri alınacak bir işlem bulunamadı.' };
    }

    // Bu kullanıcıya ait en son işlemi bul
    let actionIndex = -1;
    for (let i = db.adminActionLogs.length - 1; i >= 0; i--) {
        if (String(db.adminActionLogs[i].targetUserId) === uid) {
            actionIndex = i;
            break;
        }
    }

    if (actionIndex === -1) {
        return { success: false, message: 'Bu kullanıcı için geri alınabilecek son bir işlem kaydı yok.' };
    }

    const lastAction = db.adminActionLogs[actionIndex];
    const prev = lastAction.previousState;

    user.photoCredits = prev.photoCredits;
    user.videoCredits = prev.videoCredits;
    user.wheelSpins = prev.wheelSpins;
    user.vipUntil = prev.vipUntil;

    // Logdan kaldır
    db.adminActionLogs.splice(actionIndex, 1);
    saveDb();

    const vipStatus = isUserVip(uid);
    return {
        success: true,
        message: 'Son yapılan işlem başarıyla geri alındı ve önceki bakiyeler yüklendi.',
        user: {
            id: uid,
            firstName: user.firstName,
            username: user.username,
            photoCredits: user.photoCredits,
            videoCredits: user.videoCredits,
            wheelSpins: user.wheelSpins,
            isVip: vipStatus.isVip,
            vipUntil: vipStatus.until
        },
        restoredState: prev
    };
}

// ==========================================
// 💬 UYGULAMA İÇİ DOĞRUDAN MESAJLAŞMA SİSTEMİ
// ==========================================
function addUserNotification(targetUserId, { title = 'Yönetici Mesajı', text, sender = 'Yönetici' }) {
    const db = loadDb();
    const uid = String(targetUserId);
    if (!db.userMessages) db.userMessages = {};
    if (!db.userMessages[uid]) db.userMessages[uid] = [];

    const msg = {
        id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        title,
        text,
        sender,
        read: false,
        createdAt: new Date().toISOString()
    };

    db.userMessages[uid].unshift(msg);
    if (db.userMessages[uid].length > 50) {
        db.userMessages[uid] = db.userMessages[uid].slice(0, 50);
    }

    saveDb();
    return msg;
}

function getUserNotifications(userId) {
    const db = loadDb();
    const uid = String(userId);
    const msgs = (db.userMessages && db.userMessages[uid]) ? db.userMessages[uid] : [];
    const unreadCount = msgs.filter(m => !m.read).length;
    return { messages: msgs, unreadCount };
}

function markUserNotificationsRead(userId) {
    const db = loadDb();
    const uid = String(userId);
    if (db.userMessages && db.userMessages[uid]) {
        db.userMessages[uid].forEach(m => { m.read = true; });
        saveDb();
    }
    return { success: true };
}

function reportMediaWithReason(mediaId, reporterUserId, reason = 'Genel Şikayet') {
    const db = loadDb();
    if (!db.reports) db.reports = [];
    const rep = {
        id: 'rep_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        mediaId: String(mediaId),
        reporterUserId: String(reporterUserId),
        reason: reason,
        createdAt: new Date().toISOString()
    };
    db.reports.push(rep);
    
    // Medya rapor sayısını artır
    const media = (db.media || []).find(m => String(m.id) === String(mediaId));
    if (media) {
        media.reports = (media.reports || 0) + 1;
    }
    saveDb();
    return rep;
}

function getReportedMediaList() {
    const db = loadDb();
    const reports = db.reports || [];
    const cats = db.categories || defaultCategories;
    const mediaList = db.media || [];

    const map = new Map();
    for (const r of reports) {
        const mid = String(r.mediaId);
        if (!map.has(mid)) map.set(mid, []);
        map.get(mid).push(r);
    }

    const result = [];
    for (const [mid, repList] of map.entries()) {
        const m = mediaList.find(x => String(x.id) === mid);
        if (!m) continue;
        const cat = cats.find(c => c.id === m.categoryId) || { name: 'Genel', key: 'K' };
        const uploader = db.users[m.uploadedBy] || {};

        result.push({
            id: m.id,
            type: m.type,
            fileId: m.fileId,
            fileSize: m.fileSize || 0,
            categoryId: m.categoryId,
            categoryName: cat.name,
            categoryKey: cat.key,
            uploadedBy: m.uploadedBy,
            uploaderName: uploader.firstName ? (isAdminUser(m.uploadedBy) ? `${uploader.firstName} (Admin)` : uploader.firstName) : (isAdminUser(m.uploadedBy) ? 'Admin' : 'Kullanıcı'),
            uploaderUsername: uploader.username ? `@${uploader.username.replace('@', '')}` : null,
            totalReports: repList.length,
            reports: repList.map(r => {
                const repUser = db.users[r.reporterUserId] || {};
                return {
                    id: r.id,
                    reporterUserId: r.reporterUserId,
                    reporterName: repUser.firstName ? (isAdminUser(r.reporterUserId) ? `${repUser.firstName} (Admin)` : repUser.firstName) : (isAdminUser(r.reporterUserId) ? 'Admin' : 'Kullanıcı'),
                    reporterUsername: repUser.username ? `@${repUser.username.replace('@', '')}` : null,
                    reason: r.reason || 'Genel Şikayet',
                    createdAt: r.createdAt
                };
            }),
            createdAt: m.createdAt
        });
    }

    // En çok raporlanan en üstte
    result.sort((a, b) => b.totalReports - a.totalReports);
    return result;
}

function dismissReportsForMedia(mediaId) {
    const db = loadDb();
    const mid = String(mediaId);
    if (Array.isArray(db.reports)) {
        db.reports = db.reports.filter(r => String(r.mediaId) !== mid);
    }
    const m = (db.media || []).find(x => String(x.id) === mid);
    if (m) {
        m.reports = 0;
        m.reporters = [];
    }
    saveDb();
    return true;
}

function getAllUploadsWithUsers(limit = 150) {
    const db = loadDb();
    const cats = db.categories || defaultCategories;
    const catMap = new Map(cats.map(c => [c.id, c]));
    const defaultCat = { name: 'Genel', key: 'K' };
    const media = db.media || [];
    const result = [];
    const max = Math.min(media.length, limit);

    for (let i = media.length - 1; i >= 0 && result.length < max; i--) {
        const m = media[i];
        const cat = catMap.get(m.categoryId) || defaultCat;
        const u = db.users[m.uploadedBy] || {};
        result.push({
            id: m.id,
            type: m.type,
            categoryId: m.categoryId,
            categoryName: cat.name,
            categoryKey: cat.key,
            fileSize: m.fileSize || 0,
            status: m.status || 'approved',
            uploadedBy: m.uploadedBy,
            uploaderName: u.firstName ? (isAdminUser(m.uploadedBy) ? `${u.firstName} (Admin)` : u.firstName) : (isAdminUser(m.uploadedBy) ? 'Admin' : 'Kullanıcı'),
            uploaderUsername: u.username ? `@${u.username.replace('@', '')}` : null,
            reports: m.reports || 0,
            createdAt: m.createdAt
        });
    }

    return result;
}

// ==========================================
// 🤖 NOVA AI • OTOMATİK KULLANICI HATA TEŞHİS & KENDİ KENDİNİ ONARMA MOTORU
// ==========================================
function autoHealUser(userId) {
    const db = loadDb();
    const uid = String(userId);
    let user = db.users[uid];
    if (!user) {
        user = getOrCreateUser({ id: uid, first_name: 'Kullanıcı' }).user;
    }

    const fixes = [];
    const now = Date.now();

    // 1. Kredi Bütünlüğü Kontrolü ve Onarımı
    if (typeof user.videoCredits !== 'number' || isNaN(user.videoCredits) || user.videoCredits < 0) {
        user.videoCredits = Math.max(0, parseInt(user.videoCredits, 10) || 0);
        fixes.push('Video kredisi sayı formatı ve negatif bakiye düzeltildi.');
    }
    if (typeof user.photoCredits !== 'number' || isNaN(user.photoCredits) || user.photoCredits < 0) {
        user.photoCredits = Math.max(0, parseInt(user.photoCredits, 10) || 0);
        fixes.push('Fotoğraf kredisi sayı formatı ve negatif bakiye düzeltildi.');
    }
    if (typeof user.wheelSpins !== 'number' || isNaN(user.wheelSpins) || user.wheelSpins < 0) {
        user.wheelSpins = Math.max(0, parseInt(user.wheelSpins, 10) || 0);
        fixes.push('Şans çarkı hakları senkronize edildi.');
    }

    // 2. VIP / Krallık Durumu Doğrulaması
    if (user.vipUntil) {
        const vipTime = typeof user.vipUntil === 'string' ? new Date(user.vipUntil).getTime() : Number(user.vipUntil);
        if (vipTime <= now) {
            user.vipUntil = null;
            fixes.push('Süresi dolmuş eski VIP durumu temizlendi.');
        }
    }

    // 3. Alınan Medyalar (Received) Doğrulaması & Ölü Kayıt Temizliği
    if (!db.received) db.received = {};
    const validMediaMap = new Map((db.media || []).map(m => [String(m.id), m]));
    let userReceived = db.received[uid] || [];
    let initialCount = userReceived.length;
    
    let cleanedReceived = userReceived.filter(item => {
        const mId = typeof item === 'object' && item ? String(item.id) : String(item);
        return validMediaMap.has(mId);
    });

    if (cleanedReceived.length !== initialCount) {
        db.received[uid] = cleanedReceived;
        fixes.push(`${initialCount - cleanedReceived.length} adet silinmiş/geçersiz medya referansı temizlendi.`);
    }

    // 4. İndirme Kilitleri (Downloads) Doğrulaması
    if (!db.downloads) db.downloads = {};
    if (db.downloads[uid]) {
        let deadDownloadCount = 0;
        for (const mId of Object.keys(db.downloads[uid])) {
            if (!validMediaMap.has(mId)) {
                delete db.downloads[uid][mId];
                deadDownloadCount++;
            }
        }
        if (deadDownloadCount > 0) {
            fixes.push(`${deadDownloadCount} adet artık indirme referansı temizlendi.`);
        }
    }

    // 5. İlerleme sayacı senkronizasyonu (2 Yükle 1 Al: 0 veya 1 döngüsü)
    user.photoProgress = (user.uploadedPhotos || 0) % 2;
    user.videoProgress = (user.uploadedVideos || 0) % 2;

    if (fixes.length > 0) {
        saveDb();
    }

    const vipStatus = isUserVip(uid);
    return {
        healthy: fixes.length === 0,
        fixedCount: fixes.length,
        fixes: fixes,
        user: {
            id: uid,
            firstName: user.firstName,
            username: user.username,
            videoCredits: user.videoCredits || 0,
            photoCredits: user.photoCredits || 0,
            wheelSpins: user.wheelSpins || 0,
            isVip: vipStatus.isVip,
            vipUntil: vipStatus.until,
            receivedCount: (db.received[uid] || []).length
        }
    };
}

// ==========================================
// 🤖 NOVA AI • SİSTEMSEL VERİTABANI VE 2,146 MEDYA GENEL BAKIM & ONARIM (ADMIN)
// ==========================================
function autoHealSystem() {
    const db = loadDb();
    const media = db.media || [];
    const users = db.users || {};
    const fixes = [];
    let repairedMedia = 0;
    let repairedUsers = 0;

    const validCatIds = new Set((db.categories || defaultCategories).map(c => c.id));

    // 1. Medyaları tara
    media.forEach((m, idx) => {
        let changed = false;
        if (!m.categoryId || !validCatIds.has(m.categoryId)) {
            m.categoryId = 'cat_11'; // Genel
            changed = true;
        }
        if (!m.orderIndex) {
            m.orderIndex = idx + 1;
            changed = true;
        }
        if (!m.status) {
            m.status = 'approved';
            changed = true;
        }
        if (changed) repairedMedia++;
    });

    if (repairedMedia > 0) {
        fixes.push(`${repairedMedia} adet medyanın kategori ve indeks kaydı düzeltildi.`);
    }

    // 2. Kullanıcıları tara
    for (const [uid, u] of Object.entries(users)) {
        let userFixed = false;
        if (typeof u.videoCredits !== 'number' || u.videoCredits < 0) {
            u.videoCredits = Math.max(0, parseInt(u.videoCredits, 10) || 0);
            userFixed = true;
        }
        if (typeof u.photoCredits !== 'number' || u.photoCredits < 0) {
            u.photoCredits = Math.max(0, parseInt(u.photoCredits, 10) || 0);
            userFixed = true;
        }
        if (typeof u.wheelSpins !== 'number' || u.wheelSpins < 0) {
            u.wheelSpins = Math.max(0, parseInt(u.wheelSpins, 10) || 0);
            userFixed = true;
        }
        if (userFixed) repairedUsers++;
    }

    if (repairedUsers > 0) {
        fixes.push(`${repairedUsers} adet kullanıcının bakiye tutarsızlığı onarıldı.`);
    }

    if (repairedMedia > 0 || repairedUsers > 0) {
        saveDb();
    }

    return {
        healthy: fixes.length === 0,
        totalMedia: media.length,
        totalUsers: Object.keys(users).length,
        repairedMedia,
        repairedUsers,
        fixes
    };
}

// ==========================================
// 🎁 TOPLU HERKESE ÖDÜL DAĞITMA SİSTEMİ & GERİ ALMA (UNDO)
// ==========================================
function massDistributeRewards({ videoCredits = 0, photoCredits = 0, wheelSpins = 0, vipDays = 0, messageTitle = '🎁 Toplu Yönetici Hediyesi!', messageText = '' }) {
    const db = loadDb();
    const users = db.users || {};
    const affectedUserIds = [];
    const previousStates = {};

    const vCred = parseInt(videoCredits, 10) || 0;
    const pCred = parseInt(photoCredits, 10) || 0;
    const spins = parseInt(wheelSpins, 10) || 0;
    const vDays = parseInt(vipDays, 10) || 0;

    const now = Date.now();
    for (const [uid, user] of Object.entries(users)) {
        previousStates[uid] = {
            photoCredits: user.photoCredits || 0,
            videoCredits: user.videoCredits || 0,
            wheelSpins: user.wheelSpins || 0,
            vipUntil: user.vipUntil || null
        };

        if (pCred !== 0) user.photoCredits = Math.max(0, (user.photoCredits || 0) + pCred);
        if (vCred !== 0) user.videoCredits = Math.max(0, (user.videoCredits || 0) + vCred);
        if (spins !== 0) user.wheelSpins = Math.max(0, (user.wheelSpins || 0) + spins);

        if (vDays > 0) {
            const currentVip = user.vipUntil ? new Date(user.vipUntil).getTime() : now;
            const base = currentVip > now ? currentVip : now;
            user.vipUntil = new Date(base + (vDays * 24 * 60 * 60 * 1000)).toISOString();
        }

        // Uygulama içi bildirim ekle
        if (!db.userMessages) db.userMessages = {};
        if (!db.userMessages[uid]) db.userMessages[uid] = [];

        const rewardSummary = [];
        if (vCred > 0) rewardSummary.push(`🎥 +${vCred} Video Kredisi`);
        if (pCred > 0) rewardSummary.push(`📸 +${pCred} Resim Kredisi`);
        if (spins > 0) rewardSummary.push(`🎡 +${spins} Şans Çarkı`);
        if (vDays > 0) rewardSummary.push(`👑 +${vDays} Gün VIP`);

        const defaultBody = `Yönetici tüm kullanıcılara hediye dağıttı!\n\nTanımlanan Hediyeler:\n${rewardSummary.join('\n')}\n\nKeyifli kullanımlar dileriz!`;

        db.userMessages[uid].unshift({
            id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            title: messageTitle || '🎁 Toplu Yönetici Hediyesi!',
            text: messageText ? `${messageText}\n\n${rewardSummary.join('\n')}` : defaultBody,
            sender: 'Yönetici',
            read: false,
            createdAt: new Date().toISOString()
        });

        affectedUserIds.push(uid);
    }

    const logEntry = {
        id: 'mass_' + Date.now(),
        timestamp: new Date().toISOString(),
        rewards: { videoCredits: vCred, photoCredits: pCred, wheelSpins: spins, vipDays: vDays },
        previousStates,
        totalUsers: affectedUserIds.length
    };

    if (!db.massRewardLogs) db.massRewardLogs = [];
    db.massRewardLogs.push(logEntry);
    if (db.massRewardLogs.length > 20) db.massRewardLogs = db.massRewardLogs.slice(-20);

    saveDb();
    return {
        success: true,
        affectedCount: affectedUserIds.length,
        rewards: { videoCredits: vCred, photoCredits: pCred, wheelSpins: spins, vipDays: vDays },
        logId: logEntry.id
    };
}

function undoLastMassReward() {
    const db = loadDb();
    if (!Array.isArray(db.massRewardLogs) || db.massRewardLogs.length === 0) {
        return { success: false, message: 'Geri alınacak bir toplu dağıtım işlemi bulunamadı.' };
    }

    const lastLog = db.massRewardLogs.pop();
    const prevStates = lastLog.previousStates || {};

    let restoredCount = 0;
    for (const [uid, prevState] of Object.entries(prevStates)) {
        const user = db.users[uid];
        if (user) {
            user.photoCredits = prevState.photoCredits;
            user.videoCredits = prevState.videoCredits;
            user.wheelSpins = prevState.wheelSpins;
            user.vipUntil = prevState.vipUntil;
            restoredCount++;
        }
    }

    saveDb();
    return {
        success: true,
        message: `Son yapılan toplu ödül dağıtımı geri alındı! (${restoredCount} kullanıcının bakiyesi eski haline döndürüldü)`,
        restoredCount
    };
}

// ==========================================
// 🛡️ YARDIMCI ADMİN (ASSISTANT ADMIN) SİSTEMİ
// ==========================================

function getAssistantAdmins() {
    const db = loadDb();
    if (!Array.isArray(db.assistantAdmins)) db.assistantAdmins = [];
    return db.assistantAdmins;
}

function addAssistantAdmin(targetUserId, requesterId, notes = {}) {
    const db = loadDb();
    if (!isAdminUser(requesterId)) {
        return { success: false, message: 'Yalnızca Yöneticiler yardımcı admin atayabilir.' };
    }
    const tid = String(targetUserId || '').trim();
    if (!tid) {
        return { success: false, message: 'Geçersiz Kullanıcı ID.' };
    }
    if (isSuperAdmin(tid)) {
        return { success: false, message: 'Ana yönetici zaten kurucudur, yardımcı admin yapılamaz.' };
    }
    if (!Array.isArray(db.assistantAdmins)) db.assistantAdmins = [];
    if (db.assistantAdmins.some(a => String(a.userId) === tid)) {
        return { success: false, message: 'Bu kullanıcı zaten Yardımcı Admin olarak kayıtlı.' };
    }

    const targetUser = db.users[tid];
    const newAdmin = {
        userId: tid,
        name: (targetUser && (targetUser.firstName || targetUser.first_name)) || notes.name || `Kullanıcı #${tid}`,
        username: (targetUser && targetUser.username) || notes.username || '',
        addedAt: new Date().toISOString(),
        addedBy: String(requesterId)
    };

    db.assistantAdmins.push(newAdmin);
    if (targetUser) {
        targetUser.isAssistantAdmin = true;
    }
    saveDb();
    return { success: true, assistantAdmin: newAdmin, message: `ID: ${tid} başarıyla Yardımcı Admin olarak atandı!` };
}

function removeAssistantAdmin(targetUserId, requesterId) {
    const db = loadDb();
    if (!isAdminUser(requesterId)) {
        return { success: false, message: 'Yalnızca Yöneticiler yetki geri alabilir.' };
    }
    const tid = String(targetUserId || '').trim();
    if (!tid) {
        return { success: false, message: 'Geçersiz Kullanıcı ID.' };
    }
    if (isSuperAdmin(tid)) {
        return { success: false, message: 'Ana yöneticinin (Kurucu) yetkisi geri alınamaz.' };
    }
    if (!Array.isArray(db.assistantAdmins)) db.assistantAdmins = [];
    const beforeCount = db.assistantAdmins.length;
    db.assistantAdmins = db.assistantAdmins.filter(a => String(a.userId || a.id || a) !== tid);
    const removedFromList = db.assistantAdmins.length < beforeCount;

    let removedFromUser = false;
    if (db.users && db.users[tid] && db.users[tid].isAssistantAdmin) {
        db.users[tid].isAssistantAdmin = false;
        removedFromUser = true;
    }

    if (!removedFromList && !removedFromUser) {
        return { success: false, message: 'Bu kullanıcı yardımcı admin listesinde bulunamadı.' };
    }

    saveDb();
    return { success: true, message: `ID: ${tid} kullanıcısının Yardımcı Admin yetkisi başarıyla geri alındı!` };
}


