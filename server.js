// File: server.js (REVISED FOR VERCEL DEPLOYMENT WITH WEBHOOKS)

require('dotenv').config();
process.noDeprecation = true;

const express = require("express");
const path = require("path");
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

// ... (impor modul Anda seperti cuaca, search, dll. tetap sama) ...
const { weatherTool, getWeatherDataWttrIn } = require('./public/cuaca.js');
const { searchTool, performWebSearchImplementation } = require('./public/search.js');
const { cloudinaryTool, uploadImageImplementation, listImagesImplementation } = require('./public/cloudinary.js');


// =================================================================
// KONFIGURASI APLIKASI
// =================================================================
const app = express();
app.use(express.json({ limit: '50mb' }));
// PENTING: Pindahkan body parser Express ke atas sebelum routing webhook
// agar body dari Telegram bisa dibaca sebagai JSON.
app.use(express.json()); 
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());

const geminiModel = "gemini-2.0-flash";
const geminiApiKey = process.env.GEMINI_API_KEY;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

// =================================================================
// LOGIKA INTI GEMINI (Fungsi runGeminiConversation Anda tetap SAMA, tidak perlu diubah)
// =================================================================
const telegramChatHistories = {};
async function runGeminiConversation(prompt, history, imageData, mimeType) {
    // ... Seluruh kode fungsi runGeminiConversation Anda ada di sini ...
    // ... Tidak ada yang perlu diubah di dalam fungsi ini ...
    if (!geminiApiKey) {
        throw new Error("Gemini API Key not configured.");
    }
    const userParts = [];
    if (prompt) userParts.push({ text: prompt });
    if (imageData && mimeType) {
        userParts.push({ inlineData: { mimeType: mimeType, data: imageData } });
    }
    if (userParts.length === 0) {
        throw new Error("Prompt atau gambar tidak boleh kosong.");
    }
    let currentContents = [...(history || []), { role: "user", parts: userParts }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
    try {
        let payload = {
            contents: currentContents,
            tools: [weatherTool, searchTool, cloudinaryTool],
        };
        let apiResponse = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!apiResponse.ok) {
            const errorBody = await apiResponse.text();
            throw new Error(`Gemini API error: ${apiResponse.status} - ${errorBody.substring(0, 200)}`);
        }
        let geminiResponseData = await apiResponse.json();
        let candidate = geminiResponseData.candidates?.[0];
        let functionCallPart = candidate?.content?.parts?.find(p => p.functionCall);
        if (functionCallPart && functionCallPart.functionCall) {
            const functionCall = functionCallPart.functionCall;
            const functionName = functionCall.name;
            const args = functionCall.args;
            currentContents.push(candidate.content);
            let functionResponseData;
            if (functionName === "getCurrentWeather") {
                functionResponseData = await getWeatherDataWttrIn(args.city);
            } else if (functionName === "performWebSearch") {
                functionResponseData = await performWebSearchImplementation(args.query);
            } else if (functionName === "uploadImageToCloudinary") {
                functionResponseData = await uploadImageImplementation(imageData, args.folder, args.public_id);
            } else if (functionName === "listImagesInCloudinary") {
                functionResponseData = await listImagesImplementation(args.folder);
            } else {
                functionResponseData = { error: `Fungsi ${functionName} tidak dikenal.` };
            }
            currentContents.push({ role: "user", parts: [{ functionResponse: { name: functionName, response: functionResponseData } }] });
            payload.contents = currentContents;
            apiResponse = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            if (!apiResponse.ok) {
                 const errorBody = await apiResponse.text();
                 throw new Error(`Gemini API error after tool: ${apiResponse.status} - ${errorBody.substring(0, 200)}`);
            }
            geminiResponseData = await apiResponse.json();
        }
        const finalCandidate = geminiResponseData.candidates?.[0];
        if (!finalCandidate || finalCandidate.finishReason === "SAFETY" || !finalCandidate.content?.parts?.[0]?.text) {
             let reason = finalCandidate?.finishReason || "Tidak ada kandidat respons";
             if (geminiResponseData.promptFeedback?.blockReason) {
                 reason = `Permintaan diblokir: ${geminiResponseData.promptFeedback.blockReason}`;
             }
             return `Maaf, terjadi masalah: ${reason}. Coba lagi nanti.`;
        }
        const finalText = finalCandidate.content.parts[0].text;
        return { responseText: finalText, updatedHistory: [...currentContents, finalCandidate.content] };
    } catch (err) {
        console.error("[Gemini Core] Uncaught error:", err);
        throw err;
    }
}


// =================================================================
// BAGIAN TELEGRAM BOT (REVISI UNTUK WEBHOOK)
// =================================================================
if (!telegramToken) {
    console.warn("TELEGRAM_BOT_TOKEN tidak ditemukan. Bot Telegram tidak akan berjalan.");
} else {
    // Inisialisasi bot TANPA polling
    const bot = new TelegramBot(telegramToken);
    
    // Buat endpoint rahasia untuk webhook Telegram
    const webhookPath = `/api/telegram/webhook/${telegramToken}`;
    app.post(webhookPath, (req, res) => {
        // Beri tahu library bot untuk memproses update yang masuk
        bot.processUpdate(req.body);
        // Kirim status 200 OK agar Telegram tahu pesannya sudah diterima
        res.sendStatus(200); 
    });

    console.log(`Telegram Bot webhook is configured at path: ${webhookPath}`);

    // Listener 'message' tetap sama, tidak perlu diubah!
    // Library akan mengarahkan update dari webhook ke listener ini.
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userInput = msg.text;

        if (!userInput) return;
        if (userInput.startsWith('/')) {
             if (userInput === '/start') {
                 bot.sendMessage(chatId, "Halo! Saya adalah Asisten AI Gemini Anda. Kirimkan saya pesan untuk memulai percakapan.");
             } else if (userInput === '/clear') {
                 delete telegramChatHistories[chatId];
                 bot.sendMessage(chatId, "Riwayat percakapan telah dihapus.");
             }
            return;
        }

        try {
            bot.sendChatAction(chatId, 'typing');
            const userHistory = telegramChatHistories[chatId] || [];
            const result = await runGeminiConversation(userInput, userHistory, null, null);
            telegramChatHistories[chatId] = result.updatedHistory;
            bot.sendMessage(chatId, result.responseText, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error(`[Telegram] Error processing message for chat ${chatId}:`, error);
            bot.sendMessage(chatId, `Maaf, terjadi kesalahan: ${error.message}`);
        }
    });
}

// =================================================================
// ENDPOINT UNTUK WEB CHAT (TETAP SAMA)
// =================================================================
app.post("/api/chat", async (req, res) => {
    // ... Logika endpoint ini tidak perlu diubah ...
    const { prompt, history, imageData, mimeType } = req.body;
    try {
        console.log("[Web Chat] Processing request.");
        const result = await runGeminiConversation(prompt, history, imageData, mimeType);
        res.json({
            response: result.responseText,
            updatedHistory: result.updatedHistory
        });
    } catch (error) {
        console.error("[Web Chat] Error:", error);
        res.status(500).json({ error: `Server error: ${error.message}` });
    }
});
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}. Ready for web chat and Telegram webhooks.`));
