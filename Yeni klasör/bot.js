require('dotenv').config();

// 🛡️ Global Hata Yakalayıcılar - Botun çökmesini tamamen engeller
process.on('uncaughtException', (err) => {
    console.error('🛡️ [Kritik Hata Yakalandı - Bot Çalışmaya Devam Ediyor]:', err?.message || err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🛡️ [Kritik Promise Hatası Yakalandı - Bot Çalışmaya Devam Ediyor]:', reason?.message || reason);
});

const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

const BANNER_PATH = path.join(__dirname, 'bot_banner.jpg');
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = ['8633136500', '7808953142'];
if (process.env.ADMIN_ID && !ADMIN_IDS.includes(String(process.env.ADMIN_ID))) {
    ADMIN_IDS.push(String(process.env.ADMIN_ID));
}
const ADMIN_ID = ADMIN_IDS[0];

// 🔐 Oturum açmış yöneticiler hafızası (şifre doğrulayan kullanıcılar - kalıcı saklama)
const AUTH_ADMINS_FILE = path.join(__dirname, 'authenticated_admins.json');

function loadAuthenticatedAdmins() {
    try {
        if (fs.existsSync(AUTH_ADMINS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(AUTH_ADMINS_FILE, 'utf8'));
            if (Array.isArray(saved)) {
                return new Set(saved.map(String));
            }
        }
    } catch (e) {
        console.error('Error loading authenticated admins:', e.message);
    }
    return new Set();
}

function saveAuthenticatedAdmins(set) {
    try {
        fs.writeFileSync(AUTH_ADMINS_FILE, JSON.stringify([...set], null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving authenticated admins:', e.message);
    }
}

const authenticatedAdmins = loadAuthenticatedAdmins();

function isAdminUser(userId) {
    if (!userId) return false;
    const uid = String(userId);
    return ADMIN_IDS.includes(uid) || authenticatedAdmins.has(uid);
}

// 🔐 Admin Panel Şifresi
const ADMIN_PASSWORD = 'alper0606';
const pendingAdminAuth = new Set(); // şifre beklenen userId'ler
const pendingCatAdminAuth = {}; // userId -> catId (sekme yönetici şifre doğrulaması)
const pendingRenameAuth = {}; // userId -> catId (sekme isim değiştirme şifre doğrulaması)

// ⭐ Telegram Yıldızları ile Satılan Özel Sekmeler ve Fiyatları
const STAR_CATEGORIES = {
    cat_1: { videoPrice: 2, photoPrice: 1 }, // Ensest: 2 Yıldız Video, 1 Yıldız Resim
    cat_3: { videoPrice: 5, photoPrice: 1 }, // İfsa: 5 Yıldız Video, 1 Yıldız Resim
    cat_5: { videoPrice: 10, photoPrice: 3 }, // Onlyfans: 10 Yıldız Video, 3 Yıldız Resim
    cat_8: { videoPrice: 2, photoPrice: 1 }  // Gizli Çekim IPCAM: 2 Yıldız Video, 1 Yıldız Resim
};

function hasActivePaidVip(userId) {
    if (!userId) return false;
    const user = db.getUser(userId);
    if (!user || !user.vipUntil) return false;
    return user.vipUntil > Date.now();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

if (!BOT_TOKEN) {
    console.error('HATA: .env dosyasında BOT_TOKEN bulunamadı!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const BOT_USERNAME = 'VideoResimTakas_bot';

// ZAMAN AŞIMINA UĞRAYAN BUTON KLİKLERİ KORUMASI (query is too old hatalarını absorbe eder)
bot.use(async (ctx, next) => {
    if (ctx.answerCbQuery) {
        const originalAnswer = ctx.answerCbQuery.bind(ctx);
        ctx.answerCbQuery = async (...args) => {
            try {
                return await originalAnswer(...args);
            } catch (err) {
                return false;
            }
        };
    }
    return next();
});

// BANLI KULLANICI KONTROLÜ (Giriş ve Tüm Eylemleri Engeller)
bot.use(async (ctx, next) => {
    if (ctx.from) {
        const userId = String(ctx.from.id);
        if (!isAdminUser(userId) && db.isUserBanned(userId)) {
            const user = db.getUser(userId);
            const reason = user?.bannedReason || 'Kural ihlali (Tekrar eden / kopya / uygunsuz medya)';
            const banMsg = 
`🚫 <b>HESABINIZ ASKIYA ALINDI (BANLANDINIZ)</b>

⚠️ <b>Neden:</b> ${reason}

⛔ Sistem kurallarını ihlal ettiğiniz (aynı resim/videoları tekrar yükleme, sahte veya uygunsuz içerik gönderme vb.) için bot erişiminiz yönetici tarafından kalıcı olarak sonlandırılmıştır.`;

            if (ctx.callbackQuery) {
                await ctx.answerCbQuery('🚫 Hesabınız sistemden banlanmıştır!', { show_alert: true }).catch(() => {});
            }
            return ctx.reply(banMsg, { parse_mode: 'HTML' }).catch(() => {});
        }
    }
    return next();
});

// Ana Menü Klavyesi (Kategori Grid)
function getMainMenuKeyboard(userId = null) {
    const cats = db.getCategories();
    const rows = [];

    // Kategori / Sekme (2 sütunlu şık düzen)
    const getCatLabel = (c) => {
        const starCfg = STAR_CATEGORIES[c.id];
        if (starCfg) return `⭐ ${c.name} (${starCfg.videoPrice}⭐/${starCfg.photoPrice}⭐)`;
        return c.name;
    };
    for (let i = 0; i < cats.length; i += 2) {
        const row = [Markup.button.callback(getCatLabel(cats[i]), `cat_view_${cats[i].id}`)];
        if (i + 1 < cats.length) {
            row.push(Markup.button.callback(getCatLabel(cats[i + 1]), `cat_view_${cats[i + 1].id}`));
        }
        rows.push(row);
    }

    // Ana Menü Alt Butonları
    rows.push([
        Markup.button.callback('👤 Profilim & Bakiye', 'my_profile'),
        Markup.button.callback('⭐ Paketler (Video / Foto)', 'menu_packages')
    ]);
    rows.push([
        Markup.button.callback('🎡 Şans Çarkı (1-10 Video)', 'wheel_menu'),
        Markup.button.callback('💎 Kredi Kazan / Davet Et', 'earn_credits')
    ]);
    rows.push([
        Markup.button.callback('📢 Duyuru Panosu', 'announcements'),
        Markup.button.callback('📜 Kurallar & Güvenlik', 'rules')
    ]);

    return Markup.inlineKeyboard(rows);
}

// Telegram Yıldızları (Stars) Paket Klavyeleri
function getPackagesMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🎥 Video Paketleri', 'pkg_tab_video'),
            Markup.button.callback('📸 Fotoğraf Paketleri', 'pkg_tab_photo')
        ],
        [
            Markup.button.callback('🔥 Kombo Paketler', 'pkg_tab_combo'),
            Markup.button.callback('👑 Sınırsız VIP Üyelik', 'pkg_tab_vip')
        ],
        [
            Markup.button.callback('⚡ 1 Yıldız = 1 Video', 'buy_vid_1'),
            Markup.button.callback('⚡ 1 Yıldız = 1 Foto', 'buy_pho_1')
        ],
        [
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);
}

function getVideoPackagesKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🎥 1 Video Kredisi — 1 Yıldız ⭐', 'buy_vid_1')],
        [Markup.button.callback('🎥 10 Video Kredisi — 10 Yıldız ⭐', 'buy_vid_10')],
        [Markup.button.callback('🎥 20 Video Kredisi — 20 Yıldız ⭐', 'buy_vid_20')],
        [Markup.button.callback('🎥 50 Video Kredisi — 45 Yıldız ⭐ (%10 İndirim)', 'buy_vid_50')],
        [
            Markup.button.callback('⬅️ Tüm Paketler', 'menu_packages'),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);
}

function getPhotoPackagesKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📸 1 Fotoğraf Kredisi — 1 Yıldız ⭐', 'buy_pho_1')],
        [Markup.button.callback('📸 10 Fotoğraf Kredisi — 10 Yıldız ⭐', 'buy_pho_10')],
        [Markup.button.callback('📸 20 Fotoğraf Kredisi — 20 Yıldız ⭐', 'buy_pho_20')],
        [Markup.button.callback('📸 50 Fotoğraf Kredisi — 45 Yıldız ⭐ (%10 İndirim)', 'buy_pho_50')],
        [
            Markup.button.callback('⬅️ Tüm Paketler', 'menu_packages'),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);
}

function getComboPackagesKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔥 10 Video + 10 Foto — 18 Yıldız ⭐', 'buy_com_10')],
        [Markup.button.callback('🔥 20 Video + 20 Foto — 35 Yıldız ⭐', 'buy_com_20')],
        [Markup.button.callback('🔥 50 Video + 50 Foto — 80 Yıldız ⭐ (Fırsat)', 'buy_com_50')],
        [
            Markup.button.callback('⬅️ Tüm Paketler', 'menu_packages'),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);
}

function getVipPackagesKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🌟 1 Günlük VIP — 100 Yıldız ⭐ (+1 Çark Hakkı 🎡)', 'buy_vip_1')],
        [Markup.button.callback('🌟 2 Günlük VIP — 150 Yıldız ⭐ (+1 Çark Hakkı 🎡)', 'buy_vip_2')],
        [Markup.button.callback('🌟 3 Günlük VIP — 250 Yıldız ⭐ (+2 Çark Hakkı 🎡)', 'buy_vip_3')],
        [
            Markup.button.callback('⬅️ Tüm Paketler', 'menu_packages'),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);
}

// /start komutu
bot.start((ctx) => {
    const text = ctx.message.text || '';
    let refId = null;

    if (text.includes('ref_')) {
        const parts = text.split(' ');
        if (parts.length > 1 && parts[1].startsWith('ref_')) {
            refId = parts[1].replace('ref_', '');
        }
    }

    const { user, isNew, refGivenTo } = db.getOrCreateUser(ctx.from, refId);

    if (isNew && refGivenTo) {
        bot.telegram.sendMessage(
            refGivenTo,
            `🎉 <b>Tebrikler! Davet Bonusu Kazandınız!</b>\n\nBir arkadaşınız davet linkinizle bota katıldı.\nHesabınıza <b>+2 Resim Kredisi</b> ve <b>+2 Video Kredisi</b> eklendi! 🎁\n\n💡 <i>Ne kadar çok arkadaş davet ederseniz o kadar çok kredi kazanırsınız!</i>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💎 Davet Et & Daha Fazla Kazan', 'earn_credits')],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        ).catch(() => {});
    }

    const vip = db.isUserVip(ctx.from.id);
    const vipText = vip.isVip 
        ? (vip.isUnlimited ? `👑 <b>VIP:</b> Aktif (👑 Yönetici / Sınırsız VIP)` : `👑 <b>VIP:</b> Aktif (${vip.remainingHours} saat kaldı)`) 
        : `👑 <b>VIP:</b> Standart`;
    const stats = db.getStats();

    const welcomeMsg = 
`👋 <b>Hoş Geldiniz, ${escapeHtml(ctx.from.first_name || 'Kullanıcı')}!</b>

Bu bot ile güvenli bir şekilde <b>Resim ve Video Takası</b> yapabilirsiniz.

${vipText}
📸 <b>Resim Krediniz:</b> <code>${user.photoCredits || 0}</code>
🎥 <b>Video Krediniz:</b> <code>${user.videoCredits || 0}</code>

📊 <b>Sistem Havuzu:</b> 📸 <b>${stats.approvedPhotos} Resim</b> | 🎥 <b>${stats.approvedVideos} Video</b>

👇 <b>İşlem yapmak istediğiniz sekmeyi / kategoriyi seçin:</b>`;

    if (fs.existsSync(BANNER_PATH)) {
        return ctx.replyWithPhoto({ source: BANNER_PATH }, {
            caption: welcomeMsg,
            parse_mode: 'HTML',
            ...getMainMenuKeyboard(ctx.from.id)
        }).catch((err) => {
            console.error('Banner gönderme hatası, metin olarak iletiliyor:', err.message);
            return ctx.reply(welcomeMsg, {
                parse_mode: 'HTML',
                ...getMainMenuKeyboard(ctx.from.id)
            });
        });
    }

    return ctx.reply(welcomeMsg, {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(ctx.from.id)
    });
});

// Güvenli Mesaj Düzenleme veya Yeni Mesaj Gönderme (Medya mesajlarından menüye dönerken 400 hatasını önler)
async function safeEditOrReply(ctx, text, extra = {}) {
    const msg = ctx.callbackQuery?.message;
    const isMedia = msg && (msg.photo || msg.video || msg.animation || msg.document || msg.video_note);

    if (isMedia) {
        try {
            return await ctx.editMessageCaption(text, extra);
        } catch (e) {
            return ctx.reply(text, extra).catch(() => {});
        }
    }

    try {
        return await ctx.editMessageText(text, extra);
    } catch (err) {
        if (err.description && err.description.includes('message is not modified')) {
            return;
        }
        return ctx.reply(text, extra).catch(() => {});
    }
}

// Ana Menü
bot.action('main_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id) || { photoCredits: 0, videoCredits: 0 };
    const vip = db.isUserVip(ctx.from.id);
    const vipText = vip.isVip 
        ? (vip.isUnlimited ? `👑 <b>VIP:</b> Aktif (👑 Sınırsız Yönetici VIP)` : `👑 <b>VIP:</b> Aktif (${vip.remainingHours} saat kaldı)`) 
        : `👑 <b>VIP:</b> Yok`;
    const stats = db.getStats();

    return safeEditOrReply(
        ctx,
        `🏠 <b>Ana Menü — Sekmeler & Kategoriler</b>\n\n${vipText}\n📸 Resim Kredisi: <code>${user.photoCredits || 0}</code>\n🎥 Video Kredisi: <code>${user.videoCredits || 0}</code>\n\n📊 <b>Sistem Havuzu:</b> 📸 <b>${stats.approvedPhotos} Resim</b> | 🎥 <b>${stats.approvedVideos} Video</b>\n\n👇 Lütfen işlem yapmak istediğiniz sekmeyi seçin:`,
        {
            parse_mode: 'HTML',
            ...getMainMenuKeyboard(ctx.from.id)
        }
    );
});

// Kategori Detay Ekranı (Sekme Tıklandığında)
bot.action(/cat_view_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const catId = ctx.match[1];
    const cat = db.getCategory(catId);
    if (!cat) return ctx.reply('Sekme bulunamadı.');
    const catStats = db.getCategoryStats(cat.id);
    const user = db.getUser(ctx.from.id) || { photoCredits: 0, videoCredits: 0 };
    const vip = db.isUserVip(ctx.from.id);
    const isAdmin = isAdminUser(ctx.from.id);

    // ⭐ TELEGRAM YILDIZLARI İLE SATILAN ÖZEL SEKMELER (Ensest, İfsa, Onlyfans, Gizli Çekim vb.)
    if (STAR_CATEGORIES[catId]) {
        const starCfg = STAR_CATEGORIES[catId];
        const text = 
`⭐ <b>ÖZEL SEKME: [${cat.key}] ${cat.name} (Özel İçerik)</b>\n\n` +
`Bu sekmedeki özel arşiv içerikleri <b>yalnızca Telegram Yıldızları</b> ile izlenebilir:\n` +
`• 🎥 <b>Video:</b> ⭐ ${starCfg.videoPrice} Yıldız\n` +
`• 📸 <b>Fotoğraf:</b> ⭐ ${starCfg.photoPrice} Yıldız\n\n` +
`🔒 <i>Standart kredi, takas veya VIP üyelik bu sekmede geçerli değildir.</i>\n\n` +
`📊 <b>Bu Sekmedeki İçerik:</b>\n` +
`📸 Onaylı Resim: <b>${catStats.approvedPhotos} Adet</b>\n` +
`🎥 Onaylı Video: <b>${catStats.approvedVideos} Adet</b>\n\n` +
`👇 <i>İzlemek istediğiniz medya türünü seçin:</i>`;

        const buttons = [
            [
                Markup.button.callback(`🎥 ⭐ ${starCfg.videoPrice} Yıldız ile 1 Video İzle`, `buy_cat_media_${cat.id}_video`),
                Markup.button.callback(`📸 ⭐ ${starCfg.photoPrice} Yıldız ile 1 Fotoğraf İzle`, `buy_cat_media_${cat.id}_photo`)
            ],
            [
                Markup.button.callback('👑 Yönetici Paneli', 'admin_panel_auth_request')
            ]
        ];

        if (isAdmin) {
            buttons.push([
                Markup.button.callback('👑 Yönetici: Ücretsiz Test İzle', `admin_cat_take_${cat.id}`)
            ]);
            buttons.push([
                Markup.button.callback(`✏️ [${cat.key}] Sekme İsmini Değiştir`, `admin_rename_${cat.id}`)
            ]);
        }

        buttons.push([
            Markup.button.callback('⬅️ Tüm Sekmeler / Ana Menü', 'main_menu')
        ]);

        return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
    }

    const vipText = vip.isVip 
        ? `👑 <b>VIP Durumu:</b> Sınırsız Erişim (👑 Yönetici)` 
        : `📸 Resim Krediniz: <code>${user.photoCredits || 0}</code> | 🎥 Video Krediniz: <code>${user.videoCredits || 0}</code>`;

    const text = 
`📂 <b>${cat.name} (${cat.key} Sekmesi)</b>${isAdmin ? ' 👑 <i>(Yönetici - Sınırsız Ücretsiz)</i>' : ''}\n\n` +
`📊 <b>Bu Sekmedeki İçerik Dağılımı:</b>\n` +
`📸 Onaylı Resim: <b>${catStats.approvedPhotos} Adet</b>\n` +
`🎥 Onaylı Video: <b>${catStats.approvedVideos} Adet</b>\n\n` +
`${vipText}\n\n` +
`<i>Bu sekmeden içerik almak veya yeni medya yüklemek için işlem seçin:</i>`;

    const buttonRows = [
        [
            Markup.button.callback('📥 Bu Sekmeden Medya Al', `cat_take_${cat.id}`),
            Markup.button.callback('📤 Bu Sekmeye Medya Yükle', `cat_upload_${cat.id}`)
        ],
        [
            Markup.button.callback('👑 Yönetici Paneli', 'admin_panel_auth_request')
        ]
    ];
    if (isAdmin) {
        buttonRows.push([
            Markup.button.callback('👑 Yönetici: Ücretsiz Test İzle', `admin_cat_take_${cat.id}`)
        ]);
        buttonRows.push([
            Markup.button.callback(`✏️ [${cat.key}] Sekme İsmini Değiştir`, `admin_rename_${cat.id}`)
        ]);
    }
    buttonRows.push([
        Markup.button.callback('⬅️ Tüm Sekmeler / Ana Menü', 'main_menu')
    ]);

    const keyboard = Markup.inlineKeyboard(buttonRows);

    return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
});

// Kategori Medya Al Menüsü Gösterici (Ortak Fonksiyon)
async function showCategoryTakeMenu(ctx, catId) {
    const cat = db.getCategory(catId);
    if (!cat) return ctx.reply('Sekme bulunamadı.');

    const isAdmin = isAdminUser(ctx.from.id);
    const vip = db.isUserVip(ctx.from.id);
    const catStats = db.getCategoryStats(cat.id);
    const unseen = db.getUserCategoryUnseenCount(ctx.from.id, cat.id);
    const user = db.getUser(ctx.from.id) || { photoCredits: 0, videoCredits: 0 };

    const vipText = isAdmin
        ? `👑 <b>Sınırsız Yönetici VIP</b> (⭐ Sınırsız Yıldız & Kredi ♾️)`
        : (vip.isVip 
            ? (vip.isUnlimited ? `👑 <b>VIP:</b> Aktif (👑 Yönetici / Sınırsız)` : `👑 <b>VIP:</b> Aktif (${vip.remainingHours} saat kaldı)`)
            : `📸 <b>${user.photoCredits || 0}</b> Resim | 🎥 <b>${user.videoCredits || 0}</b> Video Kredisi`);

    const text = 
`📥 <b>Medya Al — ${cat.name}</b>${isAdmin ? ' 👑 <i>(Yönetici - Ücretsiz)</i>' : ''}\n\n` +
`📊 <b>Bu Sekmedeki İçerik Durumunuz:</b>\n` +
`📸 Alabileceğiniz Yeni Resim: <b>${unseen.unseenPhotos} Adet</b> (Toplam: ${catStats.approvedPhotos})\n` +
`🎥 Alabileceğiniz Yeni Video: <b>${unseen.unseenVideos} Adet</b> (Toplam: ${catStats.approvedVideos})\n\n` +
`💰 <b>Mevcut Bakiyeniz:</b> ${vipText}\n\n` +
`🔒 <b>Güvenli Kredi Garantisi:</b> Bu sekmede yeni medya kalmadığında veya içerik teslim edilemediğinde <b>kredinizden kesinlikle kesinti yapılmaz</b>.\n\n` +
`👇 <b>Almak istediğiniz medya türünü ve adedini (1 - 3 - 5 - 10) seçin:</b>`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('📸 Resim: 1', `take_media_${cat.id}_photo_1`),
            Markup.button.callback('📸 3', `take_media_${cat.id}_photo_3`),
            Markup.button.callback('📸 5', `take_media_${cat.id}_photo_5`),
            Markup.button.callback('📸 10', `take_media_${cat.id}_photo_10`)
        ],
        [
            Markup.button.callback('🎥 Video: 1', `take_media_${cat.id}_video_1`),
            Markup.button.callback('🎥 3', `take_media_${cat.id}_video_3`),
            Markup.button.callback('🎥 5', `take_media_${cat.id}_video_5`),
            Markup.button.callback('🎥 10', `take_media_${cat.id}_video_10`)
        ],
        [
            Markup.button.callback('⬅️ Sekmeye Dön', `cat_view_${cat.id}`),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);

    return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
}

// Sekmelerde Yönetici Ücretsiz Test İzle Butonu (Şifre Korumalı)
bot.action(/admin_cat_take_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const catId = ctx.match[1];
    const cat = db.getCategory(catId);
    if (!cat) return ctx.reply('Sekme bulunamadı.');

    if (!isAdminUser(ctx.from?.id)) {
        return ctx.reply('⛔ Bu buton yalnızca yöneticilere özeldir.');
    }

    pendingCatAdminAuth[String(ctx.from.id)] = catId;

    return ctx.reply(
        `🔐 <b>Yönetici Doğrulaması — [${cat.key}] ${cat.name}</b>\n\n` +
        `Bu sekmeden ücretsiz yönetici testi izlemek için lütfen <b>yönetici şifresini</b> girin:\n\n` +
        `<i>İptal etmek için /iptal yazabilirsiniz.</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ İptal', 'admin_cancel_action')]])
        }
    );
});

// Kategori Medya Al Seçenekleri (1 - 3 - 5 - 10 Seçenekleri ile Toplu Gönderim)
bot.action(/cat_take_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const catId = ctx.match[1];
    const cat = db.getCategory(catId);
    if (!cat) return ctx.reply('Sekme bulunamadı.');

    const isAdmin = isAdminUser(ctx.from.id);

    // ⭐ Yıldızlı Özel Sekmeler Koruması (Admin BEDAVA)
    if (STAR_CATEGORIES[catId] && !isAdmin) {
        const starCfg = STAR_CATEGORIES[catId];
        return safeEditOrReply(ctx,
            `⭐ <b>ÖZEL SEKME: ${cat.name} (Özel İçerik)</b>\n\n` +
            `Bu sekmedeki içerikler <b>Video: ⭐ ${starCfg.videoPrice} Yıldız</b> | <b>Fotoğraf: ⭐ ${starCfg.photoPrice} Yıldız</b> ödenerek izlenebilir.\n\n` +
            `👇 Seçeneklerden birini seçin:`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`🎥 ⭐ ${starCfg.videoPrice} Yıldız ile 1 Video İzle`, `buy_cat_media_${catId}_video`)],
                    [Markup.button.callback(`📸 ⭐ ${starCfg.photoPrice} Yıldız ile 1 Fotoğraf İzle`, `buy_cat_media_${catId}_photo`)],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        );
    }

    return showCategoryTakeMenu(ctx, catId);
});

// Hemen Medya Al Butonu (Bildirimlerden veya Menüden)
bot.action('menu_take_media', async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id) || {};
    const vip = db.isUserVip(ctx.from.id);
    const vipText = vip.isVip ? `👑 <b>VIP:</b> Aktif (Sınırsız)` : `📸 <b>${user.photoCredits || 0}</b> Resim | 🎥 <b>${user.videoCredits || 0}</b> Video Krediniz var`;

    const text = 
`📥 <b>Medya Almak İstediğiniz Sekmeyi Seçin</b>\n\n` +
`${vipText}\n\n` +
`👇 Aşağıdaki sekmelerden birini seçerek havuzdan içerik alabilirsiniz:`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...getMainMenuKeyboard(ctx.from.id)
    });
});

// Kategoriye Medya Yükle Rehberi
bot.action(/cat_upload_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const catId = ctx.match[1];
    const cat = db.getCategory(catId);

    // ⭐ Yıldızlı Özel Sekmelere kullanıcılar doğrudan medya yükleyemez (Sadece Yıldız ile Satış)
    if (STAR_CATEGORIES[catId]) {
        const starCfg = STAR_CATEGORIES[catId];
        return safeEditOrReply(ctx,
            `⭐ <b>ÖZEL SEKME: [${cat.key}] ${cat.name}</b>\n\n` +
            `Bu sekme özel arşiv sekmesidir; kullanıcılar tarafından doğrudan medya yüklenemez.\n` +
            `İçerikler yalnızca <b>Telegram Yıldızları</b> ile izlenebilir (Video: ${starCfg.videoPrice}⭐, Fotoğraf: ${starCfg.photoPrice}⭐).\n\n` +
            `👇 İzlemek istediğiniz medya türünü seçin:`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`🎥 ⭐ ${starCfg.videoPrice} Yıldız ile 1 Video İzle`, `buy_cat_media_${catId}_video`)],
                    [Markup.button.callback(`📸 ⭐ ${starCfg.photoPrice} Yıldız ile 1 Fotoğraf İzle`, `buy_cat_media_${catId}_photo`)],
                    [Markup.button.callback('⬅️ Sekmeye Dön', `cat_view_${catId}`)],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        );
    }

    const text = 
`📤 <b>Medya Yükle</b>\n\n` +
`Lütfen bu sohbete doğrudan bir <b>Fotoğraf</b> veya <b>Video</b> gönderin.\n\n` +
`⏳ Gönderdiğiniz medya yöneticiye iletilir. Yönetici uygun klasöre yerleştirdikçe hesabınıza <b>kredi eklenir</b> ve size bildirim gönderilir.\n\n` +
`⚠️ <b>ÖNEMLİ KURAL:</b> Sistemde daha önce yüklenmiş olan aynı resim veya videolar kabul edilmez.`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('⬅️ Sekmeye Dön', `cat_view_${cat.id}`),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);

    return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
});

// Kategori Özel Medya Alma İşlemi (1 - 3 - 5 - 10 Seçenekleri Destekli)
bot.action(/take_media_(cat_\d+)_(photo|video)(?:_(\d+))?/, async (ctx) => {
    const catId = ctx.match[1];
    const mediaType = ctx.match[2];
    const rawCount = ctx.match[3];

    const isAdmin = isAdminUser(ctx.from.id);
    if (STAR_CATEGORIES[catId] && !isAdmin) {
        const starCfg = STAR_CATEGORIES[catId];
        const cat = db.getCategory(catId);
        return ctx.answerCbQuery(`⭐ ${cat?.name || 'Bu'} sekmesi Video: ${starCfg.videoPrice} Yıldız, Foto: ${starCfg.photoPrice} Yıldız ile izlenebilir!`, { show_alert: true });
    }

    if (rawCount) {
        const count = parseInt(rawCount) || 1;
        await sendMediaToUser(ctx, mediaType, catId, count);
    } else {
        await ctx.answerCbQuery();
        const cat = db.getCategory(catId);
        const isVideo = mediaType === 'video';
        const typeLabel = isVideo ? 'Video' : 'Resim';
        const typeIcon = isVideo ? '🎥' : '📸';
        const unseen = db.getUserCategoryUnseenCount(ctx.from.id, catId);
        const unseenCount = isVideo ? unseen.unseenVideos : unseen.unseenPhotos;
        const user = db.getUser(ctx.from.id) || {};
        const curCredits = isVideo ? (user.videoCredits || 0) : (user.photoCredits || 0);
        const vip = db.isUserVip(ctx.from.id);

        const text = 
`${typeIcon} <b>Toplu ${typeLabel} Gönderimi — ${cat ? cat.name : ''}</b>\n\n` +
`📊 <b>Bu Sekmede Kalan Yeni ${typeLabel}:</b> <b>${unseenCount} Adet</b>\n` +
`💰 <b>Mevcut Bakiyeniz:</b> <b>${vip.isVip ? '👑 Sınırsız VIP' : `${curCredits} Kredi`}</b>\n\n` +
`👇 <b>Kaç adet ${typeLabel.toLowerCase()} almak istiyorsunuz?</b>`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback(`⚡ 1 Adet ${typeLabel}`, `take_media_${catId}_${mediaType}_1`),
                Markup.button.callback(`📦 3 Adet ${typeLabel}`, `take_media_${catId}_${mediaType}_3`)
            ],
            [
                Markup.button.callback(`🚀 5 Adet ${typeLabel}`, `take_media_${catId}_${mediaType}_5`),
                Markup.button.callback(`👑 10 Adet ${typeLabel}`, `take_media_${catId}_${mediaType}_10`)
            ],
            [
                Markup.button.callback('⬅️ Geri', `cat_take_${catId}`),
                Markup.button.callback('🏠 Ana Menü', 'main_menu')
            ]
        ]);

        return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
    }
});

// ==================== TELEGRAM YILDIZLARI (STARS) PAKET VE ÖDEME SİSTEMİ ====================

// Paket Marketi Ana Menüsü
bot.action(['menu_packages', 'menu_vip'], async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id) || {};
    const vip = db.isUserVip(ctx.from.id);
    const vipText = vip.isVip 
        ? (vip.isUnlimited ? `👑 <b>VIP:</b> Aktif (👑 Yönetici / Sınırsız VIP)` : `👑 <b>VIP:</b> Aktif (${vip.remainingHours} saat kaldı)`)
        : `👑 <b>VIP:</b> Standart`;

    const text = 
`⭐ <b>Telegram Yıldızları (Stars) Paket Marketi</b>\n\n` +
`Medya yükleme zorunluluğu olmadan Telegram Yıldızları ile anında Video, Fotoğraf kredisi veya Sınırsız VIP satın alabilirsiniz.\n\n` +
`👤 <b>Mevcut Bakiyeniz:</b>\n` +
`📸 Resim Krediniz: <code>${user.photoCredits || 0}</code>\n` +
`🎥 Video Krediniz: <code>${user.videoCredits || 0}</code>\n` +
`${vipText}\n\n` +
`💎 <b>Öne Çıkan Paketler:</b>\n` +
`• 🎥 <b>1 Yıldız:</b> 1 Video Kredisi\n` +
`• 🎥 <b>10 Yıldız:</b> 10 Video Kredisi\n` +
`• 🎥 <b>20 Yıldız:</b> 20 Video Kredisi\n` +
`• 📸 <b>1 Yıldız:</b> 1 Fotoğraf Kredisi\n` +
`• 📸 <b>10 Yıldız:</b> 10 Fotoğraf Kredisi\n` +
`• 📸 <b>20 Yıldız:</b> 20 Fotoğraf Kredisi\n` +
`• 🔥 <b>Avantajlı Kombo & VIP Paketleri</b>\n\n` +
`👇 Lütfen incelemek ve satın almak istediğiniz paketi seçin:`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...getPackagesMenuKeyboard()
    });
});

// Video Paketleri Sekmesi
bot.action('pkg_tab_video', async (ctx) => {
    await ctx.answerCbQuery();
    const text = 
`🎥 <b>Video Kredisi Paketleri (Telegram Yıldızları)</b>\n\n` +
`İstediğiniz paketi seçtiğinizde anında Telegram üzerinden yıldız ile ödeme yapabilirsiniz. Krediler hesabınıza otomatik ve anında tanımlanır:\n\n` +
`• 🎥 <b>1 Video:</b> 1 Yıldız ⭐\n` +
`• 🎥 <b>10 Video:</b> 10 Yıldız ⭐\n` +
`• 🎥 <b>20 Video:</b> 20 Yıldız ⭐\n` +
`• 🎥 <b>50 Video:</b> 45 Yıldız ⭐ <i>(%10 İndirimli)</i>\n\n` +
`👇 Satın almak istediğiniz video paketini seçin:`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...getVideoPackagesKeyboard()
    });
});

// Fotoğraf Paketleri Sekmesi
bot.action('pkg_tab_photo', async (ctx) => {
    await ctx.answerCbQuery();
    const text = 
`📸 <b>Fotoğraf Kredisi Paketleri (Telegram Yıldızları)</b>\n\n` +
`İstediğiniz paketi seçerek tek tıkla fotoğraf kredisi yükleyebilirsiniz. Kredileriniz hesabınıza anında tanımlanır:\n\n` +
`• 📸 <b>1 Fotoğraf:</b> 1 Yıldız ⭐\n` +
`• 📸 <b>10 Fotoğraf:</b> 10 Yıldız ⭐\n` +
`• 📸 <b>20 Fotoğraf:</b> 20 Yıldız ⭐\n` +
`• 📸 <b>50 Fotoğraf:</b> 45 Yıldız ⭐ <i>(%10 İndirimli)</i>\n\n` +
`👇 Satın almak istediğiniz fotoğraf paketini seçin:`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...getPhotoPackagesKeyboard()
    });
});

// Kombo Paketler Sekmesi
bot.action('pkg_tab_combo', async (ctx) => {
    await ctx.answerCbQuery();
    const text = 
`🔥 <b>Süper Kombo Paketler (Hem Resim Hem Video)</b>\n\n` +
`Hem resim hem video kredisini tek pakette indirimli olarak satın alabilirsiniz:\n\n` +
`• 🔥 <b>10 Video + 10 Fotoğraf:</b> 18 Yıldız ⭐ <i>(İndirimli)</i>\n` +
`• 🔥 <b>20 Video + 20 Fotoğraf:</b> 35 Yıldız ⭐ <i>(Süper Fırsat)</i>\n` +
`• 🔥 <b>50 Video + 50 Fotoğraf:</b> 80 Yıldız ⭐ <i>(En Popüler)</i>\n\n` +
`👇 Satın almak istediğiniz kombo paketi seçin:`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...getComboPackagesKeyboard()
    });
});

// VIP Paketleri Sekmesi
bot.action('pkg_tab_vip', async (ctx) => {
    await ctx.answerCbQuery();
    const vip = db.isUserVip(ctx.from.id);
    const vipStatusText = vip.isVip 
        ? (vip.isUnlimited 
            ? `✅ <b>Mevcut Durum:</b> 👑 <b>Yönetici Sınırsız VIP Aktif</b>\n\n`
            : `✅ <b>Mevcut Durum:</b> VIP Aktif (${vip.remainingHours} saat kaldı)\n\n`)
        : `ℹ️ <b>Mevcut Durum:</b> Standart Üyelik\n\n`;

    const text = 
`👑 <b>Sınırsız VIP Üyelik Ayrıcalıkları</b>\n\n` +
`${vipStatusText}💎 <b>VIP Avantajları:</b>\n` +
`• Süre boyunca <b>SINIRSIZ</b> resim ve video alma hakkı (0 Kredi harcanır).\n` +
`• Medya yükleme şartı olmadan tüm havuzu sınırsız kullanma.\n\n` +
`🌟 <b>VIP Paketleri:</b>\n` +
`• 🌟 <b>1 Günlük VIP:</b> 100 Yıldız ⭐\n` +
`• 🌟 <b>2 Günlük VIP:</b> 150 Yıldız ⭐\n` +
`• 🌟 <b>3 Günlük VIP:</b> 250 Yıldız ⭐\n\n` +
`👇 Satın almak istediğiniz VIP süresini seçin:`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...getVipPackagesKeyboard()
    });
});

// ==================== FATURA OLUŞTURMA İŞLEMLERİ (INVOICES) ====================

// Video Faturaları
bot.action('buy_vid_1', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🎥 1 Video Kredisi',
        description: 'Hesabınıza anında +1 Video Kredisi tanımlanır.',
        payload: 'pkg_video_1',
        currency: 'XTR',
        prices: [{ label: '1 Video Kredisi', amount: 1 }],
        provider_token: ''
    });
});

bot.action('buy_vid_10', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🎥 10 Video Kredisi',
        description: 'Hesabınıza anında +10 Video Kredisi tanımlanır.',
        payload: 'pkg_video_10',
        currency: 'XTR',
        prices: [{ label: '10 Video Kredisi', amount: 10 }],
        provider_token: ''
    });
});

bot.action('buy_vid_20', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🎥 20 Video Kredisi',
        description: 'Hesabınıza anında +20 Video Kredisi tanımlanır.',
        payload: 'pkg_video_20',
        currency: 'XTR',
        prices: [{ label: '20 Video Kredisi', amount: 20 }],
        provider_token: ''
    });
});

bot.action('buy_vid_50', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🎥 50 Video Kredisi (İndirimli)',
        description: 'Hesabınıza anında +50 Video Kredisi tanımlanır (%10 İndirimli).',
        payload: 'pkg_video_50',
        currency: 'XTR',
        prices: [{ label: '50 Video Kredisi', amount: 45 }],
        provider_token: ''
    });
});

// Fotoğraf Faturaları
bot.action('buy_pho_1', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '📸 1 Fotoğraf Kredisi',
        description: 'Hesabınıza anında +1 Fotoğraf Kredisi tanımlanır.',
        payload: 'pkg_photo_1',
        currency: 'XTR',
        prices: [{ label: '1 Fotoğraf Kredisi', amount: 1 }],
        provider_token: ''
    });
});

bot.action('buy_pho_10', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '📸 10 Fotoğraf Kredisi',
        description: 'Hesabınıza anında +10 Fotoğraf Kredisi tanımlanır.',
        payload: 'pkg_photo_10',
        currency: 'XTR',
        prices: [{ label: '10 Fotoğraf Kredisi', amount: 10 }],
        provider_token: ''
    });
});

bot.action('buy_pho_20', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '📸 20 Fotoğraf Kredisi',
        description: 'Hesabınıza anında +20 Fotoğraf Kredisi tanımlanır.',
        payload: 'pkg_photo_20',
        currency: 'XTR',
        prices: [{ label: '20 Fotoğraf Kredisi', amount: 20 }],
        provider_token: ''
    });
});

bot.action('buy_pho_50', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '📸 50 Fotoğraf Kredisi (İndirimli)',
        description: 'Hesabınıza anında +50 Fotoğraf Kredisi tanımlanır (%10 İndirimli).',
        payload: 'pkg_photo_50',
        currency: 'XTR',
        prices: [{ label: '50 Fotoğraf Kredisi', amount: 45 }],
        provider_token: ''
    });
});

// Kombo Faturaları
bot.action('buy_com_10', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🔥 10 Video + 10 Fotoğraf Paketi',
        description: 'Hesabınıza anında +10 Video ve +10 Fotoğraf Kredisi tanımlanır.',
        payload: 'pkg_combo_10',
        currency: 'XTR',
        prices: [{ label: '10 Video + 10 Fotoğraf', amount: 18 }],
        provider_token: ''
    });
});

bot.action('buy_com_20', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🔥 20 Video + 20 Fotoğraf Paketi',
        description: 'Hesabınıza anında +20 Video ve +20 Fotoğraf Kredisi tanımlanır.',
        payload: 'pkg_combo_20',
        currency: 'XTR',
        prices: [{ label: '20 Video + 20 Fotoğraf', amount: 35 }],
        provider_token: ''
    });
});

bot.action('buy_com_50', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🔥 50 Video + 50 Fotoğraf Paketi',
        description: 'Hesabınıza anında +50 Video ve +50 Fotoğraf Kredisi tanımlanır.',
        payload: 'pkg_combo_50',
        currency: 'XTR',
        prices: [{ label: '50 Video + 50 Fotoğraf', amount: 80 }],
        provider_token: ''
    });
});

// VIP Faturaları
bot.action('buy_vip_1', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🌟 1 Günlük VIP Üyelik',
        description: '1 Gün boyunca sınırsız resim ve video erişimi.',
        payload: 'vip_1_day',
        currency: 'XTR',
        prices: [{ label: '1 Günlük VIP', amount: 100 }],
        provider_token: ''
    });
});

bot.action('buy_vip_2', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🌟 2 Günlük VIP Üyelik',
        description: '2 Gün boyunca sınırsız resim ve video erişimi.',
        payload: 'vip_2_days',
        currency: 'XTR',
        prices: [{ label: '2 Günlük VIP', amount: 150 }],
        provider_token: ''
    });
});

bot.action('buy_vip_3', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '🌟 3 Günlük VIP Üyelik',
        description: '3 Gün boyunca sınırsız resim ve video erişimi.',
        payload: 'vip_3_days',
        currency: 'XTR',
        prices: [{ label: '3 Günlük VIP', amount: 250 }],
        provider_token: ''
    });
});

// ⭐ İFSA ÖZEL İÇERİK FATURALARI (VİDEO 5 YILDIZ, FOTOĞRAF 1 YILDIZ)
bot.action('buy_ifsa_video', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '⭐ İfsa Özel Video Erişimi',
        description: 'İfsa sekmesinden 1 adet özel video izleme hakkı.',
        payload: 'ifsa_video_single',
        currency: 'XTR',
        prices: [{ label: '5 Yıldız', amount: 5 }],
        provider_token: ''
    });
});

bot.action('buy_ifsa_photo', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '⭐ İfsa Özel Fotoğraf Erişimi',
        description: 'İfsa sekmesinden 1 adet özel fotoğraf izleme hakkı.',
        payload: 'ifsa_photo_single',
        currency: 'XTR',
        prices: [{ label: '1 Yıldız', amount: 1 }],
        provider_token: ''
    });
});

// ⭐ ÖZEL SEKME YILDIZ FATURALARI (DİNAMİK: Ensest, İfsa, Onlyfans, Gizli Çekim vb.)
bot.action(/buy_cat_media_(cat_\d+)_(video|photo)/, async (ctx) => {
    await ctx.answerCbQuery();
    const catId = ctx.match[1];
    const type = ctx.match[2];
    const cat = db.getCategory(catId);
    const starCfg = STAR_CATEGORIES[catId];
    if (!starCfg || !cat) return ctx.reply('Geçersiz sekme!');

    const isVideo = type === 'video';
    const amount = isVideo ? starCfg.videoPrice : starCfg.photoPrice;
    const typeLabel = isVideo ? 'Video' : 'Fotoğraf';

    return ctx.replyWithInvoice({
        title: `⭐ ${cat.name} Özel ${typeLabel} Erişimi`,
        description: `${cat.name} sekmesinden 1 adet özel ${typeLabel.toLowerCase()} izleme hakkı.`,
        payload: `cat_star_${catId}_${type}`,
        currency: 'XTR',
        prices: [{ label: `${amount} Yıldız`, amount: amount }],
        provider_token: ''
    });
});

// ⭐ ONLYFANS ÖZEL İÇERİK FATURALARI (VİDEO 10 YILDIZ, FOTOĞRAF 3 YILDIZ)
bot.action('buy_onlyfans_video', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '⭐ Onlyfans Özel Video Erişimi',
        description: 'Onlyfans sekmesinden 1 adet özel video izleme hakkı.',
        payload: 'onlyfans_video_single',
        currency: 'XTR',
        prices: [{ label: '10 Yıldız', amount: 10 }],
        provider_token: ''
    });
});

bot.action('buy_onlyfans_photo', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithInvoice({
        title: '⭐ Onlyfans Özel Fotoğraf Erişimi',
        description: 'Onlyfans sekmesinden 1 adet özel fotoğraf izleme hakkı.',
        payload: 'onlyfans_photo_single',
        currency: 'XTR',
        prices: [{ label: '3 Yıldız', amount: 3 }],
        provider_token: ''
    });
});

// ⭐ MEDYAYA YILDIZ ATMA (1, 5, 10 YILDIZ - 10 YILDIZ KAYDETME İZNİ VERİR)
bot.action(/tip_m_(.+)_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const mediaId = ctx.match[1];
    const amount = parseInt(ctx.match[2]) || 1;
    const media = db.getMedia(mediaId);

    const isVideo = media ? media.type === 'video' : false;
    const typeLabel = isVideo ? 'Video' : 'Fotoğraf';

    let title = '';
    let description = '';

    if (amount === 10) {
        title = `⭐ 10 Yıldız — ${typeLabel} İndir & Kaydet`;
        description = `Bu ${typeLabel.toLowerCase()}yu korumasız olarak cihazınıza/galerinize kaydetmek için 10 Yıldız ödeyin.`;
    } else if (amount === 5) {
        title = `⭐ 5 Yıldız Bahşiş (+1 Kredi Hediye)`;
        description = `Bu içeriğe 5 Telegram Yıldızı bahşiş gönderin. Teşekkür olarak hesabınıza +1 ${typeLabel} Kredisi yüklenecektir!`;
    } else {
        title = `⭐ 1 Yıldız Bahşiş`;
        description = `Bu ${typeLabel.toLowerCase()} için 1 Telegram Yıldızı ile takdirinizi gösterin.`;
    }

    return ctx.replyWithInvoice({
        title,
        description,
        payload: `tip_media_${amount}_${mediaId}`,
        currency: 'XTR',
        prices: [{ label: `${amount} Yıldız`, amount: amount }],
        provider_token: ''
    });
});

// Ödeme Ön Kontrolü (Pre Checkout)
bot.on('pre_checkout_query', async (ctx) => {
    try {
        console.log(`⭐ PreCheckoutQuery alındı: ID ${ctx.preCheckoutQuery?.id}, Kullanıcı ${ctx.from?.id}, Payload ${ctx.preCheckoutQuery?.invoice_payload}`);
        await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
        console.error('PreCheckoutQuery yanıtlama hatası:', err.message);
    }
});

// Merkezi Başarılı Ödeme İşleme Fonksiyonu (Deduplication + Bakiye Tanımlama + Bildirim)
async function processSuccessfulPayment(userId, payload, totalAmount, userMeta = {}, chargeId = null) {
    const uid = String(userId);
    
    // Eğer işlem daha önce işlendiyse mükerrer kredi yüklemeyi engelle
    if (chargeId && db.isTransactionProcessed(chargeId)) {
        console.log(`⚠️ Ödeme zaten işlenmiş, atlandı: ${chargeId}`);
        return false;
    }

    console.log(`💰 [ÖDEME İŞLENİYOR] Kullanıcı: ${uid}, Payload: ${payload}, Tutar: ${totalAmount} Yıldız, Tx: ${chargeId || 'yok'}`);

    // Kullanıcının sistemde kaydı yoksa oluştur
    db.getOrCreateUser({ id: uid, first_name: userMeta.first_name || '', username: userMeta.username || null });

    let successMsg = '';

    // 1. VIP Paketleri
    if (payload.startsWith('vip_')) {
        let days = 1;
        if (payload === 'vip_1_day') days = 1;
        else if (payload === 'vip_2_days') days = 2;
        else if (payload === 'vip_3_days') days = 3;

        db.addVipDays(uid, days);
        const vip = db.isUserVip(uid);

        successMsg = `🎉 <b>Tebrikler! ${days} Günlük VIP Üyeliğiniz Başarıyla Tanımlandı!</b>\n\n👑 <b>Bitiş Tarihi:</b> ${vip.until}\nSüre boyunca kredi harcamadan dilediğiniz gibi sınırsız medya alabilirsiniz.`;

        if (ADMIN_ID) {
            bot.telegram.sendMessage(
                ADMIN_ID,
                `💰 <b>YENİ VIP SATIŞI!</b>\n👤 <b>Kullanıcı:</b> ${userMeta.first_name || ''} (@${userMeta.username || 'yok'})\n🆔 ID: <code>${uid}</code>\n⭐ Tutar: ${totalAmount} Yıldız (${days} Günlük VIP)`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    }
    // 2. Video Paketleri
    else if (payload.startsWith('pkg_video_')) {
        const amount = parseInt(payload.replace('pkg_video_', ''), 10) || 1;
        db.updateCredits(uid, 'video', amount);
        const user = db.getUser(uid) || {};

        successMsg = `🎉 <b>ÖDEME BAŞARILI!</b>\n\n` +
            `⭐ <b>Ödenen:</b> ${totalAmount} Telegram Yıldızı\n` +
            `🎥 <b>Hesabınıza Eklenen:</b> <b>+${amount} Video Kredisi</b>\n` +
            `📊 <b>Toplam Video Krediniz:</b> <code>${user.videoCredits || 0}</code>\n\n` +
            `<i>Hemen sekmelerden video almaya başlayabilirsiniz!</i>`;

        if (ADMIN_ID) {
            bot.telegram.sendMessage(
                ADMIN_ID,
                `💰 <b>YENİ VİDEO PAKETİ SATIŞI!</b>\n👤 <b>Kullanıcı:</b> ${userMeta.first_name || ''} (@${userMeta.username || 'yok'})\n🆔 ID: <code>${uid}</code>\n📦 Paket: +${amount} Video\n⭐ Tutar: ${totalAmount} Yıldız`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    }
    // 3. Fotoğraf Paketleri
    else if (payload.startsWith('pkg_photo_')) {
        const amount = parseInt(payload.replace('pkg_photo_', ''), 10) || 1;
        db.updateCredits(uid, 'photo', amount);
        const user = db.getUser(uid) || {};

        successMsg = `🎉 <b>ÖDEME BAŞARILI!</b>\n\n` +
            `⭐ <b>Ödenen:</b> ${totalAmount} Telegram Yıldızı\n` +
            `📸 <b>Hesabınıza Eklenen:</b> <b>+${amount} Fotoğraf Kredisi</b>\n` +
            `📊 <b>Toplam Resim Krediniz:</b> <code>${user.photoCredits || 0}</code>\n\n` +
            `<i>Hemen sekmelerden fotoğraf almaya başlayabilirsiniz!</i>`;

        if (ADMIN_ID) {
            bot.telegram.sendMessage(
                ADMIN_ID,
                `💰 <b>YENİ FOTOĞRAF PAKETİ SATIŞI!</b>\n👤 <b>Kullanıcı:</b> ${userMeta.first_name || ''} (@${userMeta.username || 'yok'})\n🆔 ID: <code>${uid}</code>\n📦 Paket: +${amount} Fotoğraf\n⭐ Tutar: ${totalAmount} Yıldız`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    }
    // 4. Kombo Paketler
    else if (payload.startsWith('pkg_combo_')) {
        const amount = parseInt(payload.replace('pkg_combo_', ''), 10) || 10;
        db.updateCredits(uid, 'photo', amount);
        db.updateCredits(uid, 'video', amount);
        const user = db.getUser(uid) || {};

        successMsg = `🎉 <b>KOMBO PAKET ÖDEMESİ BAŞARILI!</b>\n\n` +
            `⭐ <b>Ödenen:</b> ${totalAmount} Telegram Yıldızı\n` +
            `💰 <b>Hesabınıza Eklenen:</b>\n` +
            `• <b>+${amount} Fotoğraf Kredisi</b>\n` +
            `• <b>+${amount} Video Kredisi</b>\n\n` +
            `📊 <b>Güncel Bakiyeniz:</b> 📸 ${user.photoCredits || 0} Resim | 🎥 ${user.videoCredits || 0} Video\n\n` +
            `<i>Hemen dilediğiniz sekmeden medya alabilirsiniz!</i>`;

        if (ADMIN_ID) {
            bot.telegram.sendMessage(
                ADMIN_ID,
                `💰 <b>YENİ KOMBO PAKET SATIŞI!</b>\n👤 <b>Kullanıcı:</b> ${userMeta.first_name || ''} (@${userMeta.username || 'yok'})\n🆔 ID: <code>${uid}</code>\n📦 Paket: +${amount} Video & +${amount} Fotoğraf\n⭐ Tutar: ${totalAmount} Yıldız`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    }
    // 5. Telegram Yıldızlı Özel Sekme İçerik Satın Alımı (Ensest, İfsa, Onlyfans, Gizli Çekim vb.)
    else if (payload.startsWith('cat_star_') || payload === 'ifsa_video_single' || payload === 'ifsa_photo_single' || payload === 'onlyfans_video_single' || payload === 'onlyfans_photo_single') {
        let targetCatId = 'cat_3';
        let isVideo = false;

        if (payload.startsWith('cat_star_')) {
            const parts = payload.split('_'); // ['cat', 'star', 'cat_1', 'video']
            targetCatId = parts[2];
            isVideo = parts[3] === 'video';
        } else if (payload.startsWith('ifsa_')) {
            targetCatId = 'cat_3';
            isVideo = payload === 'ifsa_video_single';
        } else if (payload.startsWith('onlyfans_')) {
            targetCatId = 'cat_5';
            isVideo = payload === 'onlyfans_video_single';
        }

        const cat = db.getCategory(targetCatId);
        const starCfg = STAR_CATEGORIES[targetCatId] || { videoPrice: isVideo ? 5 : 1, photoPrice: 1 };
        const type = isVideo ? 'video' : 'photo';
        const typeLabel = isVideo ? 'Video' : 'Fotoğraf';
        const nextPrice = isVideo ? starCfg.videoPrice : starCfg.photoPrice;

        // Sekmeden medya çek (kredi düşmeden)
        let media = db.getRandomMedia(uid, type, targetCatId, true);
        if (!media) {
            const allCatMedia = db.getCategoryMedia(targetCatId, type);
            if (allCatMedia && allCatMedia.length > 0) {
                media = allCatMedia[Math.floor(Math.random() * allCatMedia.length)];
            }
        }

        successMsg = `🎉 <b>ÖDEME BAŞARILI!</b>\n\n` +
            `⭐ <b>Ödenen:</b> ${totalAmount} Telegram Yıldızı\n` +
            `📂 <b>Sekme:</b> [${cat?.key || ''}] ${cat?.name || 'Özel Sekme'}\n\n` +
            `<i>${typeLabel} içeriğiniz aşağıda gönderiliyor...</i>`;

        if (media) {
            setTimeout(async () => {
                const caption = `⭐ <b>${cat?.name || 'Özel'} ${typeLabel} İçeriği</b>\n\n` +
                    `🔒 <i>${totalAmount} Telegram Yıldızı ile satın alındı. İyi seyirler!</i>`;
                const nextLabel = `⭐ 1 ${typeLabel} Daha İzle (${nextPrice} Yıldız)`;
                const buttons = Markup.inlineKeyboard([
                    [
                        Markup.button.callback('⭐ 1', `tip_m_${media.id}_1`),
                        Markup.button.callback('⭐ 5', `tip_m_${media.id}_5`),
                        Markup.button.callback('⭐ 10 (Kaydedebilir)', `tip_m_${media.id}_10`)
                    ],
                    [Markup.button.callback(nextLabel, `buy_cat_media_${targetCatId}_${type}`)],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ]);
                try {
                    if (isVideo) {
                        await bot.telegram.sendVideo(uid, media.fileId, {
                            caption,
                            parse_mode: 'HTML',
                            protect_content: true,
                            ...buttons
                        });
                    } else {
                        await bot.telegram.sendPhoto(uid, media.fileId, {
                            caption,
                            parse_mode: 'HTML',
                            protect_content: true,
                            ...buttons
                        });
                    }
                } catch (e) {
                    console.error(`${cat?.name} medya teslim hatası:`, e.message);
                }
            }, 600);
        } else {
            successMsg += `\n\n⚠️ <i>Şu an bu sekmede uygun ${typeLabel.toLowerCase()} bulunamadı. Lütfen yöneticiye bildiriniz.</i>`;
        }

        if (ADMIN_ID) {
            bot.telegram.sendMessage(
                ADMIN_ID,
                `💰 <b>YENİ YILDIZLI İÇERİK SATIŞI!</b>\n👤 <b>Kullanıcı:</b> ${userMeta.first_name || ''} (@${userMeta.username || 'yok'})\n🆔 ID: <code>${uid}</code>\n📂 Sekme: ${cat?.name || targetCatId} (${typeLabel})\n⭐ Tutar: ${totalAmount} Yıldız`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    }
    // 7. Medyaya Yıldız Bahşişi & Kaydetme İzni (1, 5, 10 Yıldız)
    else if (payload.startsWith('tip_media_')) {
        const parts = payload.split('_'); // ['tip', 'media', '10', '<mediaId>']
        const amount = parseInt(parts[2]) || totalAmount || 1;
        const mediaId = parts.slice(3).join('_');
        const media = db.getMedia(mediaId);

        if (media) {
            db.addMediaStars(mediaId, amount);
        }

        const isVideo = media ? media.type === 'video' : false;
        const typeLabel = isVideo ? 'Video' : 'Fotoğraf';

        if (amount >= 10) {
            successMsg = `🎉 <b>ÖDEME BAŞARILI! (⭐ ${totalAmount} Yıldız)</b>\n\n` +
                `💾 <b>KAYDETME İZNİNİZ AÇILDI!</b>\n` +
                `Bu ${typeLabel.toLowerCase()} korumasız olarak aşağıda gönderiliyor. Artık cihazınıza/galerinize kaydedebilir veya iletebilirsiniz.`;

            if (media) {
                setTimeout(async () => {
                    const caption = `💾 <b>KORUMASIZ ${typeLabel.toUpperCase()} (İndirme & Kaydetme Serbest)</b>\n\n` +
                        `⭐ <i>10 Yıldız ödemeniz onaylandı. Medyayı cihazınıza kaydedebilir veya dilediğiniz gibi iletebilirsiniz!</i>`;
                    const buttons = Markup.inlineKeyboard([
                        [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                    ]);
                    try {
                        if (isVideo) {
                            await bot.telegram.sendVideo(uid, media.fileId, {
                                caption,
                                parse_mode: 'HTML',
                                protect_content: false, // 🔓 İNDİRME VE KAYDETME AÇIK!
                                ...buttons
                            });
                        } else {
                            await bot.telegram.sendPhoto(uid, media.fileId, {
                                caption,
                                parse_mode: 'HTML',
                                protect_content: false, // 🔓 İNDİRME VE KAYDETME AÇIK!
                                ...buttons
                            });
                        }
                    } catch (e) {
                        console.error('Korumasız medya teslim hatası:', e.message);
                    }
                }, 600);
            }
        } else if (amount === 5) {
            db.updateCredits(uid, isVideo ? 'video' : 'photo', 1);
            successMsg = `🎉 <b>TEŞEKKÜRLER! (⭐ 5 Yıldız Bahşiş)</b>\n\n` +
                `❤️ Bu içeriğe gönderdiğiniz 5 Yıldız bahşiş başarıyla alındı!\n` +
                `🎁 Teşekkür hediyesi olarak hesabınıza <b>+1 ${typeLabel} Kredisi</b> yüklendi!`;
        } else {
            successMsg = `🎉 <b>TEŞEKKÜRLER! (⭐ 1 Yıldız Bahşiş)</b>\n\n` +
                `❤️ Bu içeriğe gönderdiğiniz 1 Yıldız bahşiş başarıyla alındı. Desteğiniz için teşekkür ederiz!`;
        }

        if (ADMIN_ID) {
            bot.telegram.sendMessage(
                ADMIN_ID,
                `💰 <b>YENİ YILDIZ BAHŞİŞİ / İNDİRME!</b>\n👤 <b>Kullanıcı:</b> ${userMeta.first_name || ''} (@${userMeta.username || 'yok'})\n🆔 ID: <code>${uid}</code>\n⭐ Tutar: ${totalAmount} Yıldız${amount >= 10 ? ' (İndirme & Kaydetme)' : ''}`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    }

    // Şans Çarkı Bonusu: VIP üyelik alanlara veya 100+ Yıldız harcama yapanlara çark hakkı verilir
    let wheelSpinsAwarded = 0;
    if (payload.startsWith('vip_') || totalAmount >= 100) {
        wheelSpinsAwarded = Math.max(1, Math.floor(totalAmount / 100));
        db.addWheelSpins(uid, wheelSpinsAwarded);
    }

    if (chargeId) {
        db.markTransactionProcessed(chargeId, {
            userId: uid,
            payload: payload,
            amount: totalAmount
        });
    }

    if (wheelSpinsAwarded > 0) {
        successMsg += `\n\n🎡 <b>ÖZEL BONUS:</b> Harcamanız karşılığında <b>+${wheelSpinsAwarded} Şans Çarkı Hakkı</b> kazandınız!\n<i>Şans çarkını çevirerek 1 ile 10 adet Video Kredisi kazanabilirsiniz!</i>`;
    }

    if (successMsg) {
        const paySuccessButtons = [];
        if (wheelSpinsAwarded > 0) {
            paySuccessButtons.push([Markup.button.callback('🎡 Şans Çarkını Çevir!', 'wheel_menu')]);
        }
        paySuccessButtons.push([Markup.button.callback('📥 Hemen Medya Al', 'menu_take_media')]);
        paySuccessButtons.push([Markup.button.callback('🏠 Ana Menü', 'main_menu')]);

        bot.telegram.sendMessage(uid, successMsg, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(paySuccessButtons)
        }).catch((err) => console.error(`Kullanıcıya (${uid}) ödeme teyit mesajı gönderilemedi:`, err.message));
    }

    console.log(`✅ [ÖDEME TAMAMLANDI] Kullanıcı: ${uid}, Krediler başarıyla yüklendi.`);
    return true;
}

// Telegram Yıldızları Geçmişini / Eksik Ödemeleri Otomatik Senkronize Et
async function syncStarTransactions() {
    try {
        const res = await bot.telegram.callApi('getStarTransactions', { limit: 50 });
        if (!res || !res.transactions || !Array.isArray(res.transactions)) return;

        for (const tx of res.transactions) {
            if (tx.amount <= 0) continue;
            const txId = tx.id;
            if (db.isTransactionProcessed(txId)) continue;

            const source = tx.source;
            if (!source || source.transaction_type !== 'invoice_payment') continue;
            const user = source.user;
            const payload = source.invoice_payload;
            if (!user || !user.id || !payload) continue;

            console.log(`⭐ [Eksik Yıldız Ödemesi Yakalandı]: Tx ${txId}, Kullanıcı ${user.id}, Paket ${payload}, Tutar ${tx.amount}`);
            await processSuccessfulPayment(user.id, payload, tx.amount, user, txId);
        }
    } catch (err) {
        console.error('Yıldız senkronizasyon kontrol hatası:', err.message);
    }
}

// Başarılı Ödeme (Telegram Stars)
bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const payload = payment.invoice_payload;
    const userId = ctx.from.id;
    const chargeId = payment.telegram_payment_charge_id || `pay_${Date.now()}`;
    await processSuccessfulPayment(userId, payload, payment.total_amount, ctx.from, chargeId);
});

// Resim Yükleme Rehberi
bot.action('guide_photo_upload', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply(
        `📸 <b>Fotoğraf Yükleme</b>\n\n` +
        `Lütfen bu sohbete doğrudan bir fotoğraf veya albüm gönderin.\n` +
        `Fotoğraflarınız sistem tarafından otomatik taranır. <b>Her 5 özgün fotoğraf için hesabınıza +1 Resim Kredisi</b> tanımlanır.\n\n` +
        `⚠️ <b>ÖNEMLİ KURAL:</b> Daha önce yüklenmiş aynı fotoğrafı tekrar yüklemek yasaktır; sistem mükerrer medyaları otomatik siler!`,
        { parse_mode: 'HTML' }
    );
});

// Video Yükleme Rehberi
bot.action('guide_video_upload', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply(
        `🎥 <b>Video Yükleme</b>\n\n` +
        `Lütfen bu sohbete doğrudan bir video gönderin.\n` +
        `Videolarınız sistem tarafından otomatik taranır. <b>Her 5 özgün video için hesabınıza +1 Video Kredisi</b> tanımlanır.\n\n` +
        `⚠️ <b>ÖNEMLİ KURAL:</b> Daha önce yüklenmiş aynı videoyu tekrar yüklemek yasaktır; sistem mükerrer medyaları otomatik siler!`,
        { parse_mode: 'HTML' }
    );
});

// Medya Açıklama Metnini Oluşturucu
function getMediaCaption(media, userId) {
    const isVideo = media.type === 'video';
    const typeLabel = isVideo ? 'Video' : 'Resim';
    const cat = db.getCategory(media.categoryId);
    const catName = cat ? cat.name : 'Genel';
    const catKey = cat ? cat.key : '';
    const user = db.getUser(userId) || {};
    const vip = db.isUserVip(userId);
    const isAdmin = isAdminUser(userId);
    const remainingCredits = isVideo ? (user.videoCredits || 0) : (user.photoCredits || 0);

    const creditInfo = vip.isVip 
        ? (vip.isUnlimited ? `👑 Yönetici VIP Üyesisiniz (Sınırsız / Kredi harcanmaz)` : `👑 VIP Üyesiniz (Kalan: ${vip.remainingHours} saat)`)
        : `${isVideo ? '🎥' : '📸'} Kalan ${typeLabel} Krediniz: <code>${remainingCredits}</code>`;

    return `🎁 <b>İşte takas ${typeLabel.toLowerCase()}niz!</b>\n` +
           `📁 <b>Sekme:</b> [${catKey}] <b>${catName}</b>\n` +
           `${creditInfo}` + 
           (isAdmin ? `\n\n🔓 <i>Yönetici olduğunuz için indirme ve kaydetme serbesttir.</i>` : `\n\n🔒 <i>Bu medya içerik korumalıdır; indirilmesi veya iletilmesi engellenmiştir.</i>`);
}

// Medya Butonlarını Oluşturucu (İyi/Kötü Oy & Sekme Taşıma & Diğer İşlemler)
function getMediaActionKeyboard(media, userId, userVote = null) {
    const isVideo = media.type === 'video';
    const typeLabel = isVideo ? 'Video' : 'Resim';
    const catId = media.categoryId || 'cat_1';
    const isAdmin = isAdminUser(userId);
    const isIfsa = catId === 'cat_3';

    const likes = Array.isArray(media.likes) ? media.likes : [];
    const dislikes = Array.isArray(media.dislikes) ? media.dislikes : [];
    const uid = String(userId);

    const isGood = userVote === 'good' || (!userVote && likes.includes(uid));
    const isBad = userVote === 'bad' || (!userVote && dislikes.includes(uid));

    const goodLabel = isGood ? `👍 İyi (${likes.length}) ✅` : `👍 İyi${likes.length > 0 ? ` (${likes.length})` : ''}`;
    const badLabel = isBad ? `👎 Kötü (${dislikes.length}) ❌` : `👎 Kötü${dislikes.length > 0 ? ` (${dislikes.length})` : ''}`;

    // ⭐ Yıldızlı sekme kontrolü: "Daha Al" butonları yıldız satın almaya yönlendirir (admin hariç)
    const starCfg = STAR_CATEGORIES[catId];
    const repeatRow = starCfg && !isAdmin
        ? [
            Markup.button.callback(
                `⭐ ${isVideo ? `${starCfg.videoPrice} Yıldız ile 1 Video` : `${starCfg.photoPrice} Yıldız ile 1 Fotoğraf`} Daha İzle`,
                `buy_cat_star_${catId}_${media.type}`
            )
          ]
        : [
            Markup.button.callback(`🔄 1 ${typeLabel} Daha Al`, `take_media_${catId}_${media.type}_1`),
            Markup.button.callback(`📦 Toplu Al (1-3-5-10)`, `take_media_${catId}_${media.type}`)
          ];

    // ⭐ Yıldız Atma Butonları (1, 5, 10 - 10 atanlar kaydedebilir)
    const starsRow = [
        Markup.button.callback('⭐ 1', `tip_m_${media.id}_1`),
        Markup.button.callback('⭐ 5', `tip_m_${media.id}_5`),
        Markup.button.callback('⭐ 10 (Kaydedebilir)', `tip_m_${media.id}_10`)
    ];

    const buttons = [
        [
            Markup.button.callback(goodLabel, `rate_g_${media.id}`),
            Markup.button.callback(badLabel, `rate_b_${media.id}`)
        ],
        starsRow
    ];

    // 🔒 Yalnızca Yönetici sekme değiştirebilir / dağıtım yapabilir; normal kullanıcılar yer değiştiremez
    if (isAdmin) {
        buttons.push([
            Markup.button.callback('📂 Sekme Değiştir (Dağıt)', `mv_p_${media.id}`)
        ]);
    }

    buttons.push(repeatRow);
    buttons.push([
        Markup.button.callback('🚨 Uygunsuz / Bildir', `report_${media.id}`)
    ]);
    buttons.push([
        Markup.button.callback('⬅️ Sekmeye Dön', `cat_view_${catId}`),
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    return Markup.inlineKeyboard(buttons);
}


// Medya Gönderme Ortak Fonksiyonu (1 - 3 - 5 - 10 Toplu Gönderim Destekli)
async function sendMediaToUser(ctx, type, categoryId = null, requestedCount = 1) {
    const userId = ctx.from.id;
    const user = db.getUser(userId);
    const vip = db.isUserVip(userId);
    const isAdmin = isAdminUser(userId);
    const isVideo = type === 'video';
    const typeLabel = isVideo ? 'Video' : 'Resim';
    const credits = isVideo ? (user?.videoCredits || 0) : (user?.photoCredits || 0);
    const targetCount = Math.max(1, parseInt(requestedCount) || 1);

    const cat = categoryId ? db.getCategory(categoryId) : null;
    const catName = cat ? cat.name : 'Genel Havuz';

    // ⭐ YILDIZLI ÖZEL SEKME KONTROLÜ (Admin BEDAVA)
    if (STAR_CATEGORIES[categoryId] && !isAdmin) {
        const starCfg = STAR_CATEGORIES[categoryId];
        await ctx.answerCbQuery(`⭐ ${catName} sekmesi Video: ${starCfg.videoPrice} Yıldız, Foto: ${starCfg.photoPrice} Yıldız!`).catch(() => {});
        return ctx.reply(
            `⭐ <b>ÖZEL SEKME: [${cat?.key || ''}] ${catName} (Özel İçerik)</b>\n\n` +
            `Bu sekmedeki özel içerikler <b>Video: ⭐ ${starCfg.videoPrice} Yıldız</b> | <b>Fotoğraf: ⭐ ${starCfg.photoPrice} Yıldız</b> ödenerek izlenebilir.\n` +
            `Standart kredi veya takas kredileri bu sekmede kesinlikle geçerli değildir.\n\n` +
            `👇 İzlemek istediğiniz medya türünü seçin:`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`🎥 ⭐ ${starCfg.videoPrice} Yıldız ile 1 Video İzle`, `buy_cat_media_${categoryId}_video`)],
                    [Markup.button.callback(`📸 ⭐ ${starCfg.photoPrice} Yıldız ile 1 Fotoğraf İzle`, `buy_cat_media_${categoryId}_photo`)],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        );
    }

    // 1. Kredi Kontrolü
    if (!vip.isVip && credits <= 0) {
        await ctx.answerCbQuery(`❌ Yetersiz ${typeLabel} Kredisi!`).catch(() => {});
        return ctx.reply(
            `❌ <b>${typeLabel} Krediniz Yetersiz!</b>\n\n${cat ? `<b>${cat.name}</b> sekmesinden ` : ''}${typeLabel.toLowerCase()} alabilmek için en az 1 ${typeLabel} Kredisine veya 👑 VIP Üyeliğe sahip olmalısınız.`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback(`⭐ 1 Yıldız = 1 ${typeLabel} Al`, isVideo ? 'buy_vid_1' : 'buy_pho_1'),
                        Markup.button.callback('⭐ Paket Marketi', 'menu_packages')
                    ],
                    [Markup.button.callback(`📤 ${cat ? `${cat.name} Sekmesine` : ''} ${typeLabel} Yükle`, cat ? `cat_upload_${cat.id}` : (isVideo ? 'guide_video_upload' : 'guide_photo_upload'))],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        );
    }

    // Yetersiz Kredi (İstenen miktar mevcut bakiyeden fazla ise)
    if (!vip.isVip && credits < targetCount) {
        await ctx.answerCbQuery(`❌ Yetersiz Kredi! (${targetCount} adet istediniz, bakiyeniz: ${credits})`, { show_alert: true }).catch(() => {});
        return ctx.reply(
            `❌ <b>Yetersiz ${typeLabel} Kredisi!</b>\n\n` +
            `Talep Ettiğiniz: <b>${targetCount} Adet ${typeLabel}</b>\n` +
            `Mevcut Bakiyeniz: <b>${credits} Adet ${typeLabel}</b>\n\n` +
            `Mevcut kredinizle alabileceğiniz miktarı seçebilir veya Paket Marketinden kredi satın alabilirsiniz:`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    credits > 0 ? [Markup.button.callback(`⚡ Mevcut Kredinizle Al (${credits} Adet)`, `take_media_${cat ? cat.id : 'all'}_${type}_${credits}`)] : [],
                    [
                        Markup.button.callback(`⭐ 1 Yıldız = 1 ${typeLabel}`, isVideo ? 'buy_vid_1' : 'buy_pho_1'),
                        Markup.button.callback('⭐ Paket Marketi', 'menu_packages')
                    ],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ].filter(r => r.length > 0))
            }
        );
    }

    // 2. Kalan Görülmemiş Medya Kontrolü
    let availableUnseen = 999;
    if (categoryId) {
        const unseenStats = db.getUserCategoryUnseenCount(userId, categoryId);
        availableUnseen = isVideo ? unseenStats.unseenVideos : unseenStats.unseenPhotos;
    }

    if (availableUnseen <= 0) {
        await ctx.answerCbQuery(`Bu sekmedeki tüm ${typeLabel.toLowerCase()}ları zaten aldınız! Krediniz eksilmedi.`).catch(() => {});
        const curUser = db.getUser(userId) || {};
        const curCredits = isVideo ? (curUser.videoCredits || 0) : (curUser.photoCredits || 0);

        return ctx.reply(
            `ℹ️ <b>${cat ? `[${cat.name}] sekmesinde` : 'Havuzda'} henüz görmediğiniz yeni bir ${typeLabel.toLowerCase()} kalmadı!</b>\n\n` +
            `✅ Bu sekmedeki tüm onaylı ${typeLabel.toLowerCase()}ları zaten aldınız. Sistem aynı medyayı size <b>asla tekrar göndermez</b>.\n\n` +
            `🔒 <b>KREDİNİZ KORUNDU (DÜŞÜŞ OLMADI):</b>\n` +
            `İçerik teslim edilmediği için kredinizden <b>kesinlikle kesinti yapılmamıştır</b>.\n` +
            `💰 <b>Mevcut ${typeLabel} Krediniz:</b> <code>${curCredits}</code>\n\n` +
            `💡 Yeni ${typeLabel.toLowerCase()}lar yüklendikçe alabilir veya diğer sekmelerden içerik seçebilirsiniz!`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`📤 Bu Sekmeye Yeni ${typeLabel} Yükle`, cat ? `cat_upload_${cat.id}` : (isVideo ? 'guide_video_upload' : 'guide_photo_upload'))],
                    ...(cat ? [[Markup.button.callback('⬅️ Sekmeye Dön', `cat_view_${cat.id}`)]] : []),
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        );
    }

    const countToSend = Math.min(targetCount, availableUnseen);

    await ctx.answerCbQuery(countToSend > 1 ? `📦 ${countToSend} Adet ${typeLabel} gönderiliyor...` : `🎉 ${typeLabel} getiriliyor!`).catch(() => {});

    let infoMsg = null;
    if (countToSend > 1) {
        infoMsg = await ctx.reply(
            `📦 <b>Toplu ${typeLabel} Gönderimi Başlatıldı...</b>\n\n` +
            `🎯 <b>Gönderilecek:</b> <b>${countToSend} Adet ${typeLabel}</b>\n` +
            `📁 <b>Sekme:</b> ${cat ? `[${cat.key}] <b>${cat.name}</b>` : 'Genel Havuz'}\n` +
            `⏳ <i>Medyalarınız tek tek, etkileşim butonlarıyla birlikte iletiliyor...</i>`,
            { parse_mode: 'HTML' }
        ).catch(() => null);
    }

    let sentCount = 0;

    for (let i = 0; i < countToSend; i++) {
        const media = db.getRandomMedia(userId, type, categoryId);
        if (!media) break;

        const caption = getMediaCaption(media, userId);
        const buttons = getMediaActionKeyboard(media, userId);

        const sendOptions = {
            caption,
            parse_mode: 'HTML',
            protect_content: !isAdmin,
            ...buttons
        };

        try {
            if (isVideo) {
                await ctx.replyWithVideo(media.fileId, sendOptions);
            } else {
                await ctx.replyWithPhoto(media.fileId, sendOptions);
            }
            sentCount++;
        } catch (sendErr) {
            console.error(`${typeLabel} gönderme hatası:`, sendErr.message);
            if (!vip.isVip) db.updateCredits(userId, type, 1);
            db.removeSeenMedia(userId, media.id);
        }

        if (i < countToSend - 1) {
            await new Promise(r => setTimeout(r, 600));
        }
    }

    // Toplu gönderim özeti (1'den fazla gönderildiyse)
    if (countToSend > 1) {
        const updatedUser = db.getUser(userId) || {};
        const updatedCredits = isVideo ? (updatedUser.videoCredits || 0) : (updatedUser.photoCredits || 0);

        const summaryText = 
`🎉 <b>TOPLU ${typeLabel.toUpperCase()} GÖNDERİMİ TAMAMLANDI!</b>\n\n` +
`✅ <b>Teslim Edilen:</b> <b>${sentCount} / ${countToSend} Adet ${typeLabel}</b>\n` +
`📁 <b>Sekme:</b> ${cat ? `[${cat.key}] <b>${cat.name}</b>` : 'Genel Havuz'}\n` +
(vip.isVip 
    ? `👑 <b>VIP Ayrıcalığı:</b> Sınırsız VIP aktif (0 Kredi harcandı)\n` 
    : `💰 <b>Kalan ${typeLabel} Krediniz:</b> <code>${updatedCredits}</code>\n`) +
`\n💡 <i>Medyaları yukarıda tek tek inceleyebilir, beğenebilir veya sekmesini değiştirebilirsiniz.</i>`;

        const summaryKeyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback(`📥 Tekrar ${typeLabel} Al`, cat ? `cat_take_${cat.id}` : (isVideo ? 'take_video' : 'take_photo')),
                Markup.button.callback(`📤 ${typeLabel} Yükle`, cat ? `cat_upload_${cat.id}` : (isVideo ? 'guide_video_upload' : 'guide_photo_upload'))
            ],
            [
                Markup.button.callback('🏠 Ana Menü', 'main_menu')
            ]
        ]);

        if (infoMsg) {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                infoMsg.message_id,
                undefined,
                summaryText,
                { parse_mode: 'HTML', ...summaryKeyboard }
            ).catch(() => {
                ctx.reply(summaryText, { parse_mode: 'HTML', ...summaryKeyboard }).catch(() => {});
            });
        } else {
            await ctx.reply(summaryText, { parse_mode: 'HTML', ...summaryKeyboard }).catch(() => {});
        }
    }
}

// Resim Al İşlemi (Genel Çağrı - 1-3-5-10 Seçenekleri)
bot.action(/^take_photo(?:_(\d+))?$/, async (ctx) => {
    const rawCount = ctx.match[1];
    if (rawCount) {
        const count = parseInt(rawCount) || 1;
        await sendMediaToUser(ctx, 'photo', null, count);
    } else {
        await ctx.answerCbQuery();
        const user = db.getUser(ctx.from.id) || {};
        const vip = db.isUserVip(ctx.from.id);
        const text = 
`📸 <b>Toplu Resim Gönderimi (Genel Havuz)</b>\n\n` +
`💰 <b>Mevcut Bakiyeniz:</b> <b>${vip.isVip ? '👑 Sınırsız VIP' : `${user.photoCredits || 0} Kredi`}</b>\n\n` +
`👇 <b>Kaç adet resim almak istiyorsunuz?</b>`;

        return safeEditOrReply(ctx, text, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback('⚡ 1 Adet Resim', 'take_photo_1'),
                    Markup.button.callback('📦 3 Adet Resim', 'take_photo_3')
                ],
                [
                    Markup.button.callback('🚀 5 Adet Resim', 'take_photo_5'),
                    Markup.button.callback('👑 10 Adet Resim', 'take_photo_10')
                ],
                [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
            ])
        });
    }
});

// Video Al İşlemi (Genel Çağrı - 1-3-5-10 Seçenekleri)
bot.action(/^take_video(?:_(\d+))?$/, async (ctx) => {
    const rawCount = ctx.match[1];
    if (rawCount) {
        const count = parseInt(rawCount) || 1;
        await sendMediaToUser(ctx, 'video', null, count);
    } else {
        await ctx.answerCbQuery();
        const user = db.getUser(ctx.from.id) || {};
        const vip = db.isUserVip(ctx.from.id);
        const text = 
`🎥 <b>Toplu Video Gönderimi (Genel Havuz)</b>\n\n` +
`💰 <b>Mevcut Bakiyeniz:</b> <b>${vip.isVip ? '👑 Sınırsız VIP' : `${user.videoCredits || 0} Kredi`}</b>\n\n` +
`👇 <b>Kaç adet video almak istiyorsunuz?</b>`;

        return safeEditOrReply(ctx, text, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback('⚡ 1 Adet Video', 'take_video_1'),
                    Markup.button.callback('📦 3 Adet Video', 'take_video_3')
                ],
                [
                    Markup.button.callback('🚀 5 Adet Video', 'take_video_5'),
                    Markup.button.callback('👑 10 Adet Video', 'take_video_10')
                ],
                [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
            ])
        });
    }
});


// Profilim Butonu
bot.action('my_profile', async (ctx) => {
    await ctx.answerCbQuery();
    const user = db.getUser(ctx.from.id);
    if (!user) return ctx.reply('Kullanıcı bulunamadı. Lütfen /start yazın.');

    const vip = db.isUserVip(ctx.from.id);
    const vipText = vip.isVip 
        ? (vip.isUnlimited ? `👑 <b>VIP Durumu:</b> Aktif (👑 Yönetici / Sınırsız VIP)` : `👑 <b>VIP Durumu:</b> Aktif (${vip.remainingHours} saat kaldı)`) 
        : `👑 <b>VIP Durumu:</b> Pasif (Standart)`;

    const profileText = 
`👤 <b>Profil Bilgileriniz</b>

🆔 <b>Kullanıcı ID:</b> <code>${user.id}</code>
${vipText}
📸 <b>Resim Kredisi:</b> <code>${user.photoCredits || 0}</code> (İlerleme: ${user.photoProgress || 0}/5)
🎥 <b>Video Kredisi:</b> <code>${user.videoCredits || 0}</code> (İlerleme: ${user.videoProgress || 0}/5)
🎡 <b>Şans Çarkı Hakkı:</b> <code>${user.wheelSpins || 0}</code> çevirme

📤 <b>Yüklenen Resimler:</b> ${user.uploadedPhotos || 0} | 📥 <b>Alınan:</b> ${user.receivedPhotos || 0}
📤 <b>Yüklenen Videolar:</b> ${user.uploadedVideos || 0} | 📥 <b>Alınan:</b> ${user.receivedVideos || 0}

ℹ️ <i>Kural: Her 5 özgün fotoğrafta 1 Resim Kredisi, her 5 özgün videoda 1 Video Kredisi kazanırsınız.</i>`;

    return safeEditOrReply(ctx, profileText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🎡 Şans Çarkı (1-10 Video)', 'wheel_menu')],
            [Markup.button.callback('⭐ Paket Satın Al (Video / Foto)', 'menu_packages')],
            [Markup.button.callback('💎 Kredi Kazan / Davet Et', 'earn_credits')],
            [Markup.button.callback('⬅️ Ana Menü', 'main_menu')]
        ])
    });
});

// Kredi Kazan / Davet Et Butonu
bot.action('earn_credits', async (ctx) => {
    await ctx.answerCbQuery();
    const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${ctx.from.id}`;

    const text = 
`💎 <b>Kredi Kazanma Yolları</b>

1️⃣ <b>Medya Yükleyin:</b> Bota gönderip onaylanan her 5 resim için <b>+1 Resim Kredisi</b>, her 5 video için <b>+1 Video Kredisi</b> kazanırsınız.
2️⃣ <b>Şans Çarkı Çevirin:</b> VIP üyelik alanlara veya 100+ Yıldız harcama yapanlara özel <b>Şans Çarkı</b> ile her çevirmede <b>1 ile 10 adet Video Kredisi</b> hediye!
3️⃣ <b>Arkadaşlarınızı Davet Edin:</b> 🔥 Sizin linkinizle bota katılan her kişi için <b>+2 Resim</b> ve <b>+2 Video</b> kredisi hediye! (Toplam 4 kredi / davet)

🔗 <b>Size Özel Davet Linkiniz:</b>
<code>${refLink}</code>`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.url('📲 Davet Linkini Paylaş', `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('🔥 Telegram Resim ve Video Takas Botu! Davetimle katıl, 2 Resim + 2 Video kredisi kazan!')}`)],
            [Markup.button.callback('🎡 Şans Çarkı', 'wheel_menu')],
            [Markup.button.callback('📢 Duyuru Panosu', 'announcements')],
            [Markup.button.callback('⬅️ Ana Menü', 'main_menu')]
        ])
    });
});

// Kurallar
bot.action('rules', async (ctx) => {
    await ctx.answerCbQuery();
    const text = 
`📜 <b>Kurallar & Güvenlik Politikası</b>

1. 🚫 <b>AYNI / KOPYA İÇERİK YASAKTIR:</b> Sistemimizde daha önce yüklenmiş olan aynı resim veya videoları tekrar yüklemeye çalışıldığında sistem medyayı otomatik olarak siler ve havuza almaz.
2. ⚡ <b>OTOMATİK ONAY SİSTEMİ:</b> Gönderilen özgün resim ve videolar anında sistem tarafından otomatik taranır. <b>Her 5 resim için +1 Resim kredisi</b>, <b>her 5 video için +1 Video kredisi</b> tanımlanır. Yönetici uygunsuz içerikleri havuzdan silme yetkisine sahiptir.
3. 🎡 <b>ŞANS ÇARKI:</b> VIP üyelik alan veya 100+ Yıldız harcayan kullanıcılara Şans Çarkı hakkı tanımlanır. Çark 1-10 Video Kredisi kazandırır.
4. ⛔ <b>YANILTICI / UYGUNSUZ MEDYA:</b> Bozuk, alakasız, sahte veya yasa dışı içerik gönderenlerin hesapları anında banlanır.
5. 🔒 <b>İÇERİK KORUMASI:</b> Bot üzerindeki tüm medyalar korumalıdır; indirilmesi veya başkalarına iletilmesi Telegram tarafından engellenmiştir.`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Ana Menü', 'main_menu')]
        ])
    });
});

// Şikayet Bildir
bot.action(/report_(.+)/, async (ctx) => {
    const mediaId = ctx.match[1];
    const result = db.reportMedia(mediaId, ctx.from.id);

    if (!result.success) {
        await ctx.answerCbQuery(result.message, { show_alert: true });
        return;
    }

    if (result.isBanned) {
        await ctx.answerCbQuery('🚨 İçerik şikayetler sebebiyle havuzdan kaldırıldı. Teşekkürler!', { show_alert: true });
    } else {
        await ctx.answerCbQuery('✅ Bildiriminiz alındı. İncelenecektir.', { show_alert: true });
    }
});

// MEDYA OYLAMA: İYİ (👍) / KÖTÜ (👎)
bot.action(/rate_([gb])_(.+)/, async (ctx) => {
    const type = ctx.match[1]; // 'g' = good, 'b' = bad
    const mediaId = ctx.match[2];
    const isGood = type === 'g';

    const res = db.rateMedia(mediaId, ctx.from.id, isGood ? 'good' : 'bad');
    if (!res.success) {
        return ctx.answerCbQuery(res.message || 'Medya bulunamadı.');
    }

    if (isGood) {
        await ctx.answerCbQuery(`👍 Beğendiniz! (Toplam ${res.likesCount} Beğeni)`);
    } else {
        await ctx.answerCbQuery(`👎 Beğenmediniz. (Toplam ${res.dislikesCount} Olumsuz Oy)`);
    }

    const media = db.getMedia(mediaId);
    if (media) {
        try {
            const kb = getMediaActionKeyboard(media, ctx.from.id, isGood ? 'good' : 'bad');
            await ctx.editMessageReplyMarkup(kb.reply_markup);
        } catch (e) {
            // mesaj değiştirilemedi veya zaten aynı
        }
    }
});

// SEKME DEĞİŞTİR / DAĞIT (SADECE ADMİN)
bot.action(/mv_p_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Medyaları sadece yöneticiler taşıyabilir ve düzenleyebilir.', { show_alert: true });
    }
    await ctx.answerCbQuery().catch(() => {});
    const mediaId = ctx.match[1];
    const media = db.getMedia(mediaId);
    if (!media) {
        return ctx.answerCbQuery('Medya bulunamadı.', { show_alert: true });
    }

    const currentCat = db.getCategory(media.categoryId);
    const categories = db.getCategories();

    // Mevcut olanı hariç tüm kategorileri listele (2 sütun)
    const otherCats = categories.filter(c => c.id !== media.categoryId);
    const rows = [];
    for (let i = 0; i < otherCats.length; i += 2) {
        const row = [
            Markup.button.callback(`[${otherCats[i].key}] ${otherCats[i].name}`, `mv_to_${media.id}_${otherCats[i].id}`)
        ];
        if (otherCats[i + 1]) {
            row.push(Markup.button.callback(`[${otherCats[i + 1].key}] ${otherCats[i + 1].name}`, `mv_to_${media.id}_${otherCats[i + 1].id}`));
        }
        rows.push(row);
    }
    rows.push([
        Markup.button.callback('❌ Vazgeç / İptal', `mv_c_${media.id}`)
    ]);

    const promptText = 
`📂 <b>Sekme / Kategori Taşıma & Dağıtım</b>\n\n` +
`📌 <b>Şu Anki Sekme:</b> [${currentCat ? currentCat.key : '?'}] <b>${currentCat ? currentCat.name : 'Bilinmiyor'}</b>\n\n` +
`❓ <b>Bu ${media.type === 'video' ? 'videoyu' : 'fotoğrafı'} hangi sekmeye aktarmak istersiniz?</b>\n` +
`👇 Taşımak istediğiniz hedef sekmeyi seçin (Tıkladığınız anda otomatik aktarılır):`;

    try {
        await ctx.editMessageCaption(promptText, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(rows)
        });
    } catch (err) {
        await ctx.reply(promptText, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(rows)
        });
    }
});

// SEKME TAŞIMADAN VAZGEÇ (ORİJİNAL EKRANA DÖN)
bot.action(/mv_c_(.+)/, async (ctx) => {
    await ctx.answerCbQuery('Taşıma işlemi iptal edildi.');
    const mediaId = ctx.match[1];
    const media = db.getMedia(mediaId);
    if (!media) return;

    const caption = getMediaCaption(media, ctx.from.id);
    const keyboard = getMediaActionKeyboard(media, ctx.from.id);

    try {
        await ctx.editMessageCaption(caption, {
            parse_mode: 'HTML',
            ...keyboard
        });
    } catch (e) {}
});

// HEDEF SEKME SEÇİLDİ: MEDYAYI DİREKT AKTAR (SADECE ADMİN)
bot.action(/mv_to_(.+)_(cat_\d+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Medyaları sadece yöneticiler taşıyabilir ve düzenleyebilir.', { show_alert: true });
    }
    const mediaId = ctx.match[1];
    const targetCatId = ctx.match[2];

    const res = db.changeMediaCategory(mediaId, targetCatId);
    if (!res.success) {
        return ctx.answerCbQuery(res.message || 'Hata oluştu.', { show_alert: true });
    }

    await ctx.answerCbQuery(`🎉 Medya [${res.newCategory.name}] sekmesine başarıyla aktarıldı!`, { show_alert: true });

    const successCaption = 
`✅ <b>MEDYA DOĞRU SEKMEYE AKTARILDI!</b>\n\n` +
`🔄 <b>Eski Sekme:</b> [${res.oldCategory ? res.oldCategory.key : '?'}] ${res.oldCategory ? res.oldCategory.name : 'Bilinmiyor'}\n` +
`📂 <b>Yeni Sekme:</b> [${res.newCategory.key}] <b>${res.newCategory.name}</b>\n\n` +
`✨ <i>Bu ${res.media.type === 'video' ? 'video' : 'fotoğraf'} artık sistemde <b>[${res.newCategory.name}]</b> sekmesine taşınmıştır. İlgili sekmeyi açan kullanıcılara bu sekme altında sunulacaktır. Katkınız için teşekkürler!</i>`;

    const successKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`📥 [${res.newCategory.name}] Sekmesini Aç`, `cat_view_${res.newCategory.id}`)],
        [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
    ]);

    try {
        await ctx.editMessageCaption(successCaption, {
            parse_mode: 'HTML',
            ...successKeyboard
        });
    } catch (err) {
        await ctx.reply(successCaption, {
            parse_mode: 'HTML',
            ...successKeyboard
        });
    }
});

// YARDIMCI BİÇİMLENDİRME FONKSİYONLARI
function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return 'Bilinmiyor';
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) return `${m} dk ${s} sn`;
    return `${s} sn`;
}

// ADMİN BİLDİRİM KUYRUĞU (Telegram 429 Too Many Requests Hatasını Önlemek İçin)
const adminNotificationQueue = [];
let isProcessingAdminQueue = false;

function queueAdminNotification(taskFn) {
    adminNotificationQueue.push(taskFn);
    processAdminQueue();
}

async function processAdminQueue() {
    if (isProcessingAdminQueue) return;
    isProcessingAdminQueue = true;

    while (adminNotificationQueue.length > 0) {
        const task = adminNotificationQueue.shift();
        try {
            await task();
        } catch (err) {
            console.error('Admin bildirim iletme hatası:', err.message);
        }
        // Telegram rate limit (429) koruması için mesajlar arasına 800ms bekleme
        await new Promise(r => setTimeout(r, 800));
    }

    isProcessingAdminQueue = false;
}

// İLERLEME ÇUBUĞU ÇİZİCİ (2 ADET ALTLI ÜSTLÜ ÇUBUK İÇİN)
function renderProgressBar(percent, length = 10, fillChar = '🟩', emptyChar = '⬜') {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    const filled = Math.round((p / 100) * length);
    const empty = length - filled;
    return `${fillChar.repeat(filled)}${emptyChar.repeat(empty)} <b>%${p}</b>`;
}

// ==========================================
// 📥 MEDYA TOPLAMA & ADMİN KATEGORİLENDİRME SİSTEMİ
// Kullanıcı yükler → Admin kategori seçer → Kullanıcıya bildirim
// ==========================================
const userUploadBatches = new Map();
const MAX_BATCH_LIMIT = 30;

// Admin tarafından kategorilendirme bekleyen medyalar: pendingId → { userId, fileId, fileUniqueId, mediaType, fromUser }
// Disk üzerinde kalıcı saklama (bot yeniden başlasa bile bekleyen onaylar kaybolmaz)
const PENDING_CAT_FILE = path.join(__dirname, 'pending_categorize.json');

function loadPendingCategorize() {
    try {
        if (fs.existsSync(PENDING_CAT_FILE)) {
            const raw = fs.readFileSync(PENDING_CAT_FILE, 'utf8');
            const data = JSON.parse(raw);
            return new Map(Object.entries(data));
        }
    } catch (e) {
        console.error('Error loading pending categorize:', e.message);
    }
    return new Map();
}

function savePendingCategorize(map) {
    try {
        const obj = Object.fromEntries(map.entries());
        fs.writeFileSync(PENDING_CAT_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving pending categorize:', e.message);
    }
}

const pendingAdminCategorize = loadPendingCategorize();

function enqueueMediaUpload(ctx, mediaType, mediaData) {
    if (!ctx || !ctx.from || !mediaData) return;
    const userId = String(ctx.from.id);

    if (db.isUserBanned(userId)) {
        return ctx.reply('🚫 <b>Hesabınız banlanmıştır!</b> Medya yükleyemezsiniz.', { parse_mode: 'HTML' }).catch(() => {});
    }

    const fileId = mediaData.file_id;
    const fileUniqueId = mediaData.file_unique_id;

    // Kopya kontrolü
    const existing = db.findDuplicateMedia(fileUniqueId, fileId);
    if (existing) {
        return ctx.reply(
            `⚠️ <b>Bu Medya Zaten Sistemde Var!</b>\n\nMükerrer (kopya) içerik yüklenemez. Lütfen farklı bir içerik gönderin.`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }

    // Doğrudan "Genel" (cat_11) sekmesine anında ekle + krediyi hemen ver
    db.getOrCreateUser({ id: userId, ...ctx.from });
    const { media, creditAwarded, currentProgress } = db.addApprovedMedia(
        userId, fileId, fileUniqueId, mediaType, 'cat_11'
    );

    let batch = userUploadBatches.get(userId);
    if (!batch) {
        batch = { items: [], debounceTimer: null, totalCreditsAwarded: 0 };
        userUploadBatches.set(userId, batch);
    }

    batch.items.push({ media, mediaType, fileId, fileUniqueId, creditAwarded, currentProgress });
    if (creditAwarded) batch.totalCreditsAwarded++;

    // 1.5 saniye debounce — toplu yüklemelerde tek özet mesaj gönder
    if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
    batch.debounceTimer = setTimeout(() => {
        sendUploadSummaryAndNotifyAdmin(ctx, userId);
    }, 1500);
}

// Kullanıcıya özet bildir + admin'e her medya için dağıtım butonları gönder
async function sendUploadSummaryAndNotifyAdmin(ctx, userId) {
    const batch = userUploadBatches.get(userId);
    if (!batch || batch.items.length === 0) return;

    const items = [...batch.items];
    const totalCredits = batch.totalCreditsAwarded;
    userUploadBatches.delete(userId);

    const count = items.length;
    const lastItem = items[items.length - 1];
    const typeLabel = lastItem.mediaType === 'video' ? 'Video' : 'Resim';

    // Kullanıcıya kredi + özet mesajı
    let creditMsg = totalCredits > 0
        ? `🎉 <b>+${totalCredits} ${typeLabel} Kredisi hesabınıza yüklendi!</b>\n`
        : '';
    creditMsg += `📊 <b>İlerleme: ${lastItem.currentProgress}/5</b> (Her 5 yüklemede +1 Kredi)`;

    ctx.reply(
        `✅ <b>${count} Medya Genel Havuza Eklendi!</b>\n\n${creditMsg}\n\n` +
        `<i>Medyalarınız Genel sekmesine aktarıldı. Yönetici uygun sekmeye dağıtacak.</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📥 Genel Sekmeyi Gör', 'cat_view_cat_11')],
                [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
            ])
        }
    ).catch(() => {});

    // Admin'e her medya için ayrı dağıtım butonu mesajı gönder
    const distCats = db.getCategories().filter(c => c.id !== 'cat_11');
    for (const item of items) {
        const isVideo = item.mediaType === 'video';
        const catRows = [];
        for (let i = 0; i < distCats.length; i += 2) {
            const row = [Markup.button.callback(
                `[${distCats[i].key}] ${distCats[i].name}`,
                `dist_${item.media.id}__${distCats[i].id}`
            )];
            if (distCats[i + 1]) {
                row.push(Markup.button.callback(
                    `[${distCats[i + 1].key}] ${distCats[i + 1].name}`,
                    `dist_${item.media.id}__${distCats[i + 1].id}`
                ));
            }
            catRows.push(row);
        }
        catRows.push([Markup.button.callback('🗑️ Havuzdan Sil', `dist_${item.media.id}__del`)]);

        const adminCaption =
`📥 <b>YENİ MEDYA — DAĞITIM SEÇ</b>\n\n` +
`👤 <b>Yükleyen:</b> ${escapeHtml(ctx.from.first_name || '')} (@${ctx.from.username || 'yok'})\n` +
`🆔 ID: <code>${userId}</code>\n` +
`📎 <b>Tür:</b> ${isVideo ? '🎥 Video' : '📸 Fotoğraf'}\n` +
`📁 <b>Şu an:</b> [K] Genel\n\n` +
`👇 <b>Bu medyayı hangi sekmeye aktarmak istersiniz?</b>`;

        for (const adminChatId of ADMIN_IDS) {
            try {
                if (isVideo) {
                    await bot.telegram.sendVideo(adminChatId, item.fileId, {
                        caption: adminCaption, parse_mode: 'HTML',
                        ...Markup.inlineKeyboard(catRows)
                    });
                } else {
                    await bot.telegram.sendPhoto(adminChatId, item.fileId, {
                        caption: adminCaption, parse_mode: 'HTML',
                        ...Markup.inlineKeyboard(catRows)
                    });
                }
            } catch (err) {
                console.error(`Admin (${adminChatId}) bildirim hatası:`, err.message);
            }
        }
        await new Promise(r => setTimeout(r, 400));
    }
}

// ==========================================
// 🚀 ADMİN DAĞITIM CALLBACK — dist_<mediaId>__<catId|del>
// ==========================================
bot.action(/^dist_(.+)__(cat_\d+|del)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdminUser(ctx.from?.id)) {
            return ctx.answerCbQuery('Sadece yöneticiler dağıtım yapabilir.', { show_alert: true }).catch(() => {});
        }

        const mediaId = ctx.match[1];
        const action = ctx.match[2];

        if (action === 'del') {
            db.deleteMedia(mediaId);
            await ctx.answerCbQuery('🗑️ Medya havuzdan silindi!', { show_alert: true }).catch(() => {});
            return ctx.editMessageCaption('🗑️ <b>Medya havuzdan tamamen silindi.</b>', { parse_mode: 'HTML' }).catch(() => {});
        }

        const res = db.changeMediaCategory(mediaId, action);
        if (!res.success) {
            return ctx.answerCbQuery(res.message || 'Hata oluştu.', { show_alert: true }).catch(() => {});
        }

        await ctx.answerCbQuery(`✅ [${res.newCategory.name}] sekmesine taşındı!`).catch(() => {});
        return ctx.editMessageCaption(
            `✅ <b>Dağıtıldı → [${res.newCategory.key}] ${res.newCategory.name}</b>\n\n` +
            `<i>Genel'den <b>${res.newCategory.name}</b> sekmesine aktarıldı.</i>`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } catch (err) {
        console.error('Dağıtım action hatası:', err.message);
    }
});


bot.action(/^acp_(p\d+)_(cat_\d+|reject)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});

        if (!isAdminUser(ctx.from?.id)) {
            return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.', { show_alert: true }).catch(() => {});
        }

        const pendingId = ctx.match[1];
        const action = ctx.match[2];

        let pending = pendingAdminCategorize.get(pendingId);

        // SMART FALLBACK: Hafızada veya dosyada bulunamazsa Telegram mesajından çıkar
        if (!pending) {
            const msg = ctx.callbackQuery?.message;
            if (msg) {
                let fileId = null;
                let fileUniqueId = null;
                let mediaType = 'photo';
                if (msg.video) {
                    fileId = msg.video.file_id;
                    fileUniqueId = msg.video.file_unique_id;
                    mediaType = 'video';
                } else if (msg.photo && msg.photo.length > 0) {
                    const bestPhoto = msg.photo[msg.photo.length - 1];
                    fileId = bestPhoto.file_id;
                    fileUniqueId = bestPhoto.file_unique_id;
                    mediaType = 'photo';
                }

                const idMatch = (msg.caption || '').match(/ID:\s*<code>(\d+)<\/code>/i);
                const extractedUserId = idMatch ? idMatch[1] : (msg.chat ? String(msg.chat.id) : null);

                if (fileId && extractedUserId) {
                    pending = {
                        userId: extractedUserId,
                        fileId,
                        fileUniqueId,
                        mediaType,
                        fromUser: { id: extractedUserId }
                    };
                }
            }
        }

        if (!pending) {
            await ctx.answerCbQuery('❌ Bu medya zaten işlendi veya bulunamadı.', { show_alert: true }).catch(() => {});
            return ctx.editMessageCaption('⚠️ <b>Bu medya zaten işlendi.</b>', { parse_mode: 'HTML' }).catch(() => {});
        }

        pendingAdminCategorize.delete(pendingId);
        savePendingCategorize(pendingAdminCategorize);

        // REDDET
        if (action === 'reject') {
            await ctx.answerCbQuery('🗑️ Medya reddedildi.').catch(() => {});
            await ctx.editMessageCaption('❌ <b>Reddedildi</b>', { parse_mode: 'HTML' }).catch(() => {});
            bot.telegram.sendMessage(
                pending.userId,
                `❌ <b>Medyanız reddedildi.</b>\n\nGönderdiğiniz medya yönetici tarafından uygunsuz bulunarak reddedildi.`,
                { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Ana Menü', 'main_menu')]]) }
            ).catch(() => {});
            return;
        }

        // ONAYLA — kategoriye ekle
        const cat = db.getCategory(action);
        if (!cat) return ctx.answerCbQuery('Kategori bulunamadı.', { show_alert: true }).catch(() => {});

        db.getOrCreateUser({ id: pending.userId, ...pending.fromUser });
        const { creditAwarded, currentProgress } = db.addApprovedMedia(
            pending.userId, pending.fileId, pending.fileUniqueId, pending.mediaType, cat.id
        );

        const typeLabel = pending.mediaType === 'video' ? 'Video' : 'Resim';

        await ctx.answerCbQuery(`✅ [${cat.key}] ${cat.name} sekmesine eklendi!`).catch(() => {});
        await ctx.editMessageCaption(
            `✅ <b>Onaylandı → [${cat.key}] ${cat.name}</b>\n` +
            `👤 ${escapeHtml(pending.fromUser?.first_name || '')} (@${pending.fromUser?.username || 'yok'})`,
            { parse_mode: 'HTML' }
        ).catch(() => {});

        // Kullanıcıya bildirim
        const creditMsg = creditAwarded
            ? `🎉 <b>+1 ${typeLabel} Kredisi</b> hesabınıza eklendi!`
            : `📊 <b>İlerleme: ${currentProgress}/5</b> (5 adette +1 ${typeLabel} Kredisi)`;

        bot.telegram.sendMessage(
            pending.userId,
            `✅ <b>Medyanız Onaylandı!</b>\n\n` +
            `📁 <b>Sekme:</b> [${cat.key}] <b>${cat.name}</b>\n` +
            `${creditMsg}`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📥 Medya Al', `cat_view_${cat.id}`)],
                    [Markup.button.callback('📤 Daha Fazla Yükle', `cat_upload_${cat.id}`)],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        ).catch(() => {});
    } catch (err) {
        console.error('Kategori onay callback hatası:', err.message);
        ctx.answerCbQuery('Hata: ' + err.message, { show_alert: true }).catch(() => {});
    }
});


// ==========================================
// 🗑️ startProcessingBatch KALDIRILDI
// Yeni akış: sendBatchToAdminForCategorization
// ==========================================
async function startProcessingBatch(userId) {
    // Devre dışı — yeni akış: sendBatchToAdminForCategorization
    return;
}


// 1. FOTOĞRAF GÖNDERİLDİĞİNDE
bot.on('photo', async (ctx) => {
    try {
        const photos = ctx.message.photo;
        const bestPhoto = photos[photos.length - 1];
        enqueueMediaUpload(ctx, 'photo', bestPhoto);
    } catch (err) {
        console.error('Photo handler hatası:', err.message);
    }
});

// 2. VİDEO GÖNDERİLDİĞİNDE
bot.on('video', async (ctx) => {
    try {
        enqueueMediaUpload(ctx, 'video', ctx.message.video);
    } catch (err) {
        console.error('Video handler hatası:', err.message);
    }
});

// 3. ANİMASYON / GIF GÖNDERİLDİĞİNDE (VİDEO OLARAK AYRIŞTIRILIR)
bot.on('animation', async (ctx) => {
    try {
        enqueueMediaUpload(ctx, 'video', ctx.message.animation);
    } catch (err) {
        console.error('Animation handler hatası:', err.message);
    }
});

// 4. VİDEO NOT / YUVARLAK VİDEO GÖNDERİLDİĞİNDE
bot.on('video_note', async (ctx) => {
    try {
        enqueueMediaUpload(ctx, 'video', ctx.message.video_note);
    } catch (err) {
        console.error('Video note handler hatası:', err.message);
    }
});

// 5. BELGE / DOSYA OLARAK GÖNDERİLDİĞİNDE (AKILLI AYRIŞTIRMA ÖZELLİĞİ)
bot.on('document', async (ctx) => {
    try {
        const doc = ctx.message.document;
        const mime = (doc.mime_type || '').toLowerCase();
        const fileName = (doc.file_name || '').toLowerCase();

        const isVideoDoc = mime.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v|3gp|ts)$/i.test(fileName);
        const isImageDoc = mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|bmp)$/i.test(fileName);

        if (isVideoDoc) {
            enqueueMediaUpload(ctx, 'video', doc);
        } else if (isImageDoc) {
            enqueueMediaUpload(ctx, 'photo', doc);
        } else {
            return ctx.reply(
                `⚠️ <b>Desteklenmeyen Dosya Türü!</b>\n\n` +
                `Gönderdiğiniz dosya (<code>${doc.file_name || 'Bilinmeyen'}</code>) resim veya video olarak algılanamadı.\n\n` +
                `Lütfen yalnızca <b>Resim (JPG, PNG, WEBP)</b> veya <b>Video (MP4, MOV, MKV vb.)</b> gönderiniz.`,
                { parse_mode: 'HTML' }
            );
        }
    } catch (err) {
        console.error('Document handler hatası:', err.message);
    }
});

// ADMİN: ONAYLA
bot.action(/admin_app_(.+)/, async (ctx) => {
    const mediaId = ctx.match[1];
    const res = db.approveMedia(mediaId);

    if (!res.success) {
        await ctx.answerCbQuery(res.message, { show_alert: true });
        return;
    }

    await ctx.answerCbQuery('✅ Medya onaylandı ve havuza eklendi!');
    const statusText = `\n\n<b>✅ DURUM: ONAYLANDI (Havuza eklendi & Kredi verildi)</b>`;

    if (ctx.callbackQuery.message.caption) {
        await ctx.editMessageCaption(
            `${ctx.callbackQuery.message.caption}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } else if (ctx.callbackQuery.message.text) {
        await ctx.editMessageText(
            `${ctx.callbackQuery.message.text}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }

    const typeLabel = res.media.type === 'photo' ? 'Resim' : 'Video';
    const newCredit = res.media.type === 'photo' ? res.user.photoCredits : res.user.videoCredits;

    // Eğer yükleyen kişi ile butona basan aynı kişi değilse kullanıcıya bildirim gönder
    if (String(res.media.uploadedBy) !== String(ctx.from.id)) {
        bot.telegram.sendMessage(
            res.media.uploadedBy,
            `🎉 <b>Tebrikler!</b> Gönderdiğiniz ${typeLabel.toLowerCase()} yönetici tarafından <b>onaylandı</b> ve takas havuzuna eklendi!\n\n💰 Hesabınıza <b>+1 ${typeLabel} Kredisi</b> yüklendi. (Mevcut: <code>${newCredit}</code>)`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`📥 Hemen ${typeLabel} Al`, res.media.type === 'photo' ? 'take_photo' : 'take_video')],
                    [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                ])
            }
        ).catch(() => {});
    }
});

// ADMİN: REDDET
bot.action(/admin_rej_(.+)/, async (ctx) => {
    const mediaId = ctx.match[1];
    const res = db.rejectMedia(mediaId);

    if (!res.success) {
        await ctx.answerCbQuery(res.message, { show_alert: true });
        return;
    }

    await ctx.answerCbQuery('❌ Medya reddedildi!');
    const statusText = `\n\n<b>❌ DURUM: REDDEDİLDİ (Havuza eklenmedi)</b>`;

    if (ctx.callbackQuery.message.caption) {
        await ctx.editMessageCaption(
            `${ctx.callbackQuery.message.caption}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } else if (ctx.callbackQuery.message.text) {
        await ctx.editMessageText(
            `${ctx.callbackQuery.message.text}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }

    if (String(res.media.uploadedBy) !== String(ctx.from.id)) {
        bot.telegram.sendMessage(
            res.media.uploadedBy,
            `⚠️ Gönderdiğiniz medya kurallara veya kalite standartlarına uygun bulunmadığı için <b>onaylanmadı</b>.`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }
});

// ADMİN: HAVUZDAN MEDYA SİL (OTOMATİK ONAYLANAN İÇERİĞİ KALDIRMA)
bot.action(/admin_del_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    const mediaId = ctx.match[1];
    const res = db.deleteMedia(mediaId);
    if (!res.success) {
        return ctx.answerCbQuery('Medya zaten silinmiş veya bulunamadı.', { show_alert: true });
    }

    await ctx.answerCbQuery('🗑️ Medya havuzdan tamamen silindi!', { show_alert: true });

    const statusText = `\n\n<b>🗑️ DURUM: YÖNETİCİ TARAFINDAN HAVUZDAN SİLİNDİ!</b>`;
    if (ctx.callbackQuery.message.caption) {
        await ctx.editMessageCaption(
            `${ctx.callbackQuery.message.caption}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } else if (ctx.callbackQuery.message.text) {
        await ctx.editMessageText(
            `${ctx.callbackQuery.message.text}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }
});

// ADMİN: KULLANICIYI BANLA (İnceleme Butonundan)
bot.action(/admin_ban_(\d+)_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }

    const targetUserId = ctx.match[1];
    const mediaId = ctx.match[2];

    if (mediaId && mediaId !== 'manual') {
        db.deleteMedia(mediaId);
    }
    db.banUser(targetUserId, 'Yönetici tarafından inceleme esnasında banlandı (Hatalı/Kopya/Uygunsuz içerik)');

    await ctx.answerCbQuery(`🚫 Kullanıcı (${targetUserId}) banlandı ve medya reddedildi!`, { show_alert: true });

    const statusText = `\n\n<b>🚫 DURUM: KULLANICI BANLANDI VE İÇERİK REDDEDİLDİ!</b>`;

    if (ctx.callbackQuery.message.caption) {
        await ctx.editMessageCaption(
            `${ctx.callbackQuery.message.caption}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } else if (ctx.callbackQuery.message.text) {
        await ctx.editMessageText(
            `${ctx.callbackQuery.message.text}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }

    // Banlanan kullanıcıya bildirim gönder
    bot.telegram.sendMessage(
        targetUserId,
        `🚫 <b>HESABINIZ YÖNETİCİ TARAFINDAN BANLANDI!</b>\n\nGönderdiğiniz medya ve sistem kurallarını ihlal etmeniz (kopya/hatalı/uygunsuz içerik) sebebiyle bot erişiminiz süresiz olarak engellenmiştir.`,
        { parse_mode: 'HTML' }
    ).catch(() => {});
});

// ADMİN: TOPLU ONAYLA (Buton Aksiyonu)
bot.action('admin_bulk_approve', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }

    const res = db.approveAllPending();
    if (res.count === 0) {
        return ctx.answerCbQuery('Bekleyen onaylanacak medya kalmadı.', { show_alert: true });
    }

    await ctx.answerCbQuery(`✅ ${res.count} adet medya toplu olarak onaylandı!`, { show_alert: true });
    const stats = db.getStats();

    const statusText = `\n\n<b>⚡ TOPLU ONAYLANDI (${res.count} Medya: ${res.photos} Resim, ${res.videos} Video)</b>\n📊 Güncel Sistem Havuzu: 📸 <b>${stats.approvedPhotos} Resim</b> | 🎥 <b>${stats.approvedVideos} Video</b>`;

    if (ctx.callbackQuery.message.caption) {
        await ctx.editMessageCaption(
            `${ctx.callbackQuery.message.caption}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } else if (ctx.callbackQuery.message.text) {
        await ctx.editMessageText(
            `${ctx.callbackQuery.message.text}${statusText}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }

    // Kullanıcılara bildirim gönder
    for (const uid in res.affectedUsers) {
        if (!isAdminUser(uid)) {
            const userCredits = res.affectedUsers[uid];
            let credText = '';
            if (userCredits.photos > 0) credText += `+${userCredits.photos} Resim `;
            if (userCredits.videos > 0) credText += `+${userCredits.videos} Video `;

            bot.telegram.sendMessage(
                uid,
                `🎉 <b>Tebrikler!</b> Gönderdiğiniz ${userCredits.photos + userCredits.videos} adet medya yönetici tarafından <b>toplu olarak onaylandı</b>!\n\n💰 Hesabınıza <b>${credText}kredisi</b> eklendi!`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📥 Hemen Medya Al', 'menu_take_media')],
                        [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                    ])
                }
            ).catch(() => {});
        }
    }
});

// ADMİN: TOPLU ONAYLA (Komut: /topluonayla)
bot.command('topluonayla', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const res = db.approveAllPending();

    if (res.count === 0) {
        return ctx.reply('ℹ️ Şu anda incelenmeyi bekleyen onaylanmamış medya bulunmuyor.');
    }

    const stats = db.getStats();
    let replyMsg = 
`✅ <b>Toplu Onay Başarılı!</b>

📊 <b>Onaylanan Medya Sayısı:</b> <b>${res.count} adet</b>
📸 <b>Havuza Eklenen Resim:</b> +${res.photos}
🎥 <b>Havuza Eklenen Video:</b> +${res.videos}

🚀 <b>Güncel Sistem Havuzu:</b>
📸 Toplam Resim: <b>${stats.approvedPhotos}</b>
🎥 Toplam Video: <b>${stats.approvedVideos}</b>`;

    await ctx.reply(replyMsg, { parse_mode: 'HTML' });

    // Kullanıcılara bildirim gönder
    for (const uid in res.affectedUsers) {
        if (!isAdminUser(uid)) {
            const userCredits = res.affectedUsers[uid];
            let credText = '';
            if (userCredits.photos > 0) credText += `+${userCredits.photos} Resim `;
            if (userCredits.videos > 0) credText += `+${userCredits.videos} Video `;

            bot.telegram.sendMessage(
                uid,
                `🎉 <b>Tebrikler!</b> Gönderdiğiniz ${userCredits.photos + userCredits.videos} adet medya yönetici tarafından <b>toplu olarak onaylandı</b>!\n\n💰 Hesabınıza <b>${credText}kredisi</b> eklendi!`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📥 Hemen Medya Al', 'menu_take_media')],
                        [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
                    ])
                }
            ).catch(() => {});
        }
    }
});

// ADMİN: KULLANICI BANLAMA KOMUTU: /ban <id> [sebep]
bot.command('ban', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
        return ctx.reply('Kullanım: /ban <kullanici_id> [ban_sebebi]');
    }

    const targetId = parts[1];
    const reason = parts.slice(2).join(' ') || 'Yönetici tarafından banlandı (Kural ihlali / Kopya medya)';

    const res = db.banUser(targetId, reason);
    if (!res) {
        return ctx.reply(`❌ Kullanıcı (${targetId}) veritabanında bulunamadı.`);
    }

    ctx.reply(`🚫 <b>Kullanıcı başarıyla banlandı!</b>\n🆔 ID: <code>${targetId}</code>\n⚠️ Sebep: ${reason}`, { parse_mode: 'HTML' });

    bot.telegram.sendMessage(
        targetId,
        `🚫 <b>HESABINIZ ASKIYA ALINDI (BANLANDINIZ)</b>\n\n⚠️ <b>Sebep:</b> ${reason}\n\nKurallara uymadığınız için bot erişiminiz kalıcı olarak kapatılmıştır.`,
        { parse_mode: 'HTML' }
    ).catch(() => {});
});

// ADMİN: BAN KALDIRMA KOMUTU: /unban <id>
bot.command('unban', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
        return ctx.reply('Kullanım: /unban <kullanici_id>');
    }

    const targetId = parts[1];
    const res = db.unbanUser(targetId);
    if (!res) {
        return ctx.reply(`❌ Kullanıcı (${targetId}) bulunamadı.`);
    }

    ctx.reply(`✅ <b>Kullanıcının banı kaldırıldı!</b>\n🆔 ID: <code>${targetId}</code>`, { parse_mode: 'HTML' });

    bot.telegram.sendMessage(
        targetId,
        `✅ <b>Müjde!</b> Hesabınızın banı yönetici tarafından kaldırıldı. Tekrar kurallara uygun şekilde botu kullanabilirsiniz.`,
        { parse_mode: 'HTML' }
    ).catch(() => {});
});

// ADMİN: BANLI KULLANICILAR PANELİNİ OLUŞTURMA
async function renderBansPanel(ctx) {
    if (!isAdminUser(ctx.from?.id)) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
        return;
    }

    const bannedUsers = db.getBannedUsers();

    if (bannedUsers.length === 0) {
        const emptyText = 
`🚫 <b>Banlı Kullanıcılar Yönetim Paneli</b>\n\n` +
`✅ <b>Harika! Sistemde şu anda hiç banlanmış kullanıcı bulunmuyor.</b>\n\n` +
`ℹ️ <i>Bir kullanıcıyı banlamak isterseniz onay ekranındaki butonu veya <code>/ban &lt;id&gt; [sebep]</code> komutunu kullanabilirsiniz.</i>`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Listeyi Yenile', 'admin_manage_bans')],
            [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
        ]);

        return safeEditOrReply(ctx, emptyText, {
            parse_mode: 'HTML',
            ...keyboard
        });
    }

    let text = `🚫 <b>Banlı Kullanıcılar Yönetim Paneli (${bannedUsers.length} Kişi)</b>\n\n`;
    text += `Aşağıda sistemde engellenmiş kullanıcılar listelenmiştir. Banını kaldırmak istediğiniz kişinin butonuna tıklayabilirsiniz:\n\n`;

    const buttons = [];

    bannedUsers.forEach((u, idx) => {
        const name = u.firstName || 'İsimsiz';
        const uname = u.username ? `@${u.username}` : 'Kullanıcı adı yok';
        const dateStr = u.bannedAt ? new Date(u.bannedAt).toLocaleString('tr-TR') : 'Bilinmiyor';
        text += `<b>${idx + 1}.</b> 👤 <b>${name}</b> (${uname})\n`;
        text += `   🆔 ID: <code>${u.id}</code>\n`;
        text += `   ⚠️ <b>Sebep:</b> <i>${u.bannedReason || 'Kural ihlali / Uygunsuz içerik'}</i>\n`;
        text += `   📅 <b>Tarih:</b> ${dateStr}\n\n`;

        // Kişiye özel ban kaldırma butonu
        buttons.push([
            Markup.button.callback(`🔓 ${name} (${u.id}) Banını Kaldır`, `admin_unban_${u.id}`)
        ]);
    });

    buttons.push([
        Markup.button.callback('🧹 Tüm Banları Kaldır (Toplu)', 'admin_unban_all')
    ]);
    buttons.push([
        Markup.button.callback('🔄 Listeyi Yenile', 'admin_manage_bans'),
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
}

// ADMİN: BANLI KULLANICILAR MENÜ EYLEMİ
bot.action('admin_manage_bans', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return renderBansPanel(ctx);
});

// ADMİN: TEK BİR KULLANICININ BANINI BUTONLA KALDIRMA
bot.action(/admin_unban_(\d+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }

    const targetId = ctx.match[1];
    const res = db.unbanUser(targetId);

    if (!res) {
        await ctx.answerCbQuery(`❌ Kullanıcı (${targetId}) bulunamadı.`, { show_alert: true });
        return renderBansPanel(ctx);
    }

    await ctx.answerCbQuery(`✅ ${res.firstName || targetId} kullanıcısının banı kaldırıldı!`, { show_alert: true });

    // Kullanıcıya bildirim gönder
    bot.telegram.sendMessage(
        targetId,
        `✅ <b>Müjde!</b> Hesabınızın banı yönetici tarafından kaldırıldı. Tekrar kurallara uygun şekilde botu kullanabilirsiniz.`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Ana Menüye Git', 'main_menu')]
            ])
        }
    ).catch(() => {});

    return renderBansPanel(ctx);
});

// ADMİN: TÜM BANLARI TOPLU KALDIRMA (BUTON)
bot.action('admin_unban_all', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }

    const bannedUsers = db.getBannedUsers();
    const count = db.unbanAllUsers();

    await ctx.answerCbQuery(`✅ ${count} kullanıcının banı başarıyla kaldırıldı!`, { show_alert: true });

    // Banı kaldırılan herkese bildirim gönder
    for (const u of bannedUsers) {
        bot.telegram.sendMessage(
            u.id,
            `✅ <b>Müjde!</b> Hesabınızın banı yönetici tarafından kaldırıldı. Tekrar kurallara uygun şekilde botu kullanabilirsiniz.`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏠 Ana Menüye Git', 'main_menu')]
                ])
            }
        ).catch(() => {});
    }

    return renderBansPanel(ctx);
});

// ADMİN: BAN LİSTESİ / YÖNETİM KOMUTLARI: /banlist, /banlar
bot.command(['banlist', 'banlar'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    return renderBansPanel(ctx);
});

// ADMİN: TÜM BANLARI VE UYARILARI KALDIR: /bantemizle
bot.command('bantemizle', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const bannedUsers = db.getBannedUsers();
    const count = db.unbanAllUsers();

    for (const u of bannedUsers) {
        bot.telegram.sendMessage(
            u.id,
            `✅ <b>Müjde!</b> Hesabınızın banı yönetici tarafından kaldırıldı. Tekrar kurallara uygun şekilde botu kullanabilirsiniz.`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏠 Ana Menüye Git', 'main_menu')]
                ])
            }
        ).catch(() => {});
    }

    return ctx.reply(`✅ <b>Tüm banlar ve uyarılar başarıyla kaldırıldı!</b>\nTemizlenen kullanıcı sayısı: ${count}`, { parse_mode: 'HTML' });
});

// ADMİN: SİSTEMDEKİ TÜM AYNI / KOPYA VE BENZER MEDYALARI TEMİZLE: /kopyatemizle, /benzersil, /benzervideolarisil
bot.command(['kopyatemizle', 'aynilarisil', 'benzersil', 'benzervideolarisil'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const res = db.cleanDuplicateMedia('video');
    return ctx.reply(
        `🧹 <b>Benzer & Kopya Video Temizleme Raporu:</b>\n\n` +
        `📊 <b>Başlangıçtaki Toplam Medya:</b> ${res.initialCount}\n` +
        `🗑️ <b>Silinen Benzer/Kopya Video Sayısı:</b> <b>${res.deletedVideos} adet</b>\n` +
        `✅ <b>Havuzdaki Kalan Medya Sayısı:</b> <b>${res.remainingCount} adet</b>\n\n` +
        `<i>Havuzdaki tüm videolar artık %100 tektir ve sistemde benzer veya mükerrer video kaydı kalmamıştır.</i>`,
        { parse_mode: 'HTML' }
    );
});

// ADMİN MANUEL VIP VERME: /vipver <id> <gun>
bot.command('vipver', (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) {
        return ctx.reply('Kullanım: /vipver <kullanici_id> <gün_sayısı>');
    }
    const targetId = parts[1];
    const days = parseInt(parts[2], 10);
    if (isNaN(days) || days <= 0) return ctx.reply('Geçerli bir gün sayısı girin.');

    const res = db.addVipDays(targetId, days);
    if (!res) return ctx.reply('Kullanıcı bulunamadı.');

    ctx.reply(`✅ Kullanıcıya (${targetId}) ${days} gün VIP tanımlandı.`);
    bot.telegram.sendMessage(targetId, `🎉 <b>Tebrikler!</b> Hesabınıza yönetici tarafından <b>${days} Günlük VIP Üyelik</b> tanımlandı!`, { parse_mode: 'HTML' }).catch(() => {});
});

// ADMİN MANUEL KREDİ VERME: /krediver <id> <resim/video> <adet>
bot.command('krediver', (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 4) {
        return ctx.reply('Kullanım: /krediver <kullanici_id> <resim|video> <adet>');
    }
    const targetId = parts[1];
    const type = parts[2].toLowerCase() === 'video' ? 'video' : 'photo';
    const amount = parseInt(parts[3], 10);
    if (isNaN(amount) || amount <= 0) return ctx.reply('Geçerli bir adet girin.');

    const newCredits = db.updateCredits(targetId, type, amount);
    const label = type === 'photo' ? 'Resim' : 'Video';

    ctx.reply(`✅ ${targetId} ID'li kullanıcıya +${amount} ${label} Kredisi eklendi. (Yeni Bakiye: ${newCredits})`);
    bot.telegram.sendMessage(targetId, `🎁 <b>Tebrikler!</b> Hesabınıza yönetici tarafından <b>+${amount} ${label} Kredisi</b> eklendi!`, { parse_mode: 'HTML' }).catch(() => {});
});

// ADMİN DUYURU (BROADCAST): /duyuru <mesaj>
bot.command('duyuru', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const msg = ctx.message.text.replace('/duyuru', '').trim();
    if (!msg) {
        return ctx.reply('Kullanım: /duyuru <Gönderilecek Mesaj>');
    }

    const allUsers = db.getAllUserIds();
    let sentCount = 0;
    let failCount = 0;

    await ctx.reply(`📢 Duyuru ${allUsers.length} kullanıcıya gönderiliyor...`);

    for (const uid of allUsers) {
        try {
            await bot.telegram.sendMessage(uid, `📢 <b>YÖNETİCİ DUYURUSU:</b>\n\n${msg}`, { parse_mode: 'HTML' });
            sentCount++;
        } catch {
            failCount++;
        }
    }

    return ctx.reply(`✅ Duyuru tamamlandı!\nBaşarılı: ${sentCount} | İletilemeyen: ${failCount}`);
});

// ADMİN: SEKME / KATEGORİ YÖNETİM PANELİ (Callback)
bot.action('admin_manage_cats', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu panel sadece yöneticiye özeldir.');
    }
    await ctx.answerCbQuery();
    const categories = db.getCategories();
    let text = 
`⚙️ <b>Sekme & Kategori Yönetim Paneli</b>\n\n` +
`Aşağıda sistemdeki 10 sekme listelenmiştir. Düzenlemek istediğiniz sekmeyi seçebilir veya doğrudan komut ile anında yeni isim atayabilirsiniz.\n\n` +
`💡 <b>Komutla Hızlı Değiştirme:</b>\n` +
`<code>/kategoriadi &lt;A-J veya 1-10&gt; &lt;Yeni İsim&gt;</code>\n` +
`<i>Örnek:</i> <code>/kategoriadi A Doğa ve Manzara</code>\n\n` +
`👇 <b>Mevcut 10 Sekme ve Havuz Durumları:</b>\n`;

    const keyboardRows = [];
    for (let i = 0; i < categories.length; i += 2) {
        const cat1 = categories[i];
        const cat2 = categories[i + 1];
        const row = [
            Markup.button.callback(`✏️ [${cat1.key}] ${cat1.name}`, `admin_rename_${cat1.id}`)
        ];
        if (cat2) {
            row.push(Markup.button.callback(`✏️ [${cat2.key}] ${cat2.name}`, `admin_rename_${cat2.id}`));
        }
        keyboardRows.push(row);
    }
    keyboardRows.push([
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(keyboardRows)
    });
});

// Sekme yeniden adlandırma geçici hafızası
const adminRenameState = {}; // userId -> { catId, catKey, oldName }
const adminUserState = {}; // adminId -> { type: 'warn' | 'msg', targetUserId, mediaId }
const pendingRenameConfirmations = {}; // confirmId -> { catId, catKey, oldName, newName }

// Onay Ekranı Gösterme Fonksiyonu
async function showRenameConfirmation(ctx, cat, newName) {
    const confirmId = 'ren_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const cleanName = newName.trim();

    pendingRenameConfirmations[confirmId] = {
        catId: cat.id,
        catKey: cat.key,
        oldName: cat.name,
        newName: cleanName
    };

    const confirmText = 
`⚠️ <b>SEKME İSMİ DEĞİŞTİRME ONAYI</b>\n\n` +
`🏷️ <b>Sekme Harfi:</b> <b>[${cat.key}]</b>\n` +
`🔴 <b>Eski İsim:</b> <code>${cat.name}</code>\n` +
`🟢 <b>Yeni İsim:</b> <b>${cleanName}</b>\n\n` +
`❓ <b>Bu yeni ismi onaylıyor musunuz?</b>\n` +
`<i>Onay verdiğinizde anında ana menüde ve TÜM KULLANICILARDA bu isim geçerli olacaktır.</i>`;

    const confirmKeyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Evet, Onayla ve Herkeste Güncelle', `confirm_rename_${confirmId}`)
        ],
        [
            Markup.button.callback('❌ Vazgeç / İptal Et', `cancel_rename_${confirmId}`)
        ]
    ]);

    return ctx.reply(confirmText, {
        parse_mode: 'HTML',
        ...confirmKeyboard
    });
}

// ADMİN: SEKME YENİDEN ADLANDIRMA BAŞLAT (Şifre Korumalı)
bot.action(/admin_rename_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.', { show_alert: true });
    }
    await ctx.answerCbQuery();
    const catId = ctx.match[1];
    const cat = db.getCategory(catId);
    if (!cat) return ctx.reply('Sekme bulunamadı.');

    // Şifre bekleme moduna alıyoruz
    pendingRenameAuth[String(ctx.from.id)] = cat.id;

    const text = 
`🔒 <b>Sekme İsmi Değiştirme Kilitli — [${cat.key}] ${cat.name}</b>\n\n` +
`Sekme isimlerini değiştirmek kilitlidir. Devam etmek için lütfen <b>yönetici şifresini</b> girin:\n\n` +
`<i>İptal etmek için /iptal yazabilir veya aşağıdaki butona tıklayabilirsiniz.</i>`;

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ İptal Et / Vazgeç', 'admin_cancel_rename')],
            [Markup.button.callback('⬅️ Sekme Paneline Dön', 'admin_manage_cats')]
        ])
    });
});

// ADMİN: İSİM GİRME İPTAL
bot.action('admin_cancel_rename', async (ctx) => {
    delete pendingRenameAuth[String(ctx.from?.id)];
    delete adminRenameState[ctx.from?.id];
    await ctx.answerCbQuery('İşlem iptal edildi.');
    return safeEditOrReply(ctx, '❌ <b>Sekme adı değiştirme işlemi iptal edildi.</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⚙️ Sekme Yönetimine Dön', 'admin_manage_cats')],
            [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
        ])
    });
});

// ADMİN: ONAY VERİLDİĞİNDE (Herkeste güncelle)
bot.action(/confirm_rename_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    const confirmId = ctx.match[1];
    const data = pendingRenameConfirmations[confirmId];

    if (!data) {
        await ctx.answerCbQuery('Bu onay işleminin süresi dolmuş veya işlem zaten yapılmış.', { show_alert: true });
        return;
    }

    const updated = db.updateCategoryName(data.catId, data.newName);
    delete pendingRenameConfirmations[confirmId];
    delete adminRenameState[ctx.from.id];

    await ctx.answerCbQuery('🎉 Sekme ismi tüm kullanıcılar için güncellendi!', { show_alert: true });

    const successText = 
`🎉 <b>SEKME İSMİ BAŞARIYLA GÜNCELLENDİ!</b>\n\n` +
`🏷️ <b>Sekme:</b> [${updated.key}]\n` +
`✨ <b>Yeni İsim:</b> <b>${updated.name}</b>\n\n` +
`✅ <b>Onay Verildi:</b> Artık ana menüde ve sekme işlemlerinde TÜM KULLANICILARDA bu isim geçerli olacaktır.`;

    const successKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Başka Bir Sekme Düzenle', 'admin_manage_cats')],
        [Markup.button.callback('🏠 Ana Menüye Dön', 'main_menu')]
    ]);

    return safeEditOrReply(ctx, successText, {
        parse_mode: 'HTML',
        ...successKeyboard
    });
});

// ADMİN: ONAY EKRANINDA VAZGEÇİLDİĞİNDE
bot.action(/cancel_rename_(.+)/, async (ctx) => {
    const confirmId = ctx.match[1];
    delete pendingRenameConfirmations[confirmId];
    delete adminRenameState[ctx.from.id];
    await ctx.answerCbQuery('İptal edildi.');

    const cancelText = `❌ <b>İsim değişikliği iptal edildi.</b> Mevcut isim korundu.`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Sekme Yönetimi', 'admin_manage_cats')],
        [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
    ]);

    return safeEditOrReply(ctx, cancelText, {
        parse_mode: 'HTML',
        ...keyboard
    });
});

// ADMİN: KATEGORİLER LİSTESİ: /kategoriler
bot.command('kategoriler', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const categories = db.getCategories();
    let text = `⚙️ <b>Sistemdeki Sekmeler / Kategoriler (10 Adet)</b>\n\n`;

    categories.forEach((cat) => {
        const stats = db.getCategoryStats(cat.id);
        text += `• <b>[${cat.key}]</b> <b>${cat.name}</b> — 📸 ${stats.approvedPhotos} Resim | 🎥 ${stats.approvedVideos} Video\n`;
    });

    text += `\n💡 <b>İsim değiştirmek için aşağıdaki butona basıp yeni ismi yazabilirsiniz:</b>`;

    return ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⚙️ Sekmeleri Düzenle', 'admin_manage_cats')],
            [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
        ])
    });
});

// ADMİN: KATEGORİ ADI DEĞİŞTİR: /kategoriadi (Kilitli & Şifre Korumalı)
async function handleKategoriAdiCommand(ctx) {
    if (!isAdminUser(ctx.from?.id)) return;
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
        return ctx.reply(
            `🔒 <b>Sekme Adı Değiştirme (Kilitli & Şifre Korumalı):</b>\n\n` +
            `<code>/kategoriadi &lt;A-J veya 1-10&gt; &lt;Yeni İsim&gt;</code>\n\n` +
            `<b>Örnek:</b>\n` +
            `<code>/kategoriadi A Doğa ve Manzara</code>\n\n` +
            `<i>Komutu gönderdikten sonra güvenlik için yönetici şifreniz istenecektir.</i>\n` +
            `<i>Veya butonla düzenlemek için aşağıdaki butona tıklayın:</i>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⚙️ Sekme Yönetim Panelini Aç', 'admin_manage_cats')]
                ])
            }
        );
    }

    const keyOrId = parts[1];
    const newName = parts.slice(2).join(' ');
    const cat = db.getCategory(keyOrId);
    if (!cat) {
        return ctx.reply(`❌ Geçersiz sekme! Lütfen A-J veya 1-10 arası bir harf ya da sayı girin.`);
    }

    pendingRenameAuth[String(ctx.from.id)] = { catId: cat.id, pendingName: newName };
    return ctx.reply(
        `🔒 <b>Sekme İsmi Değiştirme Kilitli!</b>\n\n` +
        `<b>[${cat.key}] ${cat.name}</b> sekmesinin adını <b>"${escapeHtml(newName)}"</b> yapmak üzeresiniz.\n\n` +
        `Sekme isimlerini değiştirmek kilitlidir. Devam etmek için lütfen <b>yönetici şifresini</b> girin:\n\n` +
        `<i>İptal etmek için /iptal yazabilirsiniz.</i>`,
        { parse_mode: 'HTML' }
    );
}

bot.command('kategoriadi', handleKategoriAdiCommand);

// YÖNETİCİ METİN YAZDIĞINDA (YENİ İSİM GİRİŞİ, DİREKT İSİM DEĞİŞTİRME VEYA ÖZEL UYARI / MESAJ)
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text ? ctx.message.text.trim() : '';

    // 🔐 Admin Şifre Doğrulama — Öncelikli kontrol
    if (pendingAdminAuth.has(String(ctx.from.id))) {
        pendingAdminAuth.delete(String(ctx.from.id));
        if (text === ADMIN_PASSWORD) {
            authenticatedAdmins.add(String(ctx.from.id));
            saveAuthenticatedAdmins(authenticatedAdmins);
            await ctx.reply('✅ <b>Şifre doğrulandı! Yönetici paneline hoş geldiniz.</b>', { parse_mode: 'HTML' });
            return showAdminPanel(ctx);
        } else {
            return ctx.reply('❌ <b>Hatalı şifre!</b> Tekrar denemek için /admin yazabilir veya butona tıklayabilirsiniz.', { parse_mode: 'HTML' });
        }
    }

    // 🔐 Sekme Özel Yönetici Şifre Doğrulama (Tüm Sekmeler İçin)
    if (pendingCatAdminAuth[String(ctx.from?.id)]) {
        const targetCatId = pendingCatAdminAuth[String(ctx.from.id)];
        delete pendingCatAdminAuth[String(ctx.from.id)];

        if (text === ADMIN_PASSWORD) {
            await ctx.reply('✅ <b>Şifre doğrulandı! Yönetici testi açıldı.</b>', { parse_mode: 'HTML' });
            return showCategoryTakeMenu(ctx, targetCatId);
        } else {
            return ctx.reply('❌ <b>Hatalı şifre!</b> Yönetici erişimi reddedildi.', { parse_mode: 'HTML' });
        }
    }

    // 🔐 Sekme İsmi Değiştirme Şifre Doğrulama (Kilitli Sekme İsimleri)
    if (isAdminUser(ctx.from?.id) && pendingRenameAuth[String(ctx.from.id)]) {
        const authData = pendingRenameAuth[String(ctx.from.id)];
        delete pendingRenameAuth[String(ctx.from.id)];

        if (text === ADMIN_PASSWORD) {
            const catId = typeof authData === 'object' ? authData.catId : authData;
            const cat = db.getCategory(catId);
            if (!cat) {
                return ctx.reply('❌ Sekme bulunamadı.');
            }

            if (typeof authData === 'object' && authData.pendingName) {
                await ctx.reply('✅ <b>Şifre doğrulandı!</b>', { parse_mode: 'HTML' });
                return showRenameConfirmation(ctx, cat, authData.pendingName);
            } else {
                adminRenameState[ctx.from.id] = { catId: cat.id, catKey: cat.key, oldName: cat.name };
                return ctx.reply(
                    `✅ <b>Şifre Doğrulandı!</b>\n\n` +
                    `Lütfen <b>[${cat.key}] ${cat.name}</b> sekmesi için <b>yeni ismi</b> yazıp gönderin:\n\n` +
                    `<i>İptal etmek için /iptal yazabilirsiniz.</i>`,
                    { parse_mode: 'HTML' }
                );
            }
        } else {
            return ctx.reply('❌ <b>Hatalı şifre!</b> Sekme ismi değiştirme izni verilmedi.', { parse_mode: 'HTML' });
        }
    }

    // /iptal komutu kontrolü
    if (text === '/iptal') {
        let cancelled = false;
        if (pendingAdminAuth.has(String(ctx.from.id))) {
            pendingAdminAuth.delete(String(ctx.from.id));
            cancelled = true;
        }
        if (pendingCatAdminAuth[String(ctx.from.id)]) {
            delete pendingCatAdminAuth[String(ctx.from.id)];
            cancelled = true;
        }
        if (pendingRenameAuth[String(ctx.from.id)]) {
            delete pendingRenameAuth[String(ctx.from.id)];
            cancelled = true;
        }
        if (adminUserState[ctx.from.id]) {
            delete adminUserState[ctx.from.id];
            cancelled = true;
        }
        if (adminRenameState[ctx.from.id]) {
            delete adminRenameState[ctx.from.id];
            cancelled = true;
        }
        if (cancelled) {
            return ctx.reply('❌ Bekleyen işlem iptal edildi.');
        }
    }

    // Komut ise geç
    if (text.startsWith('/')) {
        return next();
    }

    // 0. Yönetici kullanıcıya özel uyarı veya mesaj yazma modunda mı?
    if (isAdminUser(ctx.from?.id) && adminUserState[ctx.from.id]) {
        const state = adminUserState[ctx.from.id];
        delete adminUserState[ctx.from.id];
        const targetUserId = state.targetUserId;
        const targetUser = db.getUser(targetUserId);

        if (state.type === 'warn') {
            const warningReason = text;
            const newWarningCount = db.addWarning(targetUserId);
            
            const userWarningMsg = 
`⚠️ <b>YÖNETİCİ UYARISI ALDINIZ!</b>\n\n` +
`Gönderdiğiniz içerik incelenmiş olup kurallarımıza uygun bulunmadığı için yönetici tarafından uyarıldınız.\n\n` +
`📋 <b>Uyarı Nedeni:</b>\n<i>${escapeHtml(warningReason)}</i>\n\n` +
`⚠️ <b>Mevcut Uyarı Durumunuz:</b> <b>${newWarningCount} / 3</b>\n\n` +
`⛔ <i>Lütfen kurallara dikkat ediniz. 3 uyarı alan hesaplar sistemden otomatik olarak süresiz banlanmaktadır.</i>`;

            let isDelivered = false;
            try {
                await bot.telegram.sendMessage(targetUserId, userWarningMsg, { parse_mode: 'HTML' });
                isDelivered = true;
            } catch (err) {
                console.error('Uyarı mesajı iletilemedi:', err.message);
            }

            if (newWarningCount >= 3) {
                db.banUser(targetUserId, '3 kez yönetici uyarısı aldı (Kural ihlalleri)');
                try {
                    await bot.telegram.sendMessage(
                        targetUserId, 
                        `🚫 <b>HESABINIZ ASKIYA ALINDI (BANLANDINIZ)</b>\n\n3 uyarı limitine ulaştığınız için bot erişiminiz süresiz olarak engellenmiştir.`, 
                        { parse_mode: 'HTML' }
                    );
                } catch {}
            }

            return ctx.reply(
                `✅ <b>Özel Uyarı İletildi!</b>\n\n` +
                `👤 <b>Kullanıcı:</b> ${escapeHtml(targetUser?.firstName || 'Kullanıcı')} (<code>${targetUserId}</code>)\n` +
                `⚠️ <b>Güncel Uyarı Sayısı:</b> <b>${newWarningCount} / 3</b>\n` +
                `📝 <b>İletilen Neden:</b> ${escapeHtml(warningReason)}\n` +
                (newWarningCount >= 3 ? `🚫 <b>Kullanıcı 3 uyarıya ulaştığı için OTOMATİK BANLANDI!</b>\n` : '') +
                (isDelivered ? `📨 <i>Kullanıcıya başarıyla teslim edildi.</i>` : `⚠️ <i>Kullanıcı botu engellediği için Telegram mesajı iletilemedi ancak veritabanına uyarı işlendi.</i>`),
                { parse_mode: 'HTML' }
            );
        } else if (state.type === 'msg') {
            const adminMsg = text;
            const userNoticeMsg = 
`📩 <b>YÖNETİCİDEN BİLGİLENDİRME MESAJI</b>\n\n` +
`Yöneticimiz tarafından gönderdiğiniz içeriklerle ilgili size özel bir mesaj iletildi:\n\n` +
`💬 <i>"${escapeHtml(adminMsg)}"</i>\n\n` +
`✨ <i>Göstermiş olduğunuz özen için teşekkür eder, keyifli paylaşımlar dileriz.</i>`;

            let isDelivered = false;
            try {
                await bot.telegram.sendMessage(targetUserId, userNoticeMsg, { parse_mode: 'HTML' });
                isDelivered = true;
            } catch (err) {
                console.error('Özel mesaj iletilemedi:', err.message);
            }

            return ctx.reply(
                `✅ <b>Mesajınız Kullanıcıya İletildi!</b>\n\n` +
                `👤 <b>Alıcı:</b> ${escapeHtml(targetUser?.firstName || 'Kullanıcı')} (<code>${targetUserId}</code>)\n` +
                `💬 <b>Mesajınız:</b>\n<i>"${escapeHtml(adminMsg)}"</i>\n\n` +
                (isDelivered ? `📨 <i>Mesaj kullanıcıya başarıyla teslim edildi.</i>` : `⚠️ <i>Kullanıcı botu engellediği için Telegram mesajı iletilemedi.</i>`),
                { parse_mode: 'HTML' }
            );
        }
    }

    // 1. Yönetici isim bekleme modunda mı?
    if (isAdminUser(ctx.from?.id) && adminRenameState[ctx.from.id]) {
        const state = adminRenameState[ctx.from.id];
        const newName = text;
        const cat = db.getCategory(state.catId);
        delete adminRenameState[ctx.from.id];
        return showRenameConfirmation(ctx, cat, newName);
    }

    // 2. Yönetici doğrudan "A Doğa" veya "B Komik Videolar" veya "1 Manzara" yazdı mı? (Kilitli & Şifre İste)
    if (isAdminUser(ctx.from?.id)) {
        const match = text.match(/^([A-Ja-j]|10|[1-9])\s+(.+)$/);
        if (match) {
            const catKeyOrNum = match[1];
            const newName = match[2].trim();
            const cat = db.getCategory(catKeyOrNum);
            if (cat) {
                pendingRenameAuth[String(ctx.from.id)] = { catId: cat.id, pendingName: newName };
                return ctx.reply(
                    `🔒 <b>Sekme İsmi Değiştirme Kilitli!</b>\n\n` +
                    `<b>[${cat.key}] ${cat.name}</b> sekmesinin adını <b>"${escapeHtml(newName)}"</b> yapmak üzeresiniz.\n\n` +
                    `Sekme isimlerini değiştirmek kilitlidir. Devam etmek için lütfen <b>yönetici şifresini</b> girin:\n\n` +
                    `<i>İptal etmek için /iptal yazabilirsiniz.</i>`,
                    { parse_mode: 'HTML' }
                );
            }
        }
    }

    return next();
});

// HTML Kaçış Yardımcısı
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ADMİN: KULLANICILAR VE YÜKLEDİKLERİ İÇERİKLER LİSTESİ PANELİ (Sayfalı)
async function renderAdminUsersList(ctx, page = 1) {
    if (!isAdminUser(ctx.from?.id)) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Bu panel sadece yöneticiye özeldir.');
        return;
    }

    const allUsers = db.getAllUsers();
    if (!allUsers || allUsers.length === 0) {
        return safeEditOrReply(ctx, 'ℹ️ Sistemde kayıtlı kullanıcı bulunmuyor.', {
            ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Ana Menü', 'main_menu')]])
        });
    }

    // Her kullanıcının yüklediği aktif medya sayılarını hesapla
    const usersWithCounts = allUsers.map(u => {
        const counts = db.getUserMediaCount(u.id);
        return { user: u, counts };
    });

    // Medya yükleyenleri (içerik katkısı olanları) en üste sırala (toplam içerik azalan, sonra ID)
    usersWithCounts.sort((a, b) => {
        if (b.counts.total !== a.counts.total) {
            return b.counts.total - a.counts.total;
        }
        return String(a.user.id).localeCompare(String(b.user.id));
    });

    const pageSize = 6;
    const totalPages = Math.ceil(usersWithCounts.length / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const pageItems = usersWithCounts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const stats = db.getStats();

    let text = 
`👥 <b>Kullanıcılar & Yüklenen İçerikler Yönetim Paneli</b>\n\n` +
`📊 <b>Toplam Kayıtlı Kullanıcı:</b> <b>${allUsers.length}</b>\n` +
`📸 <b>Havuzdaki Resimler:</b> <b>${stats.approvedPhotos}</b> | 🎥 <b>Videolar:</b> <b>${stats.approvedVideos}</b>\n` +
`📄 <b>Sayfa:</b> <b>${currentPage} / ${totalPages}</b>\n\n` +
`<i>Aşağıdaki listeden kullanıcının adına tıklayarak profilini ve yüklediği <b>resimleri / videoları</b> ayrı ayrı inceleyebilirsiniz:</i>\n\n`;

    const buttons = [];

    pageItems.forEach((item, idx) => {
        const u = item.user;
        const c = item.counts;
        const itemNum = (currentPage - 1) * pageSize + idx + 1;
        const name = escapeHtml(u.firstName || 'İsimsiz');
        const uname = u.username ? `@${escapeHtml(u.username)}` : 'Yok';
        const banBadge = u.isBanned ? ' 🚫 [BANLI]' : '';
        const vip = db.isUserVip(u.id);
        const vipBadge = vip.isVip ? ' 👑' : '';

        text += `<b>${itemNum}.</b> 👤 <b>${name}</b> (${uname})${vipBadge}${banBadge}\n`;
        text += `   🆔 ID: <code>${u.id}</code>\n`;
        text += `   📤 Yüklemeler: 📸 <b>${c.photos} Resim</b> | 🎥 <b>${c.videos} Video</b>\n\n`;

        // Kullanıcı butonu
        const btnLabel = `👤 ${(u.firstName || 'Kullanıcı').slice(0, 14)} (📸 ${c.photos} | 🎥 ${c.videos})`;
        buttons.push([Markup.button.callback(btnLabel, `admin_u_view_${u.id}`)]);
    });

    // Sayfalama (Pagination) Butonları
    const navRow = [];
    if (currentPage > 1) {
        navRow.push(Markup.button.callback('⬅️ Önceki', `admin_users_${currentPage - 1}`));
    }
    navRow.push(Markup.button.callback(`📄 ${currentPage} / ${totalPages}`, 'admin_u_noop'));
    if (currentPage < totalPages) {
        navRow.push(Markup.button.callback('Sonraki ➡️', `admin_users_${currentPage + 1}`));
    }
    buttons.push(navRow);

    buttons.push([
        Markup.button.callback('🔄 Listeyi Yenile', `admin_users_${currentPage}`),
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
}

// ADMİN: TEK BİR KULLANICININ DETAY KARTI
async function renderAdminUserView(ctx, userId) {
    if (!isAdminUser(ctx.from?.id)) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
        return;
    }

    const u = db.getUser(userId);
    if (!u) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Kullanıcı bulunamadı.', { show_alert: true });
        return renderAdminUsersList(ctx, 1);
    }

    const counts = db.getUserMediaCount(userId);
    const vip = db.isUserVip(userId);
    const name = escapeHtml(u.firstName || 'İsimsiz');
    const lastName = escapeHtml(u.lastName || '');
    const uname = u.username ? `@${escapeHtml(u.username)}` : 'Kullanıcı adı yok';
    const vipText = vip.isVip 
        ? (vip.isUnlimited ? '👑 VIP (Sınırsız Yönetici)' : `👑 VIP (${vip.remainingHours} saat kaldı)`)
        : 'Standart Üye';
    const banText = u.isBanned 
        ? `🚫 BANLI (${escapeHtml(u.bannedReason || 'Kural ihlali')})` 
        : '✅ Aktif (Temiz)';

    const text = 
`👤 <b>Kullanıcı Detay & İçerik Kartı</b>\n\n` +
`🆔 <b>Telegram ID:</b> <code>${u.id}</code>\n` +
`👤 <b>Ad Soyad:</b> <b>${name} ${lastName}</b>\n` +
`🔗 <b>Kullanıcı Adı:</b> ${uname}\n` +
`👑 <b>VIP Durumu:</b> ${vipText}\n` +
`🛡️ <b>Ban Durumu:</b> ${banText}\n\n` +
`💰 <b>Mevcut Kredileri:</b> 📸 <b>${u.photoCredits || 0} Resim</b> | 🎥 <b>${u.videoCredits || 0} Video</b>\n` +
`📥 <b>Sistemden Aldığı Medyalar:</b> 📸 ${u.receivedPhotos || 0} Resim | 🎥 ${u.receivedVideos || 0} Video\n\n` +
`📤 <b>Kullanıcının Havuzdaki Aktif İçerikleri:</b>\n` +
`📸 <b>Fotoğraflar:</b> <b>${counts.photos} adet</b>\n` +
`🎥 <b>Videolar:</b> <b>${counts.videos} adet</b>\n\n` +
`👇 <i>Aşağıdaki butonları kullanarak kullanıcının yüklediği fotoğrafları veya videoları tek tek gezin, inceleyin, silin ya da doğru sekmeye aktarın:</i>`;

    const buttons = [];

    // Fotoğrafları İncele Butonu
    if (counts.photos > 0) {
        buttons.push([Markup.button.callback(`📸 Yüklediği Fotoğrafları Gör (${counts.photos} Adet)`, `admin_ub_${u.id}_photo_0`)]);
    } else {
        buttons.push([Markup.button.callback('📸 Yüklediği Fotoğraf Yok (0)', 'admin_u_alert_no_photo')]);
    }

    // Videoları İncele Butonu
    if (counts.videos > 0) {
        buttons.push([Markup.button.callback(`🎥 Yüklediği Videoları Gör (${counts.videos} Adet)`, `admin_ub_${u.id}_video_0`)]);
    } else {
        buttons.push([Markup.button.callback('🎥 Yüklediği Video Yok (0)', 'admin_u_alert_no_video')]);
    }

    // Uyarı, Mesaj ve Ban Butonları (Admin kendisini banlayamaz veya uyaramaz)
    if (!isAdminUser(u.id)) {
        buttons.push([
            Markup.button.callback(`⚠️ Uyarı Ver (${u.warnings || 0}/3 Uyarı)`, `admin_warn_${u.id}_profile`),
            Markup.button.callback('💬 Özel Mesaj Gönder', `admin_msg_${u.id}_profile`)
        ]);
        if (u.isBanned) {
            buttons.push([Markup.button.callback(`🔓 ${name} Kullanıcısının Banını Kaldır`, `admin_u_toggleban_${u.id}`)]);
        } else {
            buttons.push([Markup.button.callback(`🚫 ${name} Kullanıcısını Banla`, `admin_u_toggleban_${u.id}`)]);
        }
    }

    buttons.push([
        Markup.button.callback('⬅️ Kullanıcı Listesine Dön', 'admin_users_1'),
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
}

// ADMİN: KULLANICININ YÜKLEDİĞİ MEDYALARI GEZİNTİ EKRANI (Fotoğraf & Video Görüntüleyici)
async function renderUserMediaBrowser(ctx, userId, type, index = 0) {
    if (!isAdminUser(ctx.from?.id)) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
        return;
    }

    const mediaList = db.getUserMedia(userId, type);
    const targetUser = db.getUser(userId) || { id: userId, firstName: 'Kullanıcı' };

    if (!mediaList || mediaList.length === 0) {
        if (ctx.answerCbQuery) {
            await ctx.answerCbQuery(`Bu kullanıcının sistemde aktif ${type === 'photo' ? 'resmi' : 'videosu'} bulunmuyor.`, { show_alert: true });
        }
        return renderAdminUserView(ctx, userId);
    }

    let idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx >= mediaList.length) idx = mediaList.length - 1;

    const item = mediaList[idx];
    const cat = db.getCategory(item.categoryId);
    const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleString('tr-TR') : 'Bilinmiyor';

    const caption = 
`👤 <b>Yükleyen:</b> <b>${escapeHtml(targetUser.firstName || 'Kullanıcı')}</b> (ID: <code>${targetUser.id}</code>)\n` +
`📁 <b>Bulunduğu Sekme:</b> [${cat?.key || '?'}] <b>${escapeHtml(cat?.name || 'Bilinmiyor')}</b>\n` +
`📅 <b>Yükleme Tarihi:</b> ${dateStr}\n` +
`📊 <b>${type === 'photo' ? '📸 Resim' : '🎥 Video'}:</b> <b>${idx + 1} / ${mediaList.length}</b>\n` +
`🆔 <b>Medya ID:</b> <code>${item.id}</code>\n` +
`👍 Beğeni: ${item.likes?.length || 0} | 👎 Beğenmeme: ${item.dislikes?.length || 0}`;

    // Gezinti Butonları (Önceki - Konum - Sonraki)
    const navRow = [];
    if (idx > 0) {
        navRow.push(Markup.button.callback('⬅️ Önceki', `admin_ub_${userId}_${type}_${idx - 1}`));
    }
    navRow.push(Markup.button.callback(`📌 ${idx + 1} / ${mediaList.length}`, 'admin_u_noop'));
    if (idx < mediaList.length - 1) {
        navRow.push(Markup.button.callback('Sonraki ➡️', `admin_ub_${userId}_${type}_${idx + 1}`));
    }

    const buttons = [
        navRow,
        [
            Markup.button.callback('🗑️ Bu İçeriği Havuzdan Sil', `admin_udel_${item.id}__${idx}`),
            Markup.button.callback('📂 Sekmesini Değiştir', `mv_p_${item.id}`)
        ],
        [
            Markup.button.callback('⚠️ Bu Medya İçin Uyarı Ver', `admin_warn_${userId}_${item.id}`),
            Markup.button.callback('💬 Bu Medya İçin Mesaj At', `admin_msg_${userId}_${item.id}`)
        ],
        [
            Markup.button.callback('👤 Kullanıcı Profiline Dön', `admin_u_view_${userId}`),
            Markup.button.callback('👥 Kullanıcı Listesi', 'admin_users_1')
        ]
    ];

    const keyboard = Markup.inlineKeyboard(buttons);

    // Eğer mevcut mesaj bir medya ise, aynı türde doğrudan editMessageMedia yapmayı dene
    const msg = ctx.callbackQuery?.message;
    const isCurrentMedia = msg && (msg.photo || msg.video);

    if (isCurrentMedia) {
        try {
            await ctx.editMessageMedia(
                {
                    type: type,
                    media: item.fileId,
                    caption: caption,
                    parse_mode: 'HTML'
                },
                keyboard
            );
            return;
        } catch (e) {
            // editMessageMedia başarısız olursa fallback ile yeni gönder
        }
    }

    if (type === 'video') {
        return ctx.replyWithVideo(item.fileId, {
            caption: caption,
            parse_mode: 'HTML',
            ...keyboard
        });
    } else {
        return ctx.replyWithPhoto(item.fileId, {
            caption: caption,
            parse_mode: 'HTML',
            ...keyboard
        });
    }
}

// ADMİN: KULLANICI LİSTESİ BUTON EYLEMİ
bot.action(/admin_users_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const page = parseInt(ctx.match[1], 10);
    return renderAdminUsersList(ctx, page);
});

// ADMİN: TEK KULLANICI PROFİL GÖRÜNTÜLEME
bot.action(/admin_u_view_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.match[1];
    return renderAdminUserView(ctx, userId);
});

// ADMİN: MEDYA GEZİNTİSİ (Resim / Video)
bot.action(/admin_ub_(\d+)_(photo|video)_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.match[1];
    const type = ctx.match[2];
    const index = parseInt(ctx.match[3], 10);
    return renderUserMediaBrowser(ctx, userId, type, index);
});

// ADMİN: KULLANICI MEDYASINI HAVUZDAN SİLME
bot.action(/admin_udel_(.+)__(\d+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }

    const mediaId = ctx.match[1];
    const idx = parseInt(ctx.match[2], 10);

    const media = db.getMedia(mediaId);
    if (!media) {
        return ctx.answerCbQuery('Bu medya zaten silinmiş veya bulunamadı.', { show_alert: true });
    }

    const uid = media.uploadedBy;
    const type = media.type;

    db.deleteMedia(mediaId);
    await ctx.answerCbQuery('🗑️ İçerik havuzdan tamamen silindi!', { show_alert: true });

    const remaining = db.getUserMedia(uid, type);
    if (remaining.length === 0) {
        try {
            await ctx.deleteMessage();
        } catch (e) {}
        return renderAdminUserView(ctx, uid);
    } else {
        const nextIdx = Math.min(idx, remaining.length - 1);
        return renderUserMediaBrowser(ctx, uid, type, nextIdx);
    }
});

// ADMİN: KULLANICIYI BANLA / BAN KALDIR (Detay kartından)
bot.action(/admin_u_toggleban_(\d+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }

    const targetId = ctx.match[1];
    const u = db.getUser(targetId);
    if (!u) {
        return ctx.answerCbQuery('Kullanıcı bulunamadı.', { show_alert: true });
    }

    if (u.isBanned) {
        db.unbanUser(targetId);
        await ctx.answerCbQuery(`✅ ${u.firstName || targetId} kullanıcısının banı kaldırıldı!`, { show_alert: true });
        bot.telegram.sendMessage(
            targetId,
            `✅ <b>Müjde!</b> Hesabınızın banı yönetici tarafından kaldırıldı. Tekrar botu kurallara uygun şekilde kullanabilirsiniz.`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } else {
        db.banUser(targetId, 'Yönetici tarafından kullanıcı yönetim panelinden banlandı.');
        await ctx.answerCbQuery(`🚫 ${u.firstName || targetId} kullanıcısı banlandı!`, { show_alert: true });
        bot.telegram.sendMessage(
            targetId,
            `🚫 <b>HESABINIZ YÖNETİCİ TARAFINDAN BANLANDI!</b>\n\nSistem kurallarını ihlal etmeniz sebebiyle bot erişiminiz süresiz olarak engellenmiştir.`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }

    return renderAdminUserView(ctx, targetId);
});

// Pasif Butonlar & Uyarılar
bot.action('admin_u_noop', ctx => ctx.answerCbQuery());
bot.action('admin_u_alert_no_photo', ctx => ctx.answerCbQuery('Bu kullanıcının sistemde yüklü fotoğrafı bulunmuyor.', { show_alert: true }));
bot.action('admin_u_alert_no_video', ctx => ctx.answerCbQuery('Bu kullanıcının sistemde yüklü videosu bulunmuyor.', { show_alert: true }));

// ADMİN: KULLANICILAR KOMUTU: /kullanicilar, /users, /uyeler
bot.command(['kullanicilar', 'users', 'uyeler'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    return renderAdminUsersList(ctx, 1);
});

// ==================== KULLANICILARA UYARI VE MESAJ GÖNDERME SİSTEMİ ====================
const WARN_PRESETS = {
    corrupt: 'Bozuk, açılmayan veya ses/görüntü kalitesi standart dışı medya gönderimi',
    duplicate: 'Kopya, mükerrer veya daha önce yüklenmiş medyaların tekrar gönderimi',
    wrong_cat: 'Yanlış veya alakasız kategori/sekmeye medya yükleme',
    rule_break: 'Topluluk kurallarına aykırı, sahte, yanıltıcı veya uygunsuz içerik'
};

const MSG_PRESETS = {
    quality: 'Lütfen gönderdiğiniz video ve fotoğrafların net, kaliteli ve tam olmasına özen gösteriniz.',
    category: 'Lütfen yüklediğiniz medyaların doğru sekmeye/kategoriye ait olduğundan emin olunuz.',
    duration: 'Lütfen çok kısa (1-2 saniyelik) veya kesik içerikler yerine tam videolar paylaşınız.',
    thanks: 'Gönderdiğiniz kaliteli ve özgün içerikler için teşekkür eder, iyi takaslar dileriz!'
};

// 1. UYARI MENÜSÜNÜ AÇ (Hazır şablonlar + özel yazma)
bot.action(/admin_warn_(\d+)_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    await ctx.answerCbQuery();
    const targetUserId = ctx.match[1];
    const mediaId = ctx.match[2];
    const targetUser = db.getUser(targetUserId) || { id: targetUserId, firstName: 'Kullanıcı', warnings: 0 };
    const curWarnings = targetUser.warnings || 0;

    const text = 
`⚠️ <b>KULLANICIYA UYARI GÖNDER</b>\n\n` +
`👤 <b>Kullanıcı:</b> <b>${escapeHtml(targetUser.firstName || 'Kullanıcı')}</b> (ID: <code>${targetUserId}</code>)\n` +
`⚠️ <b>Mevcut Uyarı Sayısı:</b> <b>${curWarnings} / 3</b>\n` +
(mediaId && mediaId !== 'profile' ? `🆔 <b>İlgili Medya:</b> <code>${mediaId}</code>\n` : '') +
`\n👇 <i>Aşağıdaki hazır uyarı nedenlerinden birini seçin veya özel bir neden yazın:</i>`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('📵 Bozuk / Kalitesiz Medya', `admin_sendwarn_${targetUserId}_${mediaId}_corrupt`)
        ],
        [
            Markup.button.callback('🚫 Kopya / Tekrar Eden Medya', `admin_sendwarn_${targetUserId}_${mediaId}_duplicate`)
        ],
        [
            Markup.button.callback('📂 Yanlış / Alakasız Sekme', `admin_sendwarn_${targetUserId}_${mediaId}_wrong_cat`)
        ],
        [
            Markup.button.callback('🔞 Kural Dışı / Uygunsuz İçerik', `admin_sendwarn_${targetUserId}_${mediaId}_rule_break`)
        ],
        [
            Markup.button.callback('✍️ Özel Uyarı Nedeni Yaz...', `admin_warn_custom_${targetUserId}_${mediaId}`)
        ],
        [
            Markup.button.callback('❌ İptal', mediaId !== 'profile' ? 'admin_cancel_action' : `admin_u_view_${targetUserId}`)
        ]
    ]);

    return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
});

// 2. HAZIR UYARI NEDENİNİ GÖNDER
bot.action(/admin_sendwarn_(\d+)_(.+)_(corrupt|duplicate|wrong_cat|rule_break)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    await ctx.answerCbQuery();
    const targetUserId = ctx.match[1];
    const mediaId = ctx.match[2];
    const reasonKey = ctx.match[3];
    const reasonText = WARN_PRESETS[reasonKey] || 'Kural ihlali';

    const newWarningCount = db.addWarning(targetUserId);
    const targetUser = db.getUser(targetUserId);

    const userWarningMsg = 
`⚠️ <b>YÖNETİCİ UYARISI ALDINIZ!</b>\n\n` +
`Gönderdiğiniz içerik sebebiyle yöneticimiz tarafından bir uyarı aldınız.\n\n` +
`📋 <b>Uyarı Nedeni:</b>\n<i>${escapeHtml(reasonText)}</i>\n\n` +
`⚠️ <b>Mevcut Uyarı Durumunuz:</b> <b>${newWarningCount} / 3</b>\n\n` +
`⛔ <i>Lütfen kurallara dikkat ediniz. 3 uyarı alan hesaplar sistemden otomatik olarak süresiz banlanmaktadır.</i>`;

    let isDelivered = false;
    try {
        await bot.telegram.sendMessage(targetUserId, userWarningMsg, { parse_mode: 'HTML' });
        isDelivered = true;
    } catch (err) {
        console.error('Uyarı mesajı iletilemedi:', err.message);
    }

    if (newWarningCount >= 3) {
        db.banUser(targetUserId, '3 kez yönetici uyarısı aldı (Kural ihlalleri)');
        try {
            await bot.telegram.sendMessage(
                targetUserId, 
                `🚫 <b>HESABINIZ ASKIYA ALINDI (BANLANDINIZ)</b>\n\n3 uyarı limitine ulaştığınız için bot erişiminiz süresiz olarak engellenmiştir.`, 
                { parse_mode: 'HTML' }
            );
        } catch {}
    }

    const resultText = 
`✅ <b>Uyarı Kullanıcıya Gönderildi!</b>\n\n` +
`👤 <b>Kullanıcı:</b> ${escapeHtml(targetUser?.firstName || 'Kullanıcı')} (<code>${targetUserId}</code>)\n` +
`⚠️ <b>Güncel Uyarı:</b> <b>${newWarningCount} / 3</b>\n` +
`📋 <b>İletilen Neden:</b> ${escapeHtml(reasonText)}\n` +
(newWarningCount >= 3 ? `🚫 <b>Kullanıcı 3 uyarı sınırını aştığı için OTOMATİK BANLANDI!</b>\n` : '') +
(isDelivered ? `📨 <i>Kullanıcıya başarıyla teslim edildi.</i>` : `⚠️ <i>Kullanıcı botu engellediği için Telegram mesajı iletilemedi ancak veritabanına uyarı işlendi.</i>`);

    const resultKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 Kullanıcı Profiline Git', `admin_u_view_${targetUserId}`)],
        [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
    ]);

    return safeEditOrReply(ctx, resultText, { parse_mode: 'HTML', ...resultKeyboard });
});

// 3. ÖZEL UYARI YAZMA MODUNU BAŞLAT
bot.action(/admin_warn_custom_(\d+)_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    await ctx.answerCbQuery();
    const targetUserId = ctx.match[1];
    const mediaId = ctx.match[2];
    const targetUser = db.getUser(targetUserId) || { firstName: 'Kullanıcı' };

    adminUserState[ctx.from.id] = {
        type: 'warn',
        targetUserId,
        mediaId
    };

    const text = 
`✍️ <b>ÖZEL UYARI NEDENİ YAZIN</b>\n\n` +
`👤 <b>Hedef Kullanıcı:</b> ${escapeHtml(targetUser.firstName || 'Kullanıcı')} (<code>${targetUserId}</code>)\n\n` +
`Lütfen bu kullanıcıya iletmek istediğiniz <b>uyarı nedenini / açıklamasını</b> sohbete mesaj olarak yazıp gönderin.\n\n` +
`<i>(İşlemi iptal etmek için /iptal yazabilirsiniz)</i>`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ İptal Et', `admin_warn_${targetUserId}_${mediaId}`)]
    ]);

    return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
});

// 4. MESAJ GÖNDERME SEÇİM MENÜSÜNÜ AÇ
bot.action(/admin_msg_(\d+)_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    await ctx.answerCbQuery();
    const targetUserId = ctx.match[1];
    const mediaId = ctx.match[2];
    const targetUser = db.getUser(targetUserId) || { id: targetUserId, firstName: 'Kullanıcı' };

    const text = 
`💬 <b>KULLANICIYA MESAJ GÖNDER</b>\n\n` +
`👤 <b>Hedef Kullanıcı:</b> <b>${escapeHtml(targetUser.firstName || 'Kullanıcı')}</b> (ID: <code>${targetUserId}</code>)\n` +
(mediaId && mediaId !== 'profile' ? `🆔 <b>İlgili Medya:</b> <code>${mediaId}</code>\n` : '') +
`\n👇 <i>Aşağıdaki hazır mesaj şablonlarından birini seçebilir veya kendiniz özel bir mesaj yazabilirsiniz:</i>`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('🎥 "Kaliteli/Net İçerik Yükleyiniz"', `admin_sendmsg_${targetUserId}_${mediaId}_quality`)
        ],
        [
            Markup.button.callback('📂 "Doğru Sekmeye Yükleyiniz"', `admin_sendmsg_${targetUserId}_${mediaId}_category`)
        ],
        [
            Markup.button.callback('⏱️ "Çok Kısa Video Yüklemeyiniz"', `admin_sendmsg_${targetUserId}_${mediaId}_duration`)
        ],
        [
            Markup.button.callback('✨ "Özgün İçerik İçin Teşekkürler"', `admin_sendmsg_${targetUserId}_${mediaId}_thanks`)
        ],
        [
            Markup.button.callback('✍️ Kendi Özel Mesajımı Yaz...', `admin_msg_custom_${targetUserId}_${mediaId}`)
        ],
        [
            Markup.button.callback('❌ İptal', mediaId !== 'profile' ? 'admin_cancel_action' : `admin_u_view_${targetUserId}`)
        ]
    ]);

    return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
});

// 5. HAZIR MESAJ ŞABLONUNU GÖNDER
bot.action(/admin_sendmsg_(\d+)_(.+)_(quality|category|duration|thanks)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    await ctx.answerCbQuery();
    const targetUserId = ctx.match[1];
    const mediaId = ctx.match[2];
    const msgKey = ctx.match[3];
    const templateText = MSG_PRESETS[msgKey] || 'İçerikleriniz hakkında bilgilendirme.';
    const targetUser = db.getUser(targetUserId);

    const userNoticeMsg = 
`📩 <b>YÖNETİCİDEN BİLGİLENDİRME MESAJI</b>\n\n` +
`Yöneticimiz tarafından gönderdiğiniz içeriklerle ilgili size özel bir mesaj iletildi:\n\n` +
`💬 <i>"${escapeHtml(templateText)}"</i>\n\n` +
`✨ <i>Göstermiş olduğunuz özen için teşekkür eder, keyifli paylaşımlar dileriz.</i>`;

    let isDelivered = false;
    try {
        await bot.telegram.sendMessage(targetUserId, userNoticeMsg, { parse_mode: 'HTML' });
        isDelivered = true;
    } catch (err) {
        console.error('Mesaj iletilemedi:', err.message);
    }

    const resultText = 
`✅ <b>Mesaj Kullanıcıya Başarıyla İletildi!</b>\n\n` +
`👤 <b>Alıcı:</b> ${escapeHtml(targetUser?.firstName || 'Kullanıcı')} (<code>${targetUserId}</code>)\n` +
`💬 <b>İletilen Mesaj:</b>\n<i>"${escapeHtml(templateText)}"</i>\n\n` +
(isDelivered ? `📨 <i>Mesaj kullanıcıya başarıyla teslim edildi.</i>` : `⚠️ <i>Kullanıcı botu engellediği için Telegram mesajı iletilemedi.</i>`);

    const resultKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 Kullanıcı Profiline Git', `admin_u_view_${targetUserId}`)],
        [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
    ]);

    return safeEditOrReply(ctx, resultText, { parse_mode: 'HTML', ...resultKeyboard });
});

// 6. ÖZEL MESAJ YAZMA MODUNU BAŞLAT
bot.action(/admin_msg_custom_(\d+)_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    await ctx.answerCbQuery();
    const targetUserId = ctx.match[1];
    const mediaId = ctx.match[2];
    const targetUser = db.getUser(targetUserId) || { firstName: 'Kullanıcı' };

    adminUserState[ctx.from.id] = {
        type: 'msg',
        targetUserId,
        mediaId
    };

    const text = 
`✍️ <b>KULLANICIYA ÖZEL MESAJ YAZIN</b>\n\n` +
`👤 <b>Alıcı:</b> ${escapeHtml(targetUser.firstName || 'Kullanıcı')} (<code>${targetUserId}</code>)\n\n` +
`Lütfen bu kullanıcıya iletmek istediğiniz <b>mesajı</b> sohbete yazıp gönderin.\n\n` +
`<i>(İşlemi iptal etmek için /iptal yazabilirsiniz)</i>`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ İptal Et', `admin_msg_${targetUserId}_${mediaId}`)]
    ]);

    return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
});

// Eylem iptal butonu
bot.action('admin_cancel_action', async (ctx) => {
    await ctx.answerCbQuery('İşlem iptal edildi.');
    if (ctx.callbackQuery.message) {
        return ctx.deleteMessage().catch(() => {});
    }
});

// DİREKT KOMUT: /uyari <kullanici_id> <neden>
bot.command('uyari', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    const targetId = parts[1];
    const reason = parts.slice(2).join(' ').trim();

    if (!targetId || !reason) {
        return ctx.reply('⚠️ Kullanım: <code>/uyari &lt;kullanici_id&gt; &lt;uyarı nedeni&gt;</code>\nÖrnek: <code>/uyari 123456789 Gönderdiğiniz video kurallara uymuyor.</code>', { parse_mode: 'HTML' });
    }

    const targetUser = db.getUser(targetId);
    if (!targetUser) {
        return ctx.reply(`❌ Kullanıcı (${targetId}) veritabanında bulunamadı.`);
    }

    const newWarnings = db.addWarning(targetId);
    const userWarningMsg = 
`⚠️ <b>YÖNETİCİ UYARISI ALDINIZ!</b>\n\n` +
`Gönderdiğiniz içerik sebebiyle yöneticimiz tarafından uyarıldınız.\n\n` +
`📋 <b>Uyarı Nedeni:</b>\n<i>${escapeHtml(reason)}</i>\n\n` +
`⚠️ <b>Mevcut Uyarı Durumunuz:</b> <b>${newWarnings} / 3</b>\n\n` +
`⛔ <i>Lütfen kurallara dikkat ediniz. 3 uyarı alan hesaplar otomatik olarak süresiz banlanmaktadır.</i>`;

    let delivered = false;
    try {
        await bot.telegram.sendMessage(targetId, userWarningMsg, { parse_mode: 'HTML' });
        delivered = true;
    } catch {}

    if (newWarnings >= 3) {
        db.banUser(targetId, '3 kez yönetici uyarısı aldı');
        try {
            await bot.telegram.sendMessage(targetId, `🚫 <b>Hesabınız 3 uyarı limitini aştığı için kalıcı olarak banlandı.</b>`, { parse_mode: 'HTML' });
        } catch {}
    }

    return ctx.reply(
        `✅ <b>Uyarı Kullanıcıya İletildi!</b>\n\n` +
        `👤 <b>Kullanıcı:</b> ${escapeHtml(targetUser.firstName || targetId)} (<code>${targetId}</code>)\n` +
        `⚠️ <b>Güncel Uyarı:</b> <b>${newWarnings} / 3</b>\n` +
        `📋 <b>Neden:</b> ${escapeHtml(reason)}\n` +
        (newWarnings >= 3 ? `🚫 <b>Kullanıcı 3 uyarı sınırını aştığı için OTOMATİK BANLANDI!</b>\n` : '') +
        (delivered ? `📨 <i>Kullanıcıya başarıyla teslim edildi.</i>` : `⚠️ <i>Kullanıcı botu engellediği için Telegram mesajı iletilemedi.</i>`),
        { parse_mode: 'HTML' }
    );
});

// DİREKT KOMUT: /mesaj <kullanici_id> <iletilecek_mesaj>
bot.command('mesaj', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    const targetId = parts[1];
    const messageText = parts.slice(2).join(' ').trim();

    if (!targetId || !messageText) {
        return ctx.reply('💬 Kullanım: <code>/mesaj &lt;kullanici_id&gt; &lt;iletilecek mesaj&gt;</code>\nÖrnek: <code>/mesaj 123456789 Merhaba, videolarınızı doğru sekmeye yükleyiniz.</code>', { parse_mode: 'HTML' });
    }

    const targetUser = db.getUser(targetId);
    if (!targetUser) {
        return ctx.reply(`❌ Kullanıcı (${targetId}) veritabanında bulunamadı.`);
    }

    const userNoticeMsg = 
`📩 <b>YÖNETİCİDEN BİLGİLENDİRME MESAJI</b>\n\n` +
`Yöneticimiz tarafından hesabınıza özel bir mesaj iletildi:\n\n` +
`💬 <i>"${escapeHtml(messageText)}"</i>\n\n` +
`✨ <i>Keyifli takaslar dileriz.</i>`;

    let delivered = false;
    try {
        await bot.telegram.sendMessage(targetId, userNoticeMsg, { parse_mode: 'HTML' });
        delivered = true;
    } catch {}

    return ctx.reply(
        `✅ <b>Mesaj Kullanıcıya Başarıyla İletildi!</b>\n\n` +
        `👤 <b>Alıcı:</b> ${escapeHtml(targetUser.firstName || targetId)} (<code>${targetId}</code>)\n` +
        `💬 <b>Mesajınız:</b>\n<i>"${escapeHtml(messageText)}"</i>\n\n` +
        (delivered ? `📨 <i>Kullanıcıya başarıyla teslim edildi.</i>` : `⚠️ <i>Kullanıcı botu engellediği için Telegram mesajı iletilemedi.</i>`),
        { parse_mode: 'HTML' }
    );
});

// ADMİN YARDIM MENÜSÜ: /admin — Şifre korumalı
bot.command('admin', async (ctx) => {
    const uid = String(ctx.from?.id);
    if (authenticatedAdmins.has(uid)) {
        return showAdminPanel(ctx);
    }
    if (!ADMIN_IDS.includes(uid)) {
        return ctx.reply('⛔ <b>Erişim Reddedildi.</b> Yönetici değilsiniz.', { parse_mode: 'HTML' });
    }
    pendingAdminAuth.add(uid);
    return ctx.reply(
        `🔐 <b>Yönetici Paneli — Kimlik Doğrulama</b>\n\n` +
        `Yönetici paneline erişmek için lütfen <b>yönetici şifresini</b> girin:\n\n` +
        `<i>İptal için /iptal yazabilirsiniz.</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ İptal', 'admin_cancel_auth')]
            ])
        }
    );
});

// Callback üzerinden şifre isteme / panel açma
bot.action(['admin_panel_open', 'admin_panel_auth_request'], async (ctx) => {
    await ctx.answerCbQuery();
    const uid = String(ctx.from?.id);
    // Sadece şifre girip doğrulanmış adminler panele girer (ADMIN_IDS'de olsa bile şifre şarttır)
    if (authenticatedAdmins.has(uid)) {
        return showAdminPanel(ctx);
    }
    // ADMIN_IDS'de değilse hiç erişim yok
    if (!ADMIN_IDS.includes(uid)) {
        return ctx.reply('⛔ <b>Erişim Reddedildi.</b> Yönetici değilsiniz.', { parse_mode: 'HTML' }).catch(() => {});
    }
    pendingAdminAuth.add(uid);
    return ctx.reply(
        `🔐 <b>Yönetici Paneli — Kimlik Doğrulama</b>\n\n` +
        `Yönetici paneline erişmek için lütfen <b>yönetici şifresini</b> girin:\n\n` +
        `<i>İptal için /iptal yazabilirsiniz.</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ İptal', 'admin_cancel_auth')]
            ])
        }
    );
});

bot.action('admin_cancel_auth', async (ctx) => {
    pendingAdminAuth.delete(String(ctx.from?.id));
    await ctx.answerCbQuery('Giriş iptal edildi.');
    return ctx.reply('❌ <b>Yönetici girişi iptal edildi.</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
        ])
    });
});

bot.action('admin_logout', async (ctx) => {
    authenticatedAdmins.delete(String(ctx.from?.id));
    saveAuthenticatedAdmins(authenticatedAdmins);
    await ctx.answerCbQuery('Yönetici oturumu kapatıldı.');
    return safeEditOrReply(ctx, '🚪 <b>Yönetici oturumunuz kapatıldı. Normal üye moduna dönüldü.</b>\n\nTekrar yönetici paneline girmek için şifrenizle giriş yapabilirsiniz.', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
        ])
    });
});

// Admin panelini gösteren yardımcı fonksiyon
function showAdminPanel(ctx) {
    const stats = db.getStats();
    const bannedUsers = db.getBannedUsers();
    const text =
`👑 <b>Yönetici Paneli</b>

📊 <b>Sistem Havuzu:</b> 📸 <b>${stats.approvedPhotos} Resim</b> | 🎥 <b>${stats.approvedVideos} Video</b>
⏳ <b>Onay Bekleyen:</b> <b>${stats.pendingMedia} Medya</b>
🚫 <b>Banlı Kullanıcı:</b> <b>${bannedUsers.length}</b>

👇 <b>Tüm yönetici işlemleri aşağıdadır:</b>`;

    return ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Bekleyen Medyaları Toplu Onayla', 'admin_bulk_approve')],
            [
                Markup.button.callback('👥 Kullanıcılar & İçerikler', 'admin_users_1'),
                Markup.button.callback('⭐ Yıldız & Gelir Raporu', 'admin_stars_report')
            ],
            [
                Markup.button.callback('🗑️ Benzer Medyaları Sil (Resim & Video)', 'admin_dup_panel'),
                Markup.button.callback('🚫 Banlı Kullanıcılar', 'admin_manage_bans')
            ],
            [Markup.button.callback('⚙️ Sekme / Kategori İsimlerini Düzenle', 'admin_manage_cats')],
            [
                Markup.button.callback('🚪 Yönetici Çıkışı Yap', 'admin_logout'),
                Markup.button.callback('🏠 Ana Menü', 'main_menu')
            ]
        ])
    });
}


// ADMİN: BENZER & KOPYA MEDYALARI YÖNETİM PANELİ (Resim & Video)
async function renderAdminDupPanel(ctx) {
    if (!isAdminUser(ctx.from?.id)) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Bu panel sadece yöneticiye özeldir.');
        return;
    }

    const dupReport = db.findDuplicateMediaList(null);
    const photoDups = dupReport.duplicates.filter(d => d.item.type === 'photo').length;
    const videoDups = dupReport.duplicates.filter(d => d.item.type === 'video').length;
    const stats = db.getStats();

    if (dupReport.duplicateCount === 0) {
        const cleanText = 
`🗑️ <b>Benzer & Kopya Medyaları Yönetim Paneli</b>\n\n` +
`✅ <b>Harika! Sistemde şu anda hiç benzer veya kopya resim veya video bulunmuyor.</b>\n\n` +
`📊 <b>Havuz Durumu:</b> 📸 <b>${stats.approvedPhotos} Resim</b> | 🎥 <b>${stats.approvedVideos} Video</b>\n` +
`✨ <i>Havuzdaki tüm resim ve videolar %100 özgün, benzersiz ve onaylıdır. Mükerrer kayıt yoktur.</i>`;

        return safeEditOrReply(ctx, cleanText, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Yeniden Tara', 'admin_dup_panel')],
                [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
            ])
        });
    }

    const text = 
`🗑️ <b>Benzer & Kopya Medyaları Yönetim Paneli</b>\n\n` +
`⚠️ <b>Sistemde ${dupReport.duplicateCount} adet benzer / kopya medya tespit edildi!</b>\n` +
`📸 <b>Benzer Resim:</b> <b>${photoDups} adet</b>\n` +
`🎥 <b>Benzer Video:</b> <b>${videoDups} adet</b>\n` +
`📊 <b>Toplam Havuz:</b> 📸 <b>${stats.approvedPhotos} Resim</b> | 🎥 <b>${stats.approvedVideos} Video</b>\n\n` +
`Aşağıdaki seçeneklerden birini seçerek temizleyebilirsiniz:\n\n` +
`• <b>Tümünü Sil:</b> Bulunan ${dupReport.duplicateCount} adet benzer medyanın (resim ve video) tümünü tek tıkla havuzdan siler.\n` +
`• <b>Tek Tek İncele:</b> Benzer resim veya videoları ekranda görerek istediğinizi tek tek silebilirsiniz.`;

    const buttons = [
        [
            Markup.button.callback(`🗑️ Tüm Benzerleri Şimdi Sil (${dupReport.duplicateCount} Adet)`, 'admin_confirm_clean_dups_all')
        ]
    ];

    if (photoDups > 0 && videoDups > 0) {
        buttons.push([
            Markup.button.callback(`📸 Sadece Resimleri Sil (${photoDups})`, 'admin_confirm_clean_dups_photo'),
            Markup.button.callback(`🎥 Sadece Videoları Sil (${videoDups})`, 'admin_confirm_clean_dups_video')
        ]);
    }

    buttons.push(
        [
            Markup.button.callback('🔍 Benzer Medyaları Tek Tek İncele', 'admin_browse_dups_0')
        ],
        [
            Markup.button.callback('🔄 Listeyi Yenile', 'admin_dup_panel'),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    );

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
}

// ADMİN: BENZER MEDYA PANELİ BUTON EYLEMİ
bot.action('admin_dup_panel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return renderAdminDupPanel(ctx);
});

// ADMİN: BENZER MEDYALARI ONAYLI TOPLU SİLME (Tümü / Sadece Resim / Sadece Video)
bot.action(['admin_confirm_clean_dups', 'admin_confirm_clean_dups_all', 'admin_confirm_clean_dups_photo', 'admin_confirm_clean_dups_video'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }

    const actionData = ctx.callbackQuery?.data || '';
    let targetType = null;
    if (actionData.endsWith('_photo')) targetType = 'photo';
    else if (actionData.endsWith('_video')) targetType = 'video';

    const res = db.cleanDuplicateMedia(targetType);
    await ctx.answerCbQuery(`🧹 ${res.deletedCount} adet benzer medya başarıyla silindi!`, { show_alert: true });

    const stats = db.getStats();
    const resultText = 
`🎉 <b>BENZER MEDYALAR TEMİZLENDİ!</b>\n\n` +
`🗑️ <b>Silinen Medya Sayısı:</b> <b>${res.deletedCount} adet</b>\n` +
`📸 <b>Silinen Resim:</b> ${res.deletedPhotos} adet\n` +
`🎥 <b>Silinen Video:</b> ${res.deletedVideos} adet\n\n` +
`✅ <b>Havuzda Kalan Benzersiz İçerikler:</b>\n` +
`📸 <b>${stats.approvedPhotos} Benzersiz Resim</b>\n` +
`🎥 <b>${stats.approvedVideos} Benzersiz Video</b>\n\n` +
`<i>Artık sistemdeki tüm medyalar %100 tektir ve mükerrer kayıt kalmamıştır.</i>`;

    return safeEditOrReply(ctx, resultText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🗑️ Benzer Medyalar Paneli', 'admin_dup_panel')],
            [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
        ])
    });
});

// ADMİN: BENZER MEDYALARI TEK TEK İNCELEME & GEZİNTİ EKRANI (Resim & Video)
async function renderBrowseDuplicateVideos(ctx, index = 0) {
    if (!isAdminUser(ctx.from?.id)) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
        return;
    }

    const dupReport = db.findDuplicateMediaList(null);
    if (dupReport.duplicateCount === 0) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('İncelenecek benzer medya kalmadı.', { show_alert: true });
        return renderAdminDupPanel(ctx);
    }

    let idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx >= dupReport.duplicates.length) idx = dupReport.duplicates.length - 1;

    const dupEntry = dupReport.duplicates[idx];
    const item = dupEntry.item;
    const orig = dupEntry.originalItem;
    const cat = db.getCategory(item.categoryId);
    const uploader = db.getUser(item.uploadedBy);
    const typeLabel = item.type === 'video' ? '🎥 Video' : '📸 Resim';

    const caption = 
`⚠️ <b>BENZER / KOPYA ${typeLabel.toUpperCase()} (${idx + 1} / ${dupReport.duplicateCount})</b>\n\n` +
`👤 <b>Yükleyen:</b> <b>${escapeHtml(uploader?.firstName || 'Kullanıcı')}</b> (<code>${item.uploadedBy}</code>)\n` +
`📁 <b>Sekme:</b> [${cat?.key || '?'}] <b>${escapeHtml(cat?.name || 'Bilinmiyor')}</b>\n` +
`🆔 <b>Medya ID:</b> <code>${item.id}</code>\n` +
(orig ? `📌 <b>Eşleşen Orijinal ID:</b> <code>${orig.id}</code>\n` : '') +
`⚠️ <b>Benzerlik Sebebi:</b> <i>${escapeHtml(dupEntry.reason)}</i>\n\n` +
`<i>Bu medyayı havuzdan silmek için aşağıdaki butona basabilirsiniz:</i>`;

    const navRow = [];
    if (idx > 0) {
        navRow.push(Markup.button.callback('⬅️ Önceki', `admin_browse_dups_${idx - 1}`));
    }
    navRow.push(Markup.button.callback(`📌 ${idx + 1} / ${dupReport.duplicateCount}`, 'admin_u_noop'));
    if (idx < dupReport.duplicates.length - 1) {
        navRow.push(Markup.button.callback('Sonraki ➡️', `admin_browse_dups_${idx + 1}`));
    }

    const buttons = [
        navRow,
        [
            Markup.button.callback(`🗑️ Bu Benzer ${item.type === 'video' ? 'Videoyu' : 'Resmi'} Sil`, `admin_del_dup_${item.id}__${idx}`),
            Markup.button.callback('🧹 Tümünü Toplu Sil', 'admin_confirm_clean_dups_all')
        ],
        [
            Markup.button.callback('⬅️ Benzerler Paneline Dön', 'admin_dup_panel'),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ];

    const keyboard = Markup.inlineKeyboard(buttons);

    try {
        await ctx.editMessageMedia(
            {
                type: item.type === 'video' ? 'video' : 'photo',
                media: item.fileId,
                caption: caption,
                parse_mode: 'HTML'
            },
            keyboard
        );
    } catch (e) {
        if (item.type === 'video') {
            await ctx.replyWithVideo(item.fileId, {
                caption: caption,
                parse_mode: 'HTML',
                ...keyboard
            }).catch(() => {});
        } else {
            await ctx.replyWithPhoto(item.fileId, {
                caption: caption,
                parse_mode: 'HTML',
                ...keyboard
            }).catch(() => {});
        }
    }
}

// Benzer medyalar gezinti aksiyonu
bot.action(/admin_browse_dups_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const idx = parseInt(ctx.match[1], 10);
    return renderBrowseDuplicateVideos(ctx, idx);
});

// Tek benzer medyayı silme butonu
bot.action(/admin_del_dup_(.+)__(\d+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.');
    }
    const mediaId = ctx.match[1];
    const idx = parseInt(ctx.match[2], 10);

    db.deleteMedia(mediaId);
    await ctx.answerCbQuery('🗑️ Benzer medya havuzdan silindi!', { show_alert: true });

    return renderBrowseDuplicateVideos(ctx, idx);
});

// ADMİN: BENZER MEDYALAR KOMUTU: /benzervideolar, /benzersil, /benzerresimler, /kopyatemizle
bot.command(['benzervideolar', 'benzersil', 'benzervideolarisil', 'benzerresimler', 'kopyatemizle', 'kopyalar', 'aynilarisil'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    return renderAdminDupPanel(ctx);
});

// Admin Komutu: /stats
bot.command('stats', (ctx) => {
    const stats = db.getStats();
    const text = 
`📊 <b>Bot & Sistem Havuz İstatistikleri</b>

👥 Toplam Kullanıcı: <b>${stats.totalUsers}</b>
👑 VIP Kullanıcı Sayısı: <b>${stats.vipUsers}</b>

📸 <b>Onaylı Resim Havuzu:</b> <code>${stats.approvedPhotos}</code>
🎥 <b>Onaylı Video Havuzu:</b> <code>${stats.approvedVideos}</code>
⏳ <b>Onay Bekleyen Medyalar:</b> <code>${stats.pendingMedia}</code>
❌ Reddedilen Medyalar: <b>${stats.rejectedMedia}</b>`;

    return ctx.reply(text, { parse_mode: 'HTML' });
});

bot.catch((err, ctx) => {
    const desc = err?.description || err?.message || '';
    if (desc.includes('message is not modified') || desc.includes('query is too old') || desc.includes('message to edit not found')) {
        return;
    }
    console.error(`🛡️ [Bot Yakalanan Hata]:`, desc);
});

async function main() {
    try {
        console.log('🤖 Telegram Medya Takas Botu başlatılıyor...');
        const botInfo = await bot.telegram.getMe();
        console.log(`✅ @${botInfo.username} (${botInfo.first_name}) olarak Telegram'a bağlanıldı!`);
        console.log(`👑 Yönetici Admin ID: ${ADMIN_ID}`);

        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Botu Başlat / Ana Menü' },
            { command: 'admin', description: 'Yönetici Paneli (Sadece Admin)' },
            { command: 'kullanicilar', description: 'Kullanıcılar & İçerikler (Admin)' },
            { command: 'benzersil', description: 'Benzer Videoları Sil (Admin)' },
            { command: 'kategoriler', description: 'Sekmeleri / Kategorileri Yönet' },
            { command: 'kategoriadi', description: 'Sekme Adını Değiştir (Örn: /kategoriadi A Doğa)' },
            { command: 'topluonayla', description: 'Tüm Bekleyenleri Toplu Onayla' },
            { command: 'ban', description: 'Kullanıcıyı Banla' },
            { command: 'unban', description: 'Kullanıcı Banını Kaldır' },
            { command: 'bantemizle', description: 'Tüm Banları Temizle' },
            { command: 'banlist', description: 'Banlı Kullanıcılar' },
            { command: 'stats', description: 'Havuz İstatistikleri' },
            { command: 'yildizsync', description: 'Yıldız Ödemelerini Tara & Eşitle (Admin)' }
        ]).catch((e) => console.warn('Komutlar ayarlanamadı:', e.message));

        console.log('🚀 Bot başarıyla aktif ve mesajları dinliyor!');

        // Başlangıçta ve her 30 saniyede bir Telegram Yıldız ödemelerini senkronize et
        await syncStarTransactions();
        setInterval(syncStarTransactions, 30000);

        // Her 1 saatte bir (60 dakika) otomatik Yıldız Paket Satış Bildirimi gönder
        setInterval(() => {
            sendHourlyStarPromo(false).catch((err) => console.error('Saatlik promosyon hatası:', err.message));
        }, 60 * 60 * 1000);

        await bot.launch({
            allowedUpdates: [
                'message',
                'edited_message',
                'callback_query',
                'inline_query',
                'pre_checkout_query',
                'shipping_query'
            ]
        });
    } catch (err) {
        console.error('❌ Bot başlatılamadı:', err);
    }
}

// ==================== YILDIZ SATIŞ VE PROMOSYON SİSTEMİ ====================

// Promosyon Bildirimi Klavyesi (Doğrudan Tek Tıkla Satın Alma Butonları)
function getStarPromoKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('⚡ 1 Yıldız = 1 Video Al', 'buy_vid_1'),
            Markup.button.callback('⚡ 1 Yıldız = 1 Foto Al', 'buy_pho_1')
        ],
        [
            Markup.button.callback('🔥 Avantajlı Kombo Paketler', 'pkg_tab_combo'),
            Markup.button.callback('👑 Sınırsız VIP Üyelik', 'pkg_tab_vip')
        ],
        [
            Markup.button.callback('⭐ Tüm Paketleri İncele', 'menu_packages'),
            Markup.button.callback('🏠 Ana Menü', 'main_menu')
        ]
    ]);
}

// Toplu Promosyon Bildirimi Gönderme (Rate-limit korumalı ve güvenli)
async function sendHourlyStarPromo(triggeredByAdmin = false) {
    const settings = db.getSettings();
    if (!triggeredByAdmin && settings.hourlyPromoEnabled === false) {
        console.log('Saatlik promosyon bildirimi devre dışı bırakılmış, atlandı.');
        return { sent: 0, failed: 0, skipped: true };
    }

    const allUsers = db.getAllUserIds();
    const promoText = 
`⭐ <b>ÖZEL FIRSAT: KREDİ & VIP YILDIZ PAKETLERİ!</b> ⭐

Sistemimizdeki binlerce özel ve yeni resim/videoya beklemeden anında erişmek için avantajlı Yıldız paketlerini kaçırmayın!

🎥 <b>1 Yıldız:</b> 1 Video Kredisi
📸 <b>1 Yıldız:</b> 1 Fotoğraf Kredisi
🔥 <b>18 Yıldız:</b> 10 Video + 10 Fotoğraf Paketi
👑 <b>100 Yıldız:</b> 1 Günlük SINIRSIZ VIP Üyelik

👇 <i>Aşağıdaki butonlara dokunarak tek tıkla hesabınıza kredi yükleyebilirsiniz:</i>`;

    const promoKeyboard = getStarPromoKeyboard();
    let sentCount = 0;
    let failCount = 0;

    console.log(`📢 [SAATLİK YILDIZ PROMOSYONU] ${allUsers.length} kullanıcıya iletiliyor...`);

    for (const uid of allUsers) {
        if (db.isUserBanned(uid)) continue;

        try {
            await bot.telegram.sendMessage(uid, promoText, {
                parse_mode: 'HTML',
                ...promoKeyboard
            });
            sentCount++;
        } catch (err) {
            failCount++;
        }

        // Telegram 429 Too Many Requests önlemek için her 20 mesajda bir 500ms bekle
        if ((sentCount + failCount) % 20 === 0) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    db.updateSettings({
        lastPromoTime: Date.now(),
        lastPromoSent: sentCount
    });

    console.log(`✅ [SAATLİK PROMOSYON TAMAMLANDI] Gönderilen: ${sentCount}, İletilemeyen: ${failCount}`);
    return { sent: sentCount, failed: failCount, skipped: false };
}

// ADMİN: TELEGRAM YILDIZLARI VE GELİR YÖNETİM PANELİ
async function renderAdminStarsReport(ctx) {
    if (!isAdminUser(ctx.from?.id)) {
        if (ctx.answerCbQuery) await ctx.answerCbQuery('Bu bilgi sadece yöneticilere açıktır.');
        return;
    }
    if (ctx.answerCbQuery) await ctx.answerCbQuery().catch(() => {});

    try {
        const res = await bot.telegram.callApi('getStarTransactions', { limit: 50 }).catch(() => null);
        const txs = res?.transactions || [];
        const settings = db.getSettings();

        let totalStars = 0;
        let totalCount = 0;
        const rows = [];

        for (const tx of txs) {
            if (tx.amount > 0) {
                totalStars += tx.amount;
                totalCount++;
                const u = tx.source?.user;
                const payload = tx.source?.invoice_payload || 'Belirtilmedi';
                const dateStr = new Date(tx.date * 1000).toLocaleString('tr-TR');
                rows.push(
                    `⭐ <b>${tx.amount} Yıldız</b> | 👤 ${escapeHtml(u?.first_name || 'Kullanıcı')} (<code>${u?.id || ''}</code>)\n` +
                    `📦 <i>Paket:</i> <code>${payload}</code> | 📅 <i>${dateStr}</i>`
                );
            }
        }

        const promoStatusText = settings.hourlyPromoEnabled !== false 
            ? '🟢 <b>AKTİF</b> (Her 1 saatte bir otomatik gönderiliyor)' 
            : '🔴 <b>DEVRE DIŞI</b> (Durduruldu)';

        const lastPromoStr = settings.lastPromoTime 
            ? new Date(settings.lastPromoTime).toLocaleString('tr-TR') 
            : 'Henüz gönderilmedi';

        const text = 
`⭐ <b>TELEGRAM YILDIZ VE GELİR YÖNETİM PANELİ</b>

💰 <b>Toplam Kazanılan:</b> <b>${totalStars} Telegram Yıldızı ⭐</b>
📦 <b>Toplam Başarılı Satış:</b> <b>${totalCount} Adet</b>

━━━━━━━━━━━━━━━━━━━━
⏰ <b>Saatlik Yıldız Satış Bildirimi:</b>
• <b>Durum:</b> ${promoStatusText}
• <b>Son Gönderim:</b> <code>${lastPromoStr}</code>
• <b>Son Ulaşan Kişi:</b> <code>${settings.lastPromoSent || 0}</code> kullanıcı

━━━━━━━━━━━━━━━━━━━━
${rows.length > 0 ? `📋 <b>Yapılan İşlemler (Son Satışlar):</b>\n\n${rows.slice(0, 10).join('\n\n')}` : '<i>Henüz tamamlanan bir yıldız satışı bulunmuyor.</i>'}

━━━━━━━━━━━━━━━━━━━━
💼 <b>Yıldızları Çekme (Fragment):</b>
Telegram politikası gereğince yıldızlar işlemden 21 gün sonra <b>fragment.com/stars</b> üzerinden TON kripto parasına dönüştürülüp çekilebilir.`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('📢 Şimdi Promosyon Gönder', 'admin_promo_send_now'),
                Markup.button.callback(settings.hourlyPromoEnabled !== false ? '⏸️ Bildirimi Durdur' : '▶️ Bildirimi Başlat', 'admin_promo_toggle')
            ],
            [
                Markup.button.callback('🔄 Yenile & Senkronize Et', 'admin_stars_sync'),
                Markup.button.callback('🛒 Paket Marketi', 'menu_packages')
            ],
            [
                Markup.button.callback('👑 Yönetici Paneli', 'admin_panel_open'),
                Markup.button.callback('🏠 Ana Menü', 'main_menu')
            ]
        ]);

        return safeEditOrReply(ctx, text, { parse_mode: 'HTML', ...keyboard });
    } catch (err) {
        return ctx.reply('❌ Yıldız paneli açılırken hata oluştu: ' + err.message);
    }
}

bot.command(['yildizlar', 'yildizpaneli', 'yildizrapor', 'gelir', 'stars'], renderAdminStarsReport);
bot.action('admin_stars_report', renderAdminStarsReport);

bot.action('admin_stars_sync', async (ctx) => {
    await ctx.answerCbQuery('Yıldızlar senkronize ediliyor...');
    await syncStarTransactions();
    return renderAdminStarsReport(ctx);
});

bot.action('admin_promo_send_now', async (ctx) => {
    await ctx.answerCbQuery('📢 Promosyon bildirimi gönderiliyor...');
    await ctx.reply('⏳ <b>Tüm kullanıcılara Yıldız Promosyon bildirimi gönderiliyor...</b>', { parse_mode: 'HTML' });
    const res = await sendHourlyStarPromo(true);
    await ctx.reply(`✅ <b>Promosyon tamamlandı!</b>\nİletilen: <b>${res.sent}</b> kullanıcı | Ulaşılamayan: <b>${res.failed}</b>`, { parse_mode: 'HTML' });
    return renderAdminStarsReport(ctx);
});

bot.action('admin_promo_toggle', async (ctx) => {
    const settings = db.getSettings();
    const newState = settings.hourlyPromoEnabled === false ? true : false;
    db.updateSettings({ hourlyPromoEnabled: newState });
    await ctx.answerCbQuery(newState ? '🟢 Saatlik bildirim AKTİF edildi!' : '🔴 Saatlik bildirim DURDURULDU!');
    return renderAdminStarsReport(ctx);
});

bot.command(['yildizsync', 'yildizsenkronize'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    await ctx.reply('⏳ <b>Telegram Yıldız Ödemeleri Taranıyor...</b>', { parse_mode: 'HTML' });
    await syncStarTransactions();
    await ctx.reply('✅ <b>Yıldız ödemeleri başarıyla senkronize edildi ve kontrol edildi!</b>', { parse_mode: 'HTML' });
});

bot.command(['yildizduyuru', 'yildizpromotetikle'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    await ctx.reply('⏳ <b>Yıldız paket promosyonu kullanıcılara iletiliyor...</b>', { parse_mode: 'HTML' });
    const res = await sendHourlyStarPromo(true);
    await ctx.reply(`✅ <b>Gönderim tamamlandı!</b>\nBaşarılı: <b>${res.sent}</b> | Hata: <b>${res.failed}</b>`, { parse_mode: 'HTML' });
});



// ==========================================
// 📢 DUYURU PANOSU (ANNOUNCEMENTS) İŞLEMLERİ
// ==========================================

async function renderAnnouncements(ctx, page = 0) {
    if (ctx.answerCbQuery) await ctx.answerCbQuery().catch(() => {});
    const allAnns = db.getAnnouncements();
    const pageSize = 3;
    const totalPages = Math.max(1, Math.ceil(allAnns.length / pageSize));
    const p = Math.max(0, Math.min(page, totalPages - 1));
    const slice = allAnns.slice(p * pageSize, p * pageSize + pageSize);
    const isAdmin = isAdminUser(ctx.from?.id);

    let text = `📢 <b>DUYURU PANOSU</b>\n`;
    text += `<i>Toplam ${allAnns.length} duyuru — Sayfa ${p + 1}/${totalPages}</i>\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;

    if (slice.length === 0) {
        text += `\n<i>Henüz hiç duyuru yayınlanmamış.</i>\n`;
        text += `\n💡 <i>Yeni içerik duyuruları, kampanyalar ve özel fırsatlar burada paylaşılır.</i>`;
    } else {
        slice.forEach((ann, idx) => {
            const date = new Date(ann.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
            text += `\n${ann.pinned ? '📌 ' : ''}📣 <b>${escapeHtml(ann.title)}</b>\n`;
            text += `<i>${date}</i>\n`;
            text += `${escapeHtml(ann.body)}\n`;
            if (idx < slice.length - 1) text += `━━━━━━━━━━━━━━━━━━━━\n`;
        });
    }

    const buttons = [];

    // Sayfa navigasyonu
    const navRow = [];
    if (p > 0) navRow.push(Markup.button.callback('⬅️ Önceki', `ann_page_${p - 1}`));
    if (p < totalPages - 1) navRow.push(Markup.button.callback('Sonraki ➡️', `ann_page_${p + 1}`));
    if (navRow.length > 0) buttons.push(navRow);

    // Admin silme butonları
    if (isAdmin && slice.length > 0) {
        slice.forEach(ann => {
            const shortTitle = ann.title.length > 20 ? ann.title.slice(0, 20) + '…' : ann.title;
            buttons.push([Markup.button.callback(`🗑️ Sil: "${shortTitle}"`, `ann_del_${ann.id}`)]);
        });
        buttons.push([Markup.button.callback('➕ Yeni Duyuru Ekle', 'ann_new')]);
    }

    buttons.push([
        Markup.button.callback('💎 Davet Et & Kazan', 'earn_credits'),
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    return safeEditOrReply(ctx, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
}

bot.action('announcements', (ctx) => renderAnnouncements(ctx, 0));
bot.command(['duyurular', 'duyuru', 'pano'], (ctx) => renderAnnouncements(ctx, 0));

bot.action(/ann_page_(\d+)/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10) || 0;
    return renderAnnouncements(ctx, page);
});

bot.action(/ann_del_(.+)/, async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.', { show_alert: true });
    }
    const annId = ctx.match[1];
    const deleted = db.deleteAnnouncement(annId);
    await ctx.answerCbQuery(deleted ? '🗑️ Duyuru silindi.' : '❌ Duyuru bulunamadı.');
    return renderAnnouncements(ctx, 0);
});

// Admin: Yeni duyuru ekleme - bekleme modu
const pendingAnnouncements = new Map(); // adminId -> { step, title, body }

bot.action('ann_new', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) {
        return ctx.answerCbQuery('Bu işlem sadece yöneticiye özeldir.', { show_alert: true });
    }
    await ctx.answerCbQuery();
    pendingAnnouncements.set(String(ctx.from.id), { step: 'title' });
    return safeEditOrReply(ctx,
        `📢 <b>Yeni Duyuru Oluştur</b>\n\nAdım 1/2: Duyurunun <b>başlığını</b> yazın:\n\n<i>(İptal için /iptal komutunu kullanın)</i>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ İptal', 'announcements')]]) }
    );
});

bot.command('iptal', async (ctx) => {
    pendingAnnouncements.delete(String(ctx.from?.id));
    return ctx.reply('✅ İşlem iptal edildi.', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Ana Menü', 'main_menu')]]) });
});

// Admin duyuru komutları (tek satırda): /duyuruekle Başlık | İçerik
bot.command(['duyuruekle', 'yeniduyuru'], async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const text = ctx.message.text.split(' ').slice(1).join(' ');
    const parts = text.split('|');
    if (parts.length < 2) {
        return ctx.reply(
            `❌ <b>Kullanım:</b> <code>/duyuruekle Başlık | İçerik metni buraya</code>\n\nÖrnek:\n<code>/duyuruekle 🎉 Yeni Özellik! | Artık davet başına 2+2 kredi kazanıyorsunuz!</code>`,
            { parse_mode: 'HTML' }
        );
    }
    const title = parts[0].trim();
    const body = parts.slice(1).join('|').trim();
    const ann = db.addAnnouncement(title, body, ctx.from.id);

    ctx.reply(
        `✅ <b>Duyuru başarıyla yayınlandı!</b>\n\n📣 <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}\n\n<i>Duyuru panosu güncellendi.</i>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('📢 Panoyu Görüntüle', 'announcements')]]) }
    );

    // Tüm kullanıcılara bildirim gönder (opsiyonel - büyük kitlelerde dikkatli kullanın)
    const parts2 = ctx.message.text.split(' ');
    if (parts2[0] === '/yeniduyuru') {
        const userIds = db.getAllUserIds();
        let sent = 0, failed = 0;
        for (const uid of userIds) {
            if (isAdminUser(uid)) continue;
            try {
                await bot.telegram.sendMessage(uid,
                    `📢 <b>YENİ DUYURU!</b>\n\n📣 <b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`,
                    {
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([[Markup.button.callback('📢 Duyuru Panosunu Aç', 'announcements')]])
                    }
                );
                sent++;
                await new Promise(r => setTimeout(r, 35)); // Rate limit önlemi
            } catch { failed++; }
        }
        ctx.reply(`📨 <b>Toplu bildirim tamamlandı!</b>\n✅ Gönderilen: <b>${sent}</b> | ❌ Ulaşılamayan: <b>${failed}</b>`, { parse_mode: 'HTML' });
    }
});

bot.command('duyurusil', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply('Kullanım: /duyurusil <duyuru_id>');
    const annId = parts[1].trim();
    const deleted = db.deleteAnnouncement(annId);
    ctx.reply(deleted ? `✅ Duyuru silindi: <code>${annId}</code>` : `❌ Duyuru bulunamadı: <code>${annId}</code>`, { parse_mode: 'HTML' });
});

// ==========================================
// 🎡 ŞANS ÇARKI (LUCKY WHEEL) İŞLEMLERİ
// ==========================================

async function renderWheelMenu(ctx) {
    if (ctx.answerCbQuery) await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from?.id;
    if (!userId) return;
    const user = db.getUser(userId) || db.getOrCreateUser(ctx.from);
    const spins = user.wheelSpins || 0;
    const vip = db.isUserVip(userId);

    const wheelText = 
`🎡 <b>ŞANS ÇARKI (LUCKY WHEEL)</b> 🎡\n\n` +
`🎯 <b>1 İLE 10 ARASI VİDEO KREDİSİ KAZANMA ŞANSI!</b>\n` +
`Çarkı her çevirdiğinizde anında rastgele <b>1 ile 10 adet Video Kredisi</b> kazanırsınız!\n\n` +
`🎟️ <b>Mevcut Çark Hakkınız:</b> <b>${spins} adet</b>\n` +
`👑 <b>VIP Durumu:</b> ${vip.isVip ? (vip.isUnlimited ? '👑 Sınırsız VIP' : `👑 VIP (${vip.remainingHours} saat)`) : 'Standart'}\n\n` +
`━━━━━━━━━━━━━━━━━━━━\n` +
`💡 <b>Çark Hakkı Nasıl Kazanılır?</b>\n` +
`• 🌟 <b>VIP Üyelik Alanlara:</b> 100+ Yıldız VIP paketlerinde <b>+1 Çark Hakkı</b> hediye!\n` +
`• ⭐ <b>100 Yıldız ve Üzeri Harcayanlara:</b> Her 100 Yıldız için anında <b>+1 Çark Çevirme Hakkı</b>!\n` +
`━━━━━━━━━━━━━━━━━━━━`;

    const buttons = [];
    if (spins > 0) {
        buttons.push([Markup.button.callback(`🎰 Çarkı Çevir! (${spins} Hak Var)`, 'wheel_spin')]);
    } else {
        buttons.push([Markup.button.callback('🌟 1 Günlük VIP Al (+1 Çark Hakkı 🎡)', 'buy_vip_1')]);
        buttons.push([Markup.button.callback('⭐ 100+ Yıldız Paketlerini İncele', 'menu_packages')]);
    }
    buttons.push([
        Markup.button.callback('👤 Profilim', 'my_profile'),
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    return safeEditOrReply(ctx, wheelText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
}

bot.command(['cark', 'carkifelek', 'sanscarki'], renderWheelMenu);
bot.action('wheel_menu', renderWheelMenu);

bot.action('wheel_spin', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const spinRes = db.useWheelSpin(userId);
    if (!spinRes.success) {
        await ctx.answerCbQuery('❌ Çevirme hakkınız bulunmuyor! VIP olarak veya 100+ Yıldız harcayarak hak kazanabilirsiniz.', { show_alert: true }).catch(() => {});
        return renderWheelMenu(ctx);
    }

    await ctx.answerCbQuery('🎰 Çark dönüyor... Bol şans!').catch(() => {});

    const frames = [
        `🎡 <b>ŞANS ÇARKI DÖNÜYOR...</b> 🎡\n\n` +
        `🌀 <b>[ 3 ✦ 7 ✦ 1 ✦ 9 ✦ 5 ✦ 10 ]</b>\n\n` +
        `<i>Büyük ödül belirleniyor...</i>`,

        `🎡 <b>ŞANS ÇARKI DÖNÜYOR...</b> 🎡\n\n` +
        `🌀 <b>[ 8 ✦ 2 ✦ 6 ✦ 4 ✦ 10 ✦ 1 ]</b>\n\n` +
        `<i>Çark yavaşlıyor...</i>`,

        `🎡 <b>ŞANS ÇARKI DÖNÜYOR...</b> 🎡\n\n` +
        `🌀 <b>[ 10 ✦ ❓ ✦ ❓ ]</b>\n\n` +
        `<i>Neredeyse durdu...</i>`
    ];

    for (const frame of frames) {
        try {
            await ctx.editMessageText(frame, { parse_mode: 'HTML' });
            await new Promise(r => setTimeout(r, 450));
        } catch (e) {}
    }

    // 1 ile 10 arasında rastgele Video kredisi
    const wonVideoCredits = Math.floor(Math.random() * 10) + 1;
    db.updateCredits(userId, 'video', wonVideoCredits);
    const updatedUser = db.getUser(userId) || {};

    const winText = 
`🎉 <b>TEBRİKLER! ÇARK DURDU!</b> 🎉\n\n` +
`🎯 <b>Kazandığınız Ödül:</b> 🎥 <b>+${wonVideoCredits} VİDEO KREDİSİ!</b>\n\n` +
`📊 <b>Güncel Video Bakiyeniz:</b> <code>${updatedUser.videoCredits || 0}</code>\n` +
`🎟️ <b>Kalan Çevirme Hakkınız:</b> <code>${spinRes.remaining}</code> adet\n\n` +
`<i>Kazandığınız video kredileriyle hemen dilediğiniz sekmeden video alabilirsiniz!</i>`;

    const endButtons = [];
    if (spinRes.remaining > 0) {
        endButtons.push([Markup.button.callback(`🎰 Tekrar Çevir (${spinRes.remaining} Hak)`, 'wheel_spin')]);
    } else {
        endButtons.push([Markup.button.callback('🌟 VIP Al (+1 Çark Hakkı 🎡)', 'buy_vip_1')]);
    }
    endButtons.push([Markup.button.callback('🎥 Hemen Video Al', 'take_video_1')]);
    endButtons.push([
        Markup.button.callback('🎡 Çark Menüsü', 'wheel_menu'),
        Markup.button.callback('🏠 Ana Menü', 'main_menu')
    ]);

    try {
        await ctx.editMessageText(winText, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(endButtons)
        });
    } catch (e) {
        await ctx.reply(winText, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(endButtons)
        }).catch(() => {});
    }

    if (ADMIN_ID) {
        bot.telegram.sendMessage(
            ADMIN_ID,
            `🎰 <b>ÇARK ÇEVRİLDİ!</b>\n👤 <b>Kullanıcı:</b> ${escapeHtml(ctx.from.first_name || '')} (@${ctx.from.username || 'yok'})\n🆔 ID: <code>${userId}</code>\n🎁 <b>Kazanılan:</b> +${wonVideoCredits} Video Kredisi\n🎟️ Kalan Hak: ${spinRes.remaining}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }
});

// Admin: Kullanıcıya Çark Hakkı Ekleme /carkver <userId> <adet>
bot.command('carkver', async (ctx) => {
    if (!isAdminUser(ctx.from?.id)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) {
        return ctx.reply('Kullanım: /carkver <kullanici_id> <adet>');
    }
    const targetId = parts[1];
    const count = parseInt(parts[2], 10);
    if (isNaN(count) || count <= 0) {
        return ctx.reply('❌ Lütfen geçerli bir sayı girin.');
    }
    const newTotal = db.addWheelSpins(targetId, count);
    ctx.reply(`✅ <code>${targetId}</code> kullanıcısına <b>+${count}</b> Çark Hakkı verildi!\nToplam Hakkı: <b>${newTotal}</b>`, { parse_mode: 'HTML' });
    bot.telegram.sendMessage(
        targetId,
        `🎉 <b>TEBRİKLER! YÖNETİCİ SİZE ÇARK HAKKI HEDİYE ETTİ!</b>\n\n` +
        `🎁 Hesabınıza <b>+${count} Şans Çarkı Hakkı</b> eklendi!\n` +
        `Toplam Çevirme Hakkınız: <b>${newTotal}</b>\n\n` +
        `<i>Hemen çarkı çevirip 1-10 video kredisi kazanabilirsiniz!</i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🎡 Şans Çarkını Çevir', 'wheel_menu')],
                [Markup.button.callback('🏠 Ana Menü', 'main_menu')]
            ])
        }
    ).catch(() => {});
});

main();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
