// File: api/handler.js (REVISED FOR VERCEL DEPLOYMENT)

require('dotenv').config();
process.noDeprecation = true;

const express = require("express");
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const { kv } = require('@vercel/kv'); // <-- Impor Vercel KV

// Pindahkan file-file ini ke direktori 'api/' atau sesuaikan path-nya
const { weatherTool, getWeatherDataWttrIn } = require('./public/cuaca.js');
const { searchTool, performWebSearchImplementation } = require('./public/search.js');
const { cloudinaryTool, uploadImageImplementation, listImagesImplementation } = require('./public/cloudinary.js');

// =================================================================
// KONFIGURASI
// =================================================================
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

const geminiModel = "gemini-1.5-flash-latest"; // <-- Gunakan model terbaru jika bisa
const geminiApiKey = process.env.GEMINI_API_KEY;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const vercelUrl = process.env.VERCEL_URL; // Vercel secara otomatis menyediakan variabel ini

// =================================================================
// LOGIKA INTI GEMINI (Tidak perlu diubah, sudah bagus!)
// ... salin seluruh fungsi `runGeminiConversation` Anda di sini ...
async function runGeminiConversation(prompt, history, imageData, mimeType) {
    // ... PASTE KODE FUNGSI runGeminiConversation ANDA DARI FILE LAMA ...
    // ... TIDAK ADA PERUBAHAN YANG DIPERLUKAN DI DALAM FUNGSI INI ...
    if (!geminiApiKey) {
        throw new Error("Gemini API Key not configured.");
    }
    // (Rest of your function code)
}

// =================================================================
// PENANGANAN PERMINTAAN (HANDLER UTAMA)
// =================================================================
if (!telegramToken) {
    console.warn("TELEGRAM_BOT_TOKEN tidak ditemukan. Bot Telegram tidak akan aktif.");
}

// Inisialisasi bot TANPA polling
const bot = new TelegramBot(telegramToken);

// Atur webhook jika aplikasi berjalan di Vercel
if (vercelUrl) {
    const webhookUrl = `https://${vercelUrl}/telegram-webhook`;
    bot.setWebHook(webhookUrl).then(() => {
        console.log(`Telegram webhook set to: ${webhookUrl}`);
    }).catch(err => {
        console.error('Failed to set Telegram webhook:', err);
    });
}


// Handler untuk bot Telegram
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userInput = msg.text;

    if (!userInput) return;

    if (userInput.startsWith('/')) {
        if (userInput === '/start') {
            await bot.sendMessage(chatId, "Halo! Saya Asisten AI Gemini Anda. Kirimkan pesan untuk memulai.");
        } else if (userInput === '/clear') {
            await kv.del(`chat:${chatId}`); // Hapus riwayat dari Vercel KV
            await bot.sendMessage(chatId, "Riwayat percakapan telah dihapus.");
        }
        return;
    }

    try {
        await bot.sendChatAction(chatId, 'typing');

        // Ambil riwayat chat dari Vercel KV
        const userHistory = await kv.get(`chat:${chatId}`) || [];

        console.log(`[Telegram] Processing message from chatId: ${chatId}`);
        const result = await runGeminiConversation(userInput, userHistory, null, null);

        // Simpan riwayat chat yang diperbarui ke Vercel KV
        await kv.set(`chat:${chatId}`, result.updatedHistory);
        
        await bot.sendMessage(chatId, result.responseText, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error(`[Telegram] Error processing message for chat ${chatId}:`, error);
        await bot.sendMessage(chatId, `Maaf, terjadi kesalahan: ${error.message}`);
    }
});


// Endpoint tunggal untuk menangani SEMUA permintaan POST
app.post('*', async (req, res) => {
    try {
        // Cek apakah ini permintaan dari Telegram Webhook
        if (req.body && req.body.update_id) {
            console.log('[Handler] Received update from Telegram.');
            bot.processUpdate(req.body);
            res.status(200).send('OK');
        }
        // Jika tidak, ini adalah permintaan dari Web Chat
        else {
            console.log('[Handler] Received request from Web Chat.');
            const { prompt, history, imageData, mimeType } = req.body;
            const result = await runGeminiConversation(prompt, history, imageData, mimeType);
            res.json({
                response: result.responseText,
                updatedHistory: result.updatedHistory
            });
        }
    } catch (error) {
        console.error("[Handler] General Error:", error);
        res.status(500).json({ error: `Server error: ${error.message}` });
    }
});


// Hapus semua kode `app.listen()`

// Ekspor aplikasi Express agar Vercel bisa menggunakannya
module.exports = app;
