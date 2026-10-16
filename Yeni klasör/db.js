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

const ADMIN_IDS = ['8633136500'];

function isAdminUser(userId) {
    if (!userId) return false;
    return String(userId) === '8633136500';
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
                if (u.photoProgress === undefined) u.photoProgress = 0;
                if (u.videoProgress === undefined) u.videoProgress = 0;
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

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2), 'utf-8');
    } catch (err) {
        console.error('Veritabanı kaydetme hatası:', err);
    }
}

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
        return { isVip: true, isUnlimited: true, remainingHours: 999999, until: 'Sınırsız (Admin/Yönetici)' };
    }
    const db = loadDb();
    const user = db.users[String(userId)];
    if (!user || !user.vipUntil) return { isVip: false, isUnlimited: false, remainingHours: 0 };
    
    const now = Date.now();
    if (user.vipUntil > now) {
        const remainingHours = Math.ceil((user.vipUntil - now) / (1000 * 60 * 60));
        return { isVip: true, isUnlimited: false, remainingHours, until: new Date(user.vipUntil).toLocaleString('tr-TR') };
    }
    return { isVip: false, isUnlimited: false, remainingHours: 0 };
}

// VIP Tanımla
function addVipDays(userId, days) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return null;

    const durationMs = days * 24 * 60 * 60 * 1000;
    const now = Date.now();

    if (user.vipUntil && user.vipUntil > now) {
        user.vipUntil += durationMs; // Mevcut sürenin üzerine ekle
    } else {
        user.vipUntil = now + durationMs;
    }

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
    const initialCount = db.media.length;

    const filteredMedia = [];
    const deletedItems = [];

    for (const item of db.media) {
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
        } else if (item.fileSize && seenMediaSizes.has(sizeKey)) {
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
            if (item.fileSize) seenMediaSizes.set(sizeKey, item);
            filteredMedia.push(item);
        }
    }

    db.media = filteredMedia;

    // Silinen medyaları kullanıcıların seenMedia listelerinden de temizle
    const deletedIds = new Set(deletedItems.map(d => d.id));
    if (db.users) {
        for (const uid in db.users) {
            const u = db.users[uid];
            if (Array.isArray(u.seenMedia)) {
                u.seenMedia = u.seenMedia.filter(mid => !deletedIds.has(mid));
            }
        }
    }

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

// Medyayı tamamen sil
function deleteMedia(mediaId) {
    const db = loadDb();
    const idx = db.media.findIndex(m => m.id === mediaId);
    if (idx === -1) return { success: false, message: 'Medya bulunamadı.' };
    const [deleted] = db.media.splice(idx, 1);
    saveDb();
    return { success: true, media: deleted };
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

// Medyayı onayla
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

    if (user) {
        if (item.type === 'photo') {
            user.uploadedPhotos = (user.uploadedPhotos || 0) + 1;
            user.photoCredits = (user.photoCredits || 0) + 1;
            creditAwarded = true;
        } else if (item.type === 'video') {
            user.uploadedVideos = (user.uploadedVideos || 0) + 1;
            user.videoCredits = (user.videoCredits || 0) + 1;
            creditAwarded = true;
        }

        // Onaylanan medyasını kullanıcının kendi arşivinde (Aldıklarım) görebilmesi için seenMedia'ya ekle
        if (!Array.isArray(user.seenMedia)) user.seenMedia = [];
        if (!user.seenMedia.includes(item.id)) {
            user.seenMedia.push(item.id);
        }
    }

    saveDb();
    return { success: true, media: item, user, creditAwarded };
}

// Medyayı reddet
function rejectMedia(mediaId) {
    const db = loadDb();
    const item = db.media.find(m => m.id === mediaId);
    if (!item) return { success: false, message: 'Medya bulunamadı.' };

    item.status = 'rejected';
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

// Kategori istatistikleri
function getCategoryStats(catId) {
    const db = loadDb();
    const approvedPhotos = db.media.filter(m => m.status === 'approved' && m.type === 'photo' && m.categoryId === catId).length;
    const approvedVideos = db.media.filter(m => m.status === 'approved' && m.type === 'video' && m.categoryId === catId).length;
    const pendingMedia = db.media.filter(m => m.status === 'pending' && m.categoryId === catId).length;
    return { approvedPhotos, approvedVideos, pendingMedia, total: approvedPhotos + approvedVideos };
}

// Kategoriye ait onaylı medyaları getir
function getCategoryMedia(catId, type = null) {
    const db = loadDb();
    return db.media.filter(m => m.categoryId === catId && m.status === 'approved' && (!type || m.type === type));
}

// Kullanıcının bu sekmede henüz almadığı (görmediği) medya sayıları
function getUserCategoryUnseenCount(userId, catId) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    const seenList = user?.seenMedia || [];

    const unseenPhotos = db.media.filter(m => 
        m.status === 'approved' && 
        m.type === 'photo' && 
        m.categoryId === catId && 
        !seenList.includes(m.id)
    ).length;

    const unseenVideos = db.media.filter(m => 
        m.status === 'approved' && 
        m.type === 'video' && 
        m.categoryId === catId && 
        !seenList.includes(m.id)
    ).length;

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

// Rastgele medya al (İsteğe bağlı Kategoriye göre)
function getRandomMedia(userId, type, categoryId = null, skipCreditDeduct = false) {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    if (!user) return null;

    const seenList = user.seenMedia || [];

    // Özel sekmeler (İfsa ve Onlyfans) genel havuzdan rastgele çekilemez
    const isExcludedFromGeneral = (m) => (!categoryId && (m.categoryId === 'cat_3' || m.categoryId === 'cat_5'));

    // KESİN KURAL 1: Kullanıcının gördüğü medyalar ASLA tekrar gönderilemez (!seenList.includes(m.id))
    // Başka kullanıcıların yüklediği, onaylı ve henüz görülmemiş medyalar:
    let eligible = db.media.filter(m => 
        m.status === 'approved' &&
        m.type === type &&
        m.uploadedBy !== uid &&
        !seenList.includes(m.id) &&
        (!categoryId ? !isExcludedFromGeneral(m) : m.categoryId === categoryId)
    );

    // Eğer havuzda başka kullanıcının medyası kalmadıysa, sistemdeki diğer onaylı ama HENÜZ GÖRÜLMEMİŞ medyalar:
    if (eligible.length === 0) {
        eligible = db.media.filter(m => 
            m.status === 'approved' && 
            m.type === type &&
            !seenList.includes(m.id) &&
            (!categoryId ? !isExcludedFromGeneral(m) : m.categoryId === categoryId)
        );
    }

    // Eğer henüz görülmemiş medya kalmadıysa KESİNLİKLE null dön (Aynı medya ASLA tekrar gönderilmez!)
    if (eligible.length === 0) {
        return null;
    }

    const randomIndex = Math.floor(Math.random() * eligible.length);
    const selected = eligible[randomIndex];

    // Görülenler listesine ekle - Bir daha asla bu kullanıcıya gönderilemez!
    if (!user.seenMedia) user.seenMedia = [];
    if (!user.seenMedia.includes(selected.id)) {
        user.seenMedia.push(selected.id);
    }

    // SAYIDAN DÜŞME: VIP üyeliği yoksa ve skipCreditDeduct false ise 1 kredi düşülür
    const vipStatus = isUserVip(uid);
    if (!vipStatus.isVip && !skipCreditDeduct) {
        if (type === 'photo') {
            user.photoCredits = Math.max(0, (user.photoCredits || 0) - 1);
            user.receivedPhotos = (user.receivedPhotos || 0) + 1;
        } else if (type === 'video') {
            user.videoCredits = Math.max(0, (user.videoCredits || 0) - 1);
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

// Medyayı ID ile getir
function getMedia(mediaId) {
    const db = loadDb();
    return db.media.find(m => m.id === mediaId) || null;
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
    saveDb();
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

// İstatistikler
function getStats() {
    const db = loadDb();
    const totalUsers = Object.keys(db.users).length;
    const now = Date.now();
    const vipUsers = Object.values(db.users).filter(u => u.vipUntil && u.vipUntil > now).length;
    const totalMedia = db.media.length;
    const pendingMedia = db.media.filter(m => m.status === 'pending').length;
    const approvedPhotos = db.media.filter(m => m.status === 'approved' && m.type === 'photo').length;
    const approvedVideos = db.media.filter(m => m.status === 'approved' && m.type === 'video').length;
    const rejectedMedia = db.media.filter(m => m.status === 'rejected').length;

    return {
        totalUsers,
        vipUsers,
        totalMedia,
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
    approveAllPending,
    rejectAllPending,
    getCategories,
    getCategory,
    updateCategoryName,
    setUserActiveCategory,
    getUserActiveCategory,
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
    buyVipWithCredits,
    addApprovedMedia,
    findDuplicateMedia,
    findDuplicateMediaList,
    cleanDuplicateMedia,
    deleteMedia,
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
    isAdminUser,
    autoHealUser,
    autoHealSystem
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

function getUserReceivedMedia(userId, type = 'all', categoryId = 'all') {
    const db = loadDb();
    const uid = String(userId);
    const user = db.users[uid];
    const seenIds = new Set(user?.seenMedia || []);

    const mediaList = db.media || [];
    const items = [];
    let totalVideos = 0;
    let totalPhotos = 0;
    const cats = db.categories || defaultCategories;

    // Kullanıcının gördüğü/aldığı veya bizzat yüklediği onaylı medyaları listele
    for (let i = mediaList.length - 1; i >= 0; i--) {
        const m = mediaList[i];
        if (m.status === 'approved' && (seenIds.has(m.id) || String(m.uploadedBy) === uid)) {
            if (m.type === 'video') totalVideos++;
            if (m.type === 'photo') totalPhotos++;

            if (type === 'all' || m.type === type) {
                if (!categoryId || categoryId === 'all' || m.categoryId === categoryId) {
                    const cat = cats.find(c => c.id === m.categoryId) || { name: 'Genel', key: 'K' };
                    items.push({
                        id: m.id,
                        type: m.type,
                        categoryId: m.categoryId,
                        categoryName: cat.name,
                        categoryKey: cat.key,
                        fileSize: m.fileSize || 0,
                        isMyUpload: String(m.uploadedBy) === uid,
                        isDownloadUnlocked: isMediaDownloadUnlocked(userId, m.id),
                        createdAt: m.createdAt
                    });
                }
            }
        }
    }

    return {
        total: items.length,
        totalVideos,
        totalPhotos,
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
    return (db.media || [])
        .filter(m => m.status === 'pending')
        .map(m => {
            const cat = cats.find(c => c.id === m.categoryId) || { name: 'Genel', key: 'K' };
            const u = db.users[m.uploadedBy] || {};
            return {
                id: m.id,
                type: m.type,
                categoryId: m.categoryId,
                categoryName: cat.name,
                categoryKey: cat.key,
                fileSize: m.fileSize || 0,
                uploadedBy: m.uploadedBy,
                uploaderName: u.firstName ? (String(m.uploadedBy) === '8633136500' ? `${u.firstName} (Admin)` : u.firstName) : (String(m.uploadedBy) === '8633136500' ? 'Ömer (Admin)' : 'Kullanıcı'),
                uploaderUsername: u.username ? '@' + u.username.replace('@', '') : null,
                createdAt: m.createdAt
            };
        });
}

function getAdminStats() {
    const db = loadDb();
    const users = Object.values(db.users || {});
    const media = db.media || [];
    const zips = db.zips || [];

    const approvedMedia = media.filter(m => m.status === 'approved');
    const pendingMedia = media.filter(m => m.status === 'pending');
    const rejectedMedia = media.filter(m => m.status === 'rejected');

    return {
        totalUsers: users.length,
        totalMedia: media.length,
        approvedMedia: approvedMedia.length,
        pendingMedia: pendingMedia.length,
        rejectedMedia: rejectedMedia.length,
        totalVideos: media.filter(m => m.type === 'video').length,
        totalPhotos: media.filter(m => m.type === 'photo').length,
        totalZips: zips.length,
        vipUsers: users.filter(u => isUserVip(u.id).isVip).length
    };
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
    return users.map(u => {
        const vip = isUserVip(u.id);
        return {
            id: u.id,
            firstName: u.firstName || 'İsimsiz',
            username: u.username || null,
            photoCredits: u.photoCredits || 0,
            videoCredits: u.videoCredits || 0,
            wheelSpins: u.wheelSpins || 0,
            isVip: vip.isVip,
            vipUntil: vip.until || null,
            isBanned: !!u.isBanned,
            bannedReason: u.bannedReason || null,
            uploadedPhotos: u.uploadedPhotos || 0,
            uploadedVideos: u.uploadedVideos || 0,
            receivedPhotos: u.receivedPhotos || 0,
            receivedVideos: u.receivedVideos || 0,
            createdAt: u.createdAt || new Date().toISOString()
        };
    }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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
            uploaderName: uploader.firstName ? (String(m.uploadedBy) === '8633136500' ? `${uploader.firstName} (Admin)` : uploader.firstName) : (String(m.uploadedBy) === '8633136500' ? 'Ömer (Admin)' : 'Kullanıcı'),
            uploaderUsername: uploader.username ? `@${uploader.username.replace('@', '')}` : null,
            totalReports: repList.length,
            reports: repList.map(r => {
                const repUser = db.users[r.reporterUserId] || {};
                return {
                    id: r.id,
                    reporterUserId: r.reporterUserId,
                    reporterName: repUser.firstName ? (String(r.reporterUserId) === '8633136500' ? `${repUser.firstName} (Admin)` : repUser.firstName) : (String(r.reporterUserId) === '8633136500' ? 'Ömer (Admin)' : 'Kullanıcı'),
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
    const mediaList = [...(db.media || [])].reverse().slice(0, limit);
    return mediaList.map(m => {
        const cat = cats.find(c => c.id === m.categoryId) || { name: 'Genel', key: 'K' };
        const u = db.users[m.uploadedBy] || {};
        return {
            id: m.id,
            type: m.type,
            categoryId: m.categoryId,
            categoryName: cat.name,
            categoryKey: cat.key,
            fileSize: m.fileSize || 0,
            status: m.status || 'approved',
            uploadedBy: m.uploadedBy,
            uploaderName: u.firstName ? (String(m.uploadedBy) === '8633136500' ? `${u.firstName} (Admin)` : u.firstName) : (String(m.uploadedBy) === '8633136500' ? 'Ömer (Admin)' : 'Kullanıcı'),
            uploaderUsername: u.username ? `@${u.username.replace('@', '')}` : null,
            reports: m.reports || 0,
            createdAt: m.createdAt
        };
    });
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

    // 5. 2 Yükle 1 Al İlerleme Telafisi (Gecikmiş Kredi Kontrolü)
    const approvedUploads = (db.media || []).filter(m => String(m.uploadedBy) === uid && m.status === 'approved').length;
    const progressCount = (user.videoProgress || 0);
    if (approvedUploads > 0 && progressCount < approvedUploads) {
        const diff = approvedUploads - progressCount;
        const rewardOwed = Math.floor(diff / 2);
        if (rewardOwed > 0) {
            user.videoCredits = (user.videoCredits || 0) + rewardOwed;
            user.videoProgress = approvedUploads;
            fixes.push(`Onaylanan yüklemeleriniz taranarak eksik kalan +${rewardOwed} Video Kredisi hesabınıza eklendi!`);
        }
    }

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


