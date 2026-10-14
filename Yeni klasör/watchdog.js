const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BOT_SCRIPT = path.join(__dirname, 'bot.js');
const LOG_FILE = path.join(__dirname, 'bot_runner.log');

function log(msg) {
    const time = new Date().toISOString();
    const line = `[${time}] ${msg}\n`;
    try {
        fs.appendFileSync(LOG_FILE, line, 'utf8');
    } catch (_) {}
    console.log(line.trim());
}

function startBot() {
    log('Telegram Takas Botu başlatılıyor (Watchdog)...');
    const child = spawn(process.execPath, [BOT_SCRIPT], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    child.stdout.on('data', (d) => {
        try { fs.appendFileSync(LOG_FILE, d); } catch (_) {}
        process.stdout.write(d);
    });

    child.stderr.on('data', (d) => {
        try { fs.appendFileSync(LOG_FILE, d); } catch (_) {}
        process.stderr.write(d);
    });

    child.on('close', (code, signal) => {
        log(`Bot kapandı (kod: ${code}, sinyal: ${signal}). 2 saniye içinde otomatik yeniden başlatılıyor...`);
        setTimeout(startBot, 2000);
    });

    child.on('error', (err) => {
        log(`Bot başlatılamadı: ${err.message}. 3 saniye sonra tekrar deneniyor...`);
        setTimeout(startBot, 3000);
    });
}

startBot();
