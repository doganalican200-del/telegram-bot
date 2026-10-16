const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');

const BOT_TOKEN = '8151413936:AAFbhwQNpaGkW1CdShixrq2PJMNzC7jamjM';
const ADMIN_ID = '8633136500';
const DB_FILE = path.join(__dirname, 'database.json');
const STATE_FILE = path.join(__dirname, 'import_state.json');
const DESKTOP_DIR = 'C:\\Users\\Ömer\\Desktop\\Yeni klasör';

const bot = new Telegraf(BOT_TOKEN);

function detectCategorySmart(text) {
    if (!text) return 'cat_11';
    const t = text.toLowerCase();
    if (t.includes('ensest') || t.includes('kuzen') || t.includes('abla') || t.includes('kardeş') || t.includes('kardes') || t.includes('üvey') || t.includes('baba') || t.includes('anne')) return 'cat_1';
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

function syncToDesktop() {
    try {
        if (fs.existsSync(DESKTOP_DIR) && fs.existsSync(DB_FILE)) {
            fs.copyFileSync(DB_FILE, path.join(DESKTOP_DIR, 'database.json'));
        }
    } catch (e) {
        console.warn('Desktop sync warn:', e.message);
    }
}

async function main() {
    console.log('====================================================');
    console.log('🚀 KUSURSUZ TELEGRAM MEDYA İÇE AKTARMA MOTORU (V2)');
    console.log('🤖 Bot: @VideoResimTakas_bot | Hedef: 3326 Foto / 2116 Video / 160 GIF');
    console.log('====================================================\n');

    let dbData = { media: [], users: {}, categories: [] };
    if (fs.existsSync(DB_FILE)) {
        try {
            dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch (_) {}
    }
    if (!Array.isArray(dbData.media)) dbData.media = [];

    const seenMsgIds = new Set(dbData.media.map(m => m.telegramMsgId).filter(Boolean));
    console.log(`📦 Mevcut Veritabanı: ${dbData.media.length} Medya (Zaten işlenmiş mesaj: ${seenMsgIds.size})`);

    let maxMsgId = 30500;
    try {
        const ping = await bot.telegram.sendMessage(ADMIN_ID, '🔍 <i>Medya taraması kaldığı yerden devam ediyor...</i>', { parse_mode: 'HTML', disable_notification: true });
        maxMsgId = ping.message_id;
        await bot.telegram.deleteMessage(ADMIN_ID, ping.message_id).catch(() => {});
        console.log(`📍 Taranacak En Son Mesaj ID: #${maxMsgId}`);
    } catch (_) {}

    const BATCH_SIZE = 10;
    let addedCount = 0;
    let scannedCount = 0;
    let lastSaveTime = Date.now();

    for (let batchStart = 1; batchStart <= maxMsgId; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(maxMsgId, batchStart + BATCH_SIZE - 1);
        let idsToFetch = [];
        for (let id = batchStart; id <= batchEnd; id++) {
            if (!seenMsgIds.has(id)) {
                idsToFetch.push(id);
            }
        }

        if (idsToFetch.length === 0) {
            continue;
        }

        let pendingIds = [...idsToFetch];
        const fulfilledMessages = [];

        while (pendingIds.length > 0) {
            const results = await Promise.allSettled(pendingIds.map(async (msgId) => {
                const fwd = await bot.telegram.forwardMessage(ADMIN_ID, ADMIN_ID, msgId, { disable_notification: true });
                return { originalMsgId: msgId, fwd };
            }));

            const nextRetryIds = [];
            let maxRetryWait = 0;

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const msgId = pendingIds[i];

                if (r.status === 'fulfilled') {
                    fulfilledMessages.push(r.value);
                } else {
                    const err = r.reason;
                    const is429 = err?.response?.error_code === 429 || err?.message?.includes('429');
                    if (is429) {
                        const waitSec = err?.response?.parameters?.retry_after || 5;
                        if (waitSec > maxRetryWait) maxRetryWait = waitSec;
                        nextRetryIds.push(msgId);
                    } else {
                        // 400 Bad Request: message not found -> Gerçekten mesaj yok, geçilebilir
                    }
                }
            }

            if (maxRetryWait > 0) {
                console.log(`⏳ Telegram 429 Hız Sınırı: ${maxRetryWait} saniye beklenip #${nextRetryIds[0]} tekrar denenecek...`);
                await new Promise(res => setTimeout(res, (maxRetryWait * 1000) + 1000));
            }

            pendingIds = nextRetryIds;
            if (pendingIds.length > 0 && maxRetryWait === 0) {
                await new Promise(res => setTimeout(res, 500));
            }
        }

        const toDeleteIds = [];

        for (const item of fulfilledMessages) {
            const { originalMsgId, fwd } = item;
            toDeleteIds.push(fwd.message_id);

            let mediaType = null;
            let fileId = null;
            let fileUniqueId = null;
            let fileSize = 0;
            let isGif = false;

            if (fwd.animation) {
                mediaType = 'animation';
                fileId = fwd.animation.file_id;
                fileUniqueId = fwd.animation.file_unique_id;
                fileSize = fwd.animation.file_size || 0;
                isGif = true;
            } else if (fwd.video) {
                mediaType = 'video';
                fileId = fwd.video.file_id;
                fileUniqueId = fwd.video.file_unique_id;
                fileSize = fwd.video.file_size || 0;
            } else if (fwd.photo && fwd.photo.length > 0) {
                const best = fwd.photo[fwd.photo.length - 1];
                mediaType = 'photo';
                fileId = best.file_id;
                fileUniqueId = best.file_unique_id;
                fileSize = best.file_size || 0;
            } else if (fwd.document && (fwd.document.mime_type === 'image/gif' || fwd.document.mime_type === 'video/mp4')) {
                if (fwd.document.mime_type === 'image/gif') {
                    mediaType = 'animation';
                    isGif = true;
                } else {
                    mediaType = 'video';
                }
                fileId = fwd.document.file_id;
                fileUniqueId = fwd.document.file_unique_id;
                fileSize = fwd.document.file_size || 0;
            }

            if (fileId && fileUniqueId) {
                const caption = fwd.caption || '';
                const detectedCat = detectCategorySmart(caption);
                const createdAt = fwd.date ? new Date(fwd.date * 1000).toISOString() : new Date().toISOString();

                let uploaderId = ADMIN_ID;
                const uploaderMatch = caption.match(/ID:\s*<code>(\d+)<\/code>/i) || caption.match(/ID:\s*(\d+)/i);
                if (uploaderMatch) uploaderId = uploaderMatch[1];

                const newMedia = {
                    id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
                    type: mediaType,
                    isGif: isGif,
                    fileId: fileId,
                    fileUniqueId: fileUniqueId,
                    fileSize: fileSize,
                    caption: caption,
                    categoryId: 'cat_11', // Genel Havuz
                    suggestedCategory: detectedCat,
                    uploadedBy: String(uploaderId),
                    status: 'approved',
                    reports: 0,
                    reporters: [],
                    createdAt: createdAt,
                    telegramMsgId: originalMsgId,
                    orderIndex: dbData.media.length + 1
                };

                dbData.media.push(newMedia);
                seenMsgIds.add(originalMsgId);
                addedCount++;
            }
        }

        if (toDeleteIds.length > 0) {
            await bot.telegram.deleteMessages(ADMIN_ID, toDeleteIds).catch(() => {});
        }

        scannedCount += BATCH_SIZE;

        const now = Date.now();
        if (addedCount > 0 && (addedCount % 30 === 0 || now - lastSaveTime > 5000)) {
            dbData.media.forEach((m, idx) => { m.orderIndex = idx + 1; });
            fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
            syncToDesktop();
            lastSaveTime = now;

            const curPhotos = dbData.media.filter(m => m.type === 'photo').length;
            const curVideos = dbData.media.filter(m => m.type === 'video').length;
            const curGifs = dbData.media.filter(m => m.type === 'animation' || m.isGif).length;
            console.log(`[İLERLEME] Mesaj #${batchEnd}/${maxMsgId} | 📸 Foto: ${curPhotos} | 🎥 Video: ${curVideos} | 🎞️ GIF: ${curGifs} | 📦 Toplam Havuz: ${dbData.media.length} (+${addedCount} yeni)`);
        }

        await new Promise(res => setTimeout(res, 220));
    }

    dbData.media.forEach((m, idx) => { m.orderIndex = idx + 1; });
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
    syncToDesktop();

    const finalPhotos = dbData.media.filter(m => m.type === 'photo').length;
    const finalVideos = dbData.media.filter(m => m.type === 'video').length;
    const finalGifs = dbData.media.filter(m => m.type === 'animation' || m.isGif).length;

    console.log('\n====================================================');
    console.log('🎉 TÜM TELEGRAM MEDYALARI BAŞARIYLA AKTARILDI!');
    console.log(`📸 Toplam Fotoğraflar: ${finalPhotos}`);
    console.log(`🎥 Toplam Videolar: ${finalVideos}`);
    console.log(`🎞️ Toplam GIF'ler: ${finalGifs}`);
    console.log(`📦 Veritabanındaki Toplam Medya: ${dbData.media.length}`);
    console.log('====================================================\n');

    try {
        await bot.telegram.sendMessage(
            ADMIN_ID,
            `🎉 <b>MEDYA AKTARIMI TAMAMLANDI!</b>\n\n` +
            `Tüm medya arşivi eksiksiz veritabanına işlendi:\n` +
            `📸 <b>Fotoğraflar:</b> <code>${finalPhotos}</code>\n` +
            `🎥 <b>Videolar:</b> <code>${finalVideos}</code>\n` +
            `🎞️ <b>GIF'ler:</b> <code>${finalGifs}</code>\n` +
            `📦 <b>Havuzdaki Toplam Medya:</b> <b>${dbData.media.length} adet</b>`,
            { parse_mode: 'HTML' }
        );
    } catch (_) {}
}

main().catch(err => {
    console.error('Import fatal:', err);
});
