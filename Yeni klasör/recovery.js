const fs = require('fs');
const path = require('path');
const db = require('./db');

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || (fs.existsSync('/data') ? '/data' : __dirname);
const STATE_FILE = path.join(DB_DIR, 'recovery_state.json');

let botInstance = null;
let shouldStop = false;
let isRunning = false;

// Varsayılan durum
const defaultState = {
    isRunning: false,
    status: 'idle', // 'idle' | 'running' | 'paused' | 'completed'
    startMsgId: 0,
    endMsgId: 1,
    lastScannedMsgId: 0,
    totalToScan: 0,
    scannedCount: 0,
    recoveredCount: 0,
    duplicateCount: 0,
    percent: 0,
    targetCatId: null,
    adminChatId: null,
    updatedAt: new Date().toISOString()
};

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, 'utf8');
            return { ...defaultState, ...JSON.parse(raw) };
        }
    } catch (_) {}
    return { ...defaultState };
}

function saveState(state) {
    try {
        state.updatedAt = new Date().toISOString();
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error('Kurtarma durumu kaydedilemedi:', e.message);
    }
}

// 🧠 Akıllı Kategori Sözlüğü
function detectCategorySmart(text, overrideCatId = null) {
    if (overrideCatId && overrideCatId !== 'auto') return overrideCatId;
    if (!text) return 'cat_11';
    const t = text.toLowerCase();

    const cats = db.getCategories();
    for (const c of cats) {
        if (t.includes(`[${c.key.toLowerCase()}]`) || t.includes(c.name.toLowerCase())) {
            return c.id;
        }
    }

    if (t.includes('ensest') || t.includes('kuzen') || t.includes('abla') || t.includes('kardeş') || t.includes('kardes') || t.includes('üvey') || t.includes('uvey') || t.includes('baba') || t.includes('anne')) return 'cat_1';
    if (t.includes('gay') || t.includes('erkek') || t.includes('pasif') || t.includes('aktif') || t.includes('twink') || t.includes('femboy') || t.includes('trans') || t.includes('travesti')) return 'cat_2';
    if (t.includes('ifsa') || t.includes('ifşa') || t.includes('turk') || t.includes('türk') || t.includes('yerli') || t.includes('liseli') || t.includes('üniversiteli')) return 'cat_3';
    if (t.includes('cuck') || t.includes('gavat') || t.includes('swinger') || t.includes('grup') || t.includes('boynuz')) return 'cat_4';
    if (t.includes('onlyfans') || t.includes('fansly') || t.includes('of ') || t.includes('#of') || t.includes('vip')) return 'cat_5';
    if (t.includes('tribute') || t.includes('cum') || t.includes('boşalma') || t.includes('bosalma')) return 'cat_6';
    if (t.includes('ünlü') || t.includes('unlu') || t.includes('fenomen') || t.includes('manken') || t.includes('oyuncu')) return 'cat_7';
    if (t.includes('ipcam') || t.includes('ip cam') || t.includes('gizli') || t.includes('kamera') || t.includes('gizlicekim')) return 'cat_8';
    if (t.includes('sosyal') || t.includes('instagram') || t.includes('tiktok') || t.includes('snap') || t.includes('tweet') || t.includes('twitter')) return 'cat_9';
    if (t.includes('porno') || t.includes('porn') || t.includes('sikiş') || t.includes('sikis') || t.includes('hard') || t.includes('anal')) return 'cat_10';

    return 'cat_11';
}

function init(options) {
    if (options && options.bot) {
        botInstance = options.bot;
    }
}

function getRecoveryState() {
    const s = loadState();
    s.isRunning = isRunning;
    return s;
}

function stopRecovery() {
    if (!isRunning) return false;
    shouldStop = true;
    return true;
}

async function startRecovery({ bot, adminChatId, limit = null, targetCatId = null, resume = false, onProgress = null }) {
    if (bot) botInstance = bot;
    if (!botInstance) throw new Error('Bot nesnesi bulunamadı');

    if (isRunning) {
        return { success: false, message: 'Zaten aktif bir tarama çalışıyor.' };
    }

    isRunning = true;
    shouldStop = false;

    let state = loadState();
    let currentAdminChatId = adminChatId || state.adminChatId || '8633136500';

    let startMsgId = 0;
    let endMsgId = 1;
    let scannedCount = 0;
    let recoveredCount = 0;
    let duplicateCount = 0;

    if (resume && state.lastScannedMsgId > 1 && state.status !== 'completed') {
        // Kaldığı yerden devam et
        startMsgId = state.lastScannedMsgId - 1;
        endMsgId = state.endMsgId || 1;
        scannedCount = state.scannedCount || 0;
        recoveredCount = state.recoveredCount || 0;
        duplicateCount = state.duplicateCount || 0;
        if (!targetCatId) targetCatId = state.targetCatId || null;
    } else {
        // Sıfırdan başlat
        let latestMsgId = 15000;
        try {
            // Son mesaj numarasını tespit et
            const ping = await botInstance.telegram.sendMessage(currentAdminChatId, '🔍 <i>Kurtarma başlangıç noktası kontrol ediliyor...</i>', { parse_mode: 'HTML' });
            latestMsgId = ping.message_id;
            await botInstance.telegram.deleteMessage(currentAdminChatId, ping.message_id).catch(() => {});
        } catch (_) {}

        startMsgId = latestMsgId - 1;
        endMsgId = limit ? Math.max(1, startMsgId - limit) : 1;
        scannedCount = 0;
        recoveredCount = 0;
        duplicateCount = 0;
    }

    const totalToScan = (startMsgId - endMsgId + 1) + scannedCount;

    state = {
        isRunning: true,
        status: 'running',
        startMsgId,
        endMsgId,
        lastScannedMsgId: startMsgId,
        totalToScan,
        scannedCount,
        recoveredCount,
        duplicateCount,
        percent: Math.min(100, Math.round((scannedCount / Math.max(1, totalToScan)) * 100)),
        targetCatId: targetCatId || null,
        adminChatId: currentAdminChatId,
        updatedAt: new Date().toISOString()
    };
    saveState(state);

    const dbData = db.loadDb();
    const existingIds = new Set((dbData.media || []).map(m => m.fileUniqueId || m.fileId));

    const BATCH_SIZE = 12; // 12 paralel istek aynı anda (15x hız)
    let lastNotifyTime = Date.now();

    (async () => {
        try {
            for (let batchStart = startMsgId; batchStart >= endMsgId; batchStart -= BATCH_SIZE) {
                if (shouldStop) {
                    state.status = 'paused';
                    state.isRunning = false;
                    saveState(state);
                    isRunning = false;
                    if (onProgress) onProgress(state);
                    return;
                }

                const batchEnd = Math.max(endMsgId, batchStart - BATCH_SIZE + 1);
                const msgIds = [];
                for (let id = batchStart; id >= batchEnd; id--) {
                    msgIds.push(id);
                }

                // 12 mesajı paralel forward et
                const forwardPromises = msgIds.map(async (msgId) => {
                    try {
                        const fwd = await botInstance.telegram.forwardMessage(currentAdminChatId, currentAdminChatId, msgId);
                        return { originalId: msgId, fwd };
                    } catch (_) {
                        return { originalId: msgId, fwd: null };
                    }
                });

                const results = await Promise.all(forwardPromises);
                const toDeleteIds = [];

                for (const res of results) {
                    scannedCount++;
                    state.lastScannedMsgId = res.originalId;

                    if (!res.fwd) continue;

                    const fwd = res.fwd;
                    toDeleteIds.push(fwd.message_id);

                    let fileId = null;
                    let fileUniqueId = null;
                    let mediaType = null;
                    let fileSize = 0;

                    if (fwd.video) {
                        fileId = fwd.video.file_id;
                        fileUniqueId = fwd.video.file_unique_id;
                        mediaType = 'video';
                        fileSize = fwd.video.file_size || 0;
                    } else if (fwd.photo && fwd.photo.length > 0) {
                        const best = fwd.photo[fwd.photo.length - 1];
                        fileId = best.file_id;
                        fileUniqueId = best.file_unique_id;
                        mediaType = 'photo';
                        fileSize = best.file_size || 0;
                    }

                    if (fileId && fileUniqueId) {
                        if (existingIds.has(fileUniqueId) || existingIds.has(fileId)) {
                            duplicateCount++;
                        } else {
                            const caption = fwd.caption || '';
                            const assignedCatId = detectCategorySmart(caption, targetCatId);

                            let uploaderId = currentAdminChatId;
                            const uploaderMatch = caption.match(/ID:\s*<code>(\d+)<\/code>/i) || caption.match(/ID:\s*(\d+)/i);
                            if (uploaderMatch) uploaderId = uploaderMatch[1];

                            const newMedia = {
                                id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
                                type: mediaType,
                                fileId: fileId,
                                fileUniqueId: fileUniqueId,
                                fileSize: fileSize,
                                categoryId: assignedCatId,
                                uploadedBy: String(uploaderId),
                                status: 'approved',
                                reports: 0,
                                reporters: [],
                                createdAt: fwd.date ? new Date(fwd.date * 1000).toISOString() : new Date().toISOString()
                            };

                            dbData.media.push(newMedia);
                            existingIds.add(fileUniqueId);
                            recoveredCount++;
                        }
                    }
                }

                // Geçici forward edilen kopyaları paralel sil
                if (toDeleteIds.length > 0) {
                    await Promise.allSettled(toDeleteIds.map(fid => botInstance.telegram.deleteMessage(currentAdminChatId, fid).catch(() => {})));
                }

                // Durum güncelle ve kaydet
                state.scannedCount = scannedCount;
                state.recoveredCount = recoveredCount;
                state.duplicateCount = duplicateCount;
                state.percent = Math.min(100, Math.round((scannedCount / Math.max(1, totalToScan)) * 100));

                const now = Date.now();
                if (now - lastNotifyTime > 3000 || scannedCount % 120 === 0) {
                    lastNotifyTime = now;
                    saveState(state);
                    db.saveDb();
                    if (onProgress) onProgress(state);
                }

                await new Promise(r => setTimeout(r, 120));
            }

            // Tamamlandı
            state.status = 'completed';
            state.isRunning = false;
            state.percent = 100;
            saveState(state);
            db.saveDb();
            isRunning = false;

            if (onProgress) onProgress(state);

            // Telegram'a tamamlama raporu ilet
            if (currentAdminChatId && botInstance) {
                botInstance.telegram.sendMessage(
                    currentAdminChatId,
                    `🎉 <b>TURBO MEDYA KURTARMA TAMAMLANDI!</b>\n\n` +
                    `📊 <b>Sonuçlar:</b>\n` +
                    `🔍 Toplam Taranan: <b>${scannedCount} mesaj</b>\n` +
                    `💎 Kurtarılan Yeni Medya: <b>+${recoveredCount}</b>\n` +
                    `📦 Havuzdaki Toplam Medya: <b>${dbData.media.length}</b>\n\n` +
                    `✅ Tüm içerikler başarıyla veritabanına işlendi.`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        } catch (fatalErr) {
            console.error('Kurtarma hatası:', fatalErr);
            state.status = 'paused';
            state.isRunning = false;
            saveState(state);
            db.saveDb();
            isRunning = false;
            if (onProgress) onProgress(state);
        }
    })();

    return {
        success: true,
        message: resume ? `Kurtarma #${startMsgId} numaralı mesajdan devam ettiriliyor...` : 'Turbo kurtarma başlatıldı.',
        state
    };
}

// 🎯 Akıllı Klasör Düzeltme & Hızlı Ayrıştırma
function fixAllCategories() {
    const dbData = db.loadDb();
    let movedCount = 0;
    const catStats = {};

    for (const m of (dbData.media || [])) {
        if (!m.categoryId || m.categoryId === 'cat_11') {
            let detectedCat = null;
            if (m.suggestedCategory && m.suggestedCategory !== 'cat_11') {
                detectedCat = m.suggestedCategory;
            } else {
                detectedCat = detectCategorySmart(m.caption || '', null);
            }

            if (detectedCat && detectedCat !== 'cat_11') {
                m.categoryId = detectedCat;
                movedCount++;
                catStats[detectedCat] = (catStats[detectedCat] || 0) + 1;
            }
        }
    }

    if (movedCount > 0) {
        db.saveDb();
    }

    return {
        success: true,
        movedCount,
        catStats
    };
}

module.exports = {
    init,
    getRecoveryState,
    startRecovery,
    stopRecovery,
    fixAllCategories,
    detectCategorySmart
};
