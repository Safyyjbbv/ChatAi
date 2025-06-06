// server.js

require('dotenv').config();
process.noDeprecation = true;

const express = require("express");
const path = require("path");
const cors = require('cors');

// Impor dari modul-modul kita
const { weatherTool, getWeatherDataWttrIn } = require('./cuaca.js');
const { searchTool, performWebSearchImplementation } = require('./search.js');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());

app.post("/api/generate", async (req, res) => {
    const userPrompt = req.body.prompt;
    const history = req.body.history || [];
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("Error: Gemini API Key not configured!");
        return res.status(500).json({ error: "Gemini API Key not configured on the server." });
    }

    let currentContents = [...history, { role: "user", parts: [{ text: userPrompt }] }];
    // Anda bisa memilih model di sini. 'gemini-pro' baik untuk function calling.
    // 'gemini-1.5-flash-latest' juga pilihan bagus jika Anda ingin model yang lebih baru dan cepat.
    // Pastikan endpoint URL sesuai dengan model yang dipilih.
    const geminiModel = "gemini-2.0-flash"; // atau "gemini-1.5-flash-latest"
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;


    try {
        let geminiResponseData;
        let safetyRatingsCheck = true; // Flag untuk pemeriksaan safety ratings awal

        // Loop untuk menangani kemungkinan beberapa putaran function calling
        for (let i = 0; i < 5; i++) { // Batasi iterasi untuk mencegah loop tak terbatas
            console.log(`[Server Iteration ${i + 1}] Sending to Gemini (${geminiModel}). Contents length: ${currentContents.length}`);
            // currentContents.forEach((item, idx) => console.log(`Content ${idx} role ${item.role}: ${JSON.stringify(item.parts).substring(0,150)}...`));


            const payload = {
                contents: currentContents,
                tools: [weatherTool, searchTool], // Menyertakan semua tools yang tersedia
                // generationConfig: { // Opsional
                //   temperature: 0.7,
                //   // maxOutputTokens: 800,
                // },
                // safetySettings: [ // Opsional: Sesuaikan jika perlu
                //   { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                //   { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                //   { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                //   { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                // ]
            };

            const apiResponse = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!apiResponse.ok) {
                const errorBody = await apiResponse.text();
                console.error(`Gemini API request failed (${geminiModel}):`, apiResponse.status, errorBody.substring(0,500));
                return res.status(apiResponse.status).json({ error: `Gemini API error: ${apiResponse.status} - ${errorBody.substring(0,200)}` });
            }
            
            geminiResponseData = await apiResponse.json();

            if (!geminiResponseData.candidates || geminiResponseData.candidates.length === 0) {
                console.warn("Gemini API: No candidates returned.", JSON.stringify(geminiResponseData, null, 2).substring(0,500));
                let errorMessage = "Maaf, saya tidak bisa memberikan respons saat ini.";
                if (geminiResponseData.promptFeedback) {
                    if (geminiResponseData.promptFeedback.blockReason) {
                        errorMessage = `Permintaan Anda diblokir karena: ${geminiResponseData.promptFeedback.blockReason}.`;
                    }
                    if (geminiResponseData.promptFeedback.safetyRatings && geminiResponseData.promptFeedback.safetyRatings.length > 0) {
                        geminiResponseData.promptFeedback.safetyRatings.forEach(rating => {
                            console.warn(`Safety Rating Block (Prompt Feedback): ${rating.category} - ${rating.probability}`);
                        });
                        if (geminiResponseData.promptFeedback.blockReason) errorMessage += " Mohon ubah pertanyaan Anda.";
                    }
                }
                return res.status(400).json({ error: errorMessage });
            }

            const candidate = geminiResponseData.candidates[0];

            // Periksa safety ratings pada kandidat yang diterima (hanya untuk respons pertama, bukan hasil function call)
            if (candidate.safetyRatings && safetyRatingsCheck) {
                for (const rating of candidate.safetyRatings) {
                    if (rating.probability !== 'NEGLIGIBLE' && rating.probability !== 'LOW') {
                        console.warn(`Potensi konten tidak aman terdeteksi (Candidate): ${rating.category} - ${rating.probability}`);
                        // Pertimbangkan untuk mengembalikan error di sini jika probabilitas tinggi
                        if (rating.probability === 'HIGH' || rating.probability === 'MEDIUM') {
                             // return res.status(400).json({ error: `Respons diblokir karena konten ${rating.category.replace('HARM_CATEGORY_', '')} terdeteksi.` });
                        }
                    }
                }
            }
            safetyRatingsCheck = false; // Nonaktifkan pemeriksaan safety untuk iterasi berikutnya (hasil function call)


            // Periksa finishReason. Jika 'SAFETY', artinya respons diblokir.
            if (candidate.finishReason === "SAFETY") {
                let safetyMessage = "Respons tidak dapat dihasilkan karena terkait isu keamanan.";
                if (candidate.safetyRatings && candidate.safetyRatings.length > 0) {
                    const specificReasons = candidate.safetyRatings
                        .filter(r => r.probability !== 'NEGLIGIBLE' && r.probability !== 'LOW')
                        .map(r => `${r.category.replace('HARM_CATEGORY_', '')}: ${r.probability}`)
                        .join(', ');
                    if (specificReasons) safetyMessage += ` Detail: ${specificReasons}. Mohon ubah pertanyaan Anda.`;
                }
                console.warn(safetyMessage, JSON.stringify(candidate.safetyRatings, null, 2));
                return res.status(400).json({ error: safetyMessage });
            }
            
            // Periksa jika ada 'content' dan 'parts'
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                const part = candidate.content.parts[0];

                if (part.functionCall) {
                    console.log("Gemini requested a function call:", JSON.stringify(part.functionCall, null, 2));
                    const functionCall = part.functionCall;
                    let functionResponseData;

                    if (functionCall.name === "getCurrentWeather") {
                        const locationArg = functionCall.args && functionCall.args.city ? functionCall.args.city : null;
                        if (!locationArg) {
                            console.error("getCurrentWeather called without 'city' argument.");
                            functionResponseData = { error: "Argumen 'city' (lokasi) tidak ditemukan dalam permintaan fungsi cuaca." };
                        } else {
                            functionResponseData = await getWeatherDataWttrIn(locationArg);
                        }
                    } else if (functionCall.name === "performWebSearch") {
                        const searchQuery = functionCall.args && functionCall.args.query ? functionCall.args.query : null;
                         if (!searchQuery) {
                            console.error("performWebSearch called without 'query' argument.");
                            functionResponseData = { error: "Argumen 'query' (kata kunci) tidak ditemukan dalam permintaan fungsi pencarian." };
                        } else {
                            functionResponseData = await performWebSearchImplementation(searchQuery);
                        }
                    } else {
                        console.error(`Unknown function call requested: ${functionCall.name}`);
                        functionResponseData = { error: `Fungsi ${functionCall.name} tidak dikenal oleh server.` };
                    }

                    // Tambahkan respons model (functionCall) dan hasil fungsi kita (functionResponse) ke history
                    currentContents.push({ role: "model", parts: [part] }); // Respons model yang meminta function call
                    currentContents.push({
                        role: "user", // Sesuai dokumentasi Gemini API v1beta, role "user" untuk function response
                        parts: [{
                            functionResponse: {
                                name: functionCall.name,
                                response: functionResponseData // Objek hasil dari fungsi kita
                            }
                        }]
                    });
                    // Lanjutkan loop untuk mengirim hasil fungsi kembali ke Gemini

                } else if (part.text) {
                    // Ini adalah respons teks final dari Gemini
                    console.log("Gemini returned final text response.");
                    return res.json({ response: part.text });
                } else {
                    // Part ada tapi bukan text atau functionCall
                    console.error("Gemini API: Unexpected part format (not text or functionCall).", JSON.stringify(part, null, 2).substring(0,500));
                    return res.status(500).json({ error: "Format respons dari Gemini tidak dikenali (bagian tidak valid)." });
                }
            } else {
                 // Kandidat ada tapi tidak ada 'content' atau 'parts'
                console.error("Gemini API: Candidate exists but no content or parts.", JSON.stringify(candidate, null, 2).substring(0,500));
                let finishReason = candidate.finishReason || "UNKNOWN_REASON";
                return res.status(500).json({ error: `Respons dari Gemini tidak lengkap atau tidak valid. Alasan penghentian: ${finishReason}` });
            }
        }
        // Jika loop selesai tanpa return (misalnya, terlalu banyak iterasi function call)
        console.error("Exceeded maximum function call iterations.");
        return res.status(500).json({ error: "Gagal mendapatkan respons setelah beberapa upaya pemanggilan fungsi internal." });

    } catch (err) {
        console.error("General error in /api/generate or function execution:", err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

const initializeServer = async () => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}. Weather and Search modules loaded. Function calling enabled.`));
};

initializeServer();
