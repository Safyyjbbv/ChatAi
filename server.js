// server.js (REVISED FOR TWO-STEP TOOL HANDLING)

require('dotenv').config();
process.noDeprecation = true;

const express = require("express");
const path = require("path");
const cors = require('cors');

// Impor dari modul-modul kita
const { weatherTool, getWeatherDataWttrIn } = require('./public/cuaca.js');
const { searchTool, performWebSearchImplementation } = require('./public/search.js');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());

const geminiModel = "gemini-2.0-flash"; // Model yang akan digunakan di seluruh aplikasi

/**
 * Helper function untuk menangani error respons API yang tidak OK.
 * @param {Response} apiResponse - Objek respons dari fetch.
 * @returns {string} - Pesan error yang diformat.
 */
async function handleApiError(apiResponse) {
    const errorBody = await apiResponse.text();
    console.error(`Gemini API request failed (${geminiModel}):`, apiResponse.status, errorBody.substring(0, 500));
    return `Gemini API error: ${apiResponse.status} - ${errorBody.substring(0, 200)}`;
}

/**
 * Helper function untuk menangani kasus di mana tidak ada kandidat atau respons diblokir.
 * @param {object} geminiResponseData - Data JSON dari respons Gemini.
 * @returns {string} - Pesan error yang informatif.
 */
function handleNoCandidatesOrBlocked(geminiResponseData) {
    console.warn("Gemini API: No candidates returned or prompt was blocked.", JSON.stringify(geminiResponseData, null, 2).substring(0, 500));
    let errorMessage = "Maaf, saya tidak bisa memberikan respons saat ini.";
    if (geminiResponseData.promptFeedback) {
        if (geminiResponseData.promptFeedback.blockReason) {
            errorMessage = `Permintaan Anda diblokir karena: ${geminiResponseData.promptFeedback.blockReason}. Mohon ubah pertanyaan Anda.`;
        }
    }
    return errorMessage;
}


// ENDPOINT 1: Memulai obrolan.
// Menerima prompt user, mengirimkannya ke Gemini, dan menentukan langkah selanjutnya.
// Respons bisa berupa teks final atau permintaan untuk menggunakan tool.
app.post("/api/chat/start", async (req, res) => {
    const userPrompt = req.body.prompt;
    const history = req.body.history || [];
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key not configured." });
    }

    const currentContents = [...history, { role: "user", parts: [{ text: userPrompt }] }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    try {
        console.log(`[Chat Start] Sending to Gemini. Contents length: ${currentContents.length}`);
        
        const payload = {
            contents: currentContents,
            tools: [weatherTool, searchTool],
        };

        const apiResponse = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!apiResponse.ok) {
            const errorMsg = await handleApiError(apiResponse);
            return res.status(apiResponse.status).json({ error: errorMsg });
        }

        const geminiResponseData = await apiResponse.json();

        if (!geminiResponseData.candidates || geminiResponseData.candidates.length === 0) {
            const errorMsg = handleNoCandidatesOrBlocked(geminiResponseData);
            return res.status(400).json({ error: errorMsg });
        }
        
        const candidate = geminiResponseData.candidates[0];
        
        // Periksa finishReason 'SAFETY'
        if (candidate.finishReason === "SAFETY") {
            return res.status(400).json({ error: "Respons diblokir karena masalah keamanan konten." });
        }

        const part = candidate.content?.parts?.[0];

        if (!part) {
             return res.status(500).json({ error: "Format respons dari Gemini tidak valid." });
        }

        if (part.functionCall) {
            // SKENARIO 1: Gemini meminta untuk menggunakan tool.
            // Kirim kembali detail functionCall ke frontend agar bisa ditampilkan statusnya.
            console.log("Gemini requested a function call:", part.functionCall.name);
            res.json({
                type: 'tool_use',
                functionCall: part.functionCall,
                modelContentForHistory: candidate.content // Penting untuk menjaga konsistensi history
            });
        } else if (part.text) {
            // SKENARIO 2: Gemini langsung menjawab dengan teks.
            // Kirim kembali teksnya sebagai respons final.
            console.log("Gemini returned final text response directly.");
            res.json({
                type: 'final_response',
                response: part.text
            });
        } else {
            throw new Error("Unexpected response format from Gemini (not text or functionCall).");
        }

    } catch (err) {
        console.error("Error in /api/chat/start:", err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});


// ENDPOINT 2: Mengeksekusi tool.
// Menerima detail functionCall dari frontend, mengeksekusinya, mengirim hasilnya kembali ke Gemini,
// dan mengembalikan respons teks final.
app.post("/api/chat/execute-tool", async (req, res) => {
    const { functionCall, history } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || !functionCall || !history) {
        return res.status(400).json({ error: "Missing required parameters (apiKey, functionCall, or history)." });
    }

    try {
        console.log(`[Execute Tool] Executing function: ${functionCall.name}`);
        let functionResponseData;

        // Logika eksekusi tool Anda yang sudah ada
        if (functionCall.name === "getCurrentWeather") {
            functionResponseData = await getWeatherDataWttrIn(functionCall.args.city);
        } else if (functionCall.name === "performWebSearch") {
            functionResponseData = await performWebSearchImplementation(functionCall.args.query);
        } else {
            console.error(`Unknown function call requested: ${functionCall.name}`);
            functionResponseData = { error: `Fungsi ${functionCall.name} tidak dikenal oleh server.` };
        }

        // Buat payload baru untuk dikirim kembali ke Gemini dengan hasil dari tool
        const currentContents = [
            ...history, // Ini berisi history SAMPAI respons model yang meminta function call
            {
                // Bagian ini adalah hasil dari eksekusi tool kita
                role: "user", // Sesuai dokumentasi, role "user" untuk functionResponse
                parts: [{
                    functionResponse: {
                        name: functionCall.name,
                        response: functionResponseData
                    }
                }]
            }
        ];
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: currentContents,
            tools: [weatherTool, searchTool],
        };
        
        console.log(`[Execute Tool] Sending tool result back to Gemini.`);
        const apiResponse = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!apiResponse.ok) {
            const errorMsg = await handleApiError(apiResponse);
            return res.status(apiResponse.status).json({ error: errorMsg });
        }
        
        const geminiResponseData = await apiResponse.json();

        if (!geminiResponseData.candidates || geminiResponseData.candidates.length === 0) {
            const errorMsg = handleNoCandidatesOrBlocked(geminiResponseData);
            return res.status(400).json({ error: errorMsg });
        }

        const finalPart = geminiResponseData.candidates[0].content?.parts?.[0];
        
        if (!finalPart || !finalPart.text) {
             return res.status(500).json({ error: "Respons final dari Gemini tidak berisi teks." });
        }
        
        console.log("Gemini returned final text response after tool execution.");
        res.json({
            type: 'final_response',
            response: finalPart.text
        });

    } catch (err) {
        console.error("Error in /api/chat/execute-tool:", err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});


// Endpoint untuk menyajikan file HTML utama
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public/index.html"));
});

// Inisialisasi server
const initializeServer = async () => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}. Ready to handle chat requests.`));
};

initializeServer();
