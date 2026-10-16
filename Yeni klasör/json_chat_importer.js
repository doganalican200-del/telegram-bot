const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');
const DESKTOP_DIR = 'C:\\Users\\Ömer\\Desktop\\Yeni klasör';

function importFromTelegramJson(exportJsonPath) {
    if (!fs.existsSync(exportJsonPath)) {
        console.error('Dışa aktarma dosyası bulunamadı:', exportJsonPath);
        return;
    }

    const raw = fs.readFileSync(exportJsonPath, 'utf8');
    const data = JSON.parse(raw);
    const messages = data.messages || [];

    let dbData = { media: [], users: {}, categories: [] };
    if (fs.existsSync(DB_FILE)) {
        dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
    if (!Array.isArray(dbData.media)) dbData.media = [];

    const existingMsgIds = new Set(dbData.media.map(m => m.telegramMsgId).filter(Boolean));
    let addedPhotos = 0;
    let addedVideos = 0;
    let addedGifs = 0;

    for (const msg of messages) {
        if (!msg.id || existingMsgIds.has(msg.id)) continue;

        let type = null;
        let file = null;

        if (msg.photo) {
            type = 'photo';
            file = msg.photo;
            addedPhotos++;
        } else if (msg.media_type === 'video_file' || msg.file_name?.endsWith('.mp4')) {
            type = 'video';
            file = msg.file;
            addedVideos++;
        } else if (msg.media_type === 'animation' || msg.file_name?.endsWith('.gif')) {
            type = 'animation';
            file = msg.file;
            addedGifs++;
        }

        if (type && file) {
            dbData.media.push({
                id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
                type: type,
                isGif: type === 'animation',
                fileId: file,
                filePath: file,
                caption: Array.isArray(msg.text) ? msg.text.map(t => typeof t === 'string' ? t : t.text).join('') : (msg.text || ''),
                categoryId: 'cat_11',
                uploadedBy: String(msg.from_id ? String(msg.from_id).replace('user', '') : '8633136500'),
                status: 'approved',
                reports: 0,
                reporters: [],
                createdAt: msg.date || new Date().toISOString(),
                telegramMsgId: msg.id,
                orderIndex: dbData.media.length + 1
            });
            existingMsgIds.add(msg.id);
        }
    }

    dbData.media.forEach((m, idx) => { m.orderIndex = idx + 1; });
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');

    if (fs.existsSync(DESKTOP_DIR)) {
        fs.copyFileSync(DB_FILE, path.join(DESKTOP_DIR, 'database.json'));
    }

    console.log(`✅ JSON İçe Aktarımı Tamamlandı! Eklenen: +${addedPhotos} Foto, +${addedVideos} Video, +${addedGifs} GIF. Toplam Medya: ${dbData.media.length}`);
}

module.exports = { importFromTelegramJson };

if (require.main === module) {
    const filePath = process.argv[2] || 'result.json';
    importFromTelegramJson(filePath);
}
