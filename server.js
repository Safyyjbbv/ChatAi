// File: server.js (REVISED FOR CLOUDINARY INTEGRATION)

require('dotenv').config();
process.noDeprecation = true;

const express = require("express");
const path = require("path");
const cors = require('cors');

// Impor dari modul-modul kita
const { weatherTool, getWeatherDataWttrIn } = require('./public/cuaca.js');
const { searchTool, performWebSearchImplementation } = require('./public/search.js');
// **IMPOR BARU: Cloudinary Tools**
const { cloudinaryTool, uploadImageImplementation, listImagesImplementation } = require('./public/cloudinary.js');

const app = express();

// Tingkatkan limit body parser untuk bisa menerima gambar base64
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());

// **Model yang mendukung multimodal (teks & gambar)**
const geminiModel = "gemini-2.0-flash"; 

async function handleApiError(apiResponse) {
    const errorBody = await apiResponse.text();
    console.error(`Gemini API request failed (${geminiModel}):`, apiResponse.status, errorBody.substring(0, 500));
    return `Gemini API error: ${apiResponse.status} - ${errorBody.substring(0, 200)}`;
}

function handleNoCandidatesOrBlocked(geminiResponseData) {
    console.warn("Gemini API: No candidates or blocked.", JSON.stringify(geminiResponseData, null, 2).substring(0, 500));
    let errorMessage = "Maaf, saya tidak bisa memberikan respons saat ini.";
    if (geminiResponseData.promptFeedback?.blockReason) {
        errorMessage = `Permintaan diblokir: ${geminiResponseData.promptFeedback.blockReason}.`;
    }
    return errorMessage;
}

// ENDPOINT 1: Memulai obrolan
app.post("/api/chat/start", async (req, res) => {
    // Ambil data gambar dan prompt dari body
    const { prompt, history, imageData, mimeType } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: "Gemini API Key not configured." });

    // **Strukturkan 'parts' untuk mendukung multimodal**
    const userParts = [];
    if (prompt) userParts.push({ text: prompt });
    if (imageData && mimeType) {
        userParts.push({ inlineData: { mimeType: mimeType, data: imageData } });
    }
    
    if(userParts.length === 0) return res.status(400).json({ error: "Prompt atau gambar tidak boleh kosong." });

    const currentContents = [...(history || []), { role: "user", parts: userParts }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    try {
        console.log(`[Chat Start] Sending to Gemini. Contents length: ${currentContents.length}`);
        
        const payload = {
            contents: currentContents,
            // **Tambahkan Cloudinary Tool ke daftar**
            tools: [weatherTool, searchTool, cloudinaryTool],
        };

        const apiResponse = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!apiResponse.ok) {
            return res.status(apiResponse.status).json({ error: await handleApiError(apiResponse) });
        }

        const geminiResponseData = await apiResponse.json();

        if (!geminiResponseData.candidates || geminiResponseData.candidates.length === 0) {
            return res.status(400).json({ error: handleNoCandidatesOrBlocked(geminiResponseData) });
        }
        
        const candidate = geminiResponseData.candidates[0];
        
        if (candidate.finishReason === "SAFETY") return res.status(400).json({ error: "Respons diblokir karena masalah keamanan." });

        const part = candidate.content?.parts?.[0];
        if (!part) return res.status(500).json({ error: "Format respons dari Gemini tidak valid." });

        if (part.functionCall) {
            console.log("Gemini requested a function call:", part.functionCall.name);
            res.json({ type: 'tool_use', functionCall: part.functionCall, modelContentForHistory: candidate.content });
        } else if (part.text) {
            console.log("Gemini returned final text response directly.");
            res.json({ type: 'final_response', response: part.text });
        } else {
            throw new Error("Unexpected response format from Gemini.");
        }

    } catch (err) {
        console.error("Error in /api/chat/start:", err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});


// ENDPOINT 2: Mengeksekusi tool
app.post("/api/chat/execute-tool", async (req, res) => {
    // Terima juga imageData, karena mungkin dibutuhkan oleh tool (seperti upload)
    const { functionCall, history, imageData } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || !functionCall || !history) return res.status(400).json({ error: "Missing required parameters." });

    try {
        console.log(`[Execute Tool] Executing function: ${functionCall.name}`);
        let functionResponseData;
        const args = functionCall.args;

        // **Routing untuk semua function call**
        if (functionCall.name === "getCurrentWeather") {
            functionResponseData = await getWeatherDataWttrIn(args.city);
        } else if (functionCall.name === "performWebSearch") {
            functionResponseData = await performWebSearchImplementation(args.query);
        } else if (functionCall.name === "uploadImageToCloudinary") {
            // Panggil implementasi dari modul cloudinary.js
            functionResponseData = await uploadImageImplementation(imageData, args.folder, args.public_id);
        } else if (functionCall.name === "listImagesInCloudinary") {
            functionResponseData = await listImagesImplementation(args.folder);
        } else {
            console.error(`Unknown function call requested: ${functionCall.name}`);
            functionResponseData = { error: `Fungsi ${functionCall.name} tidak dikenal oleh server.` };
        }

        const currentContents = [
            ...history,
            { role: "user", parts: [{ functionResponse: { name: functionCall.name, response: functionResponseData } }] }
        ];
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: currentContents,
            tools: [weatherTool, searchTool, cloudinaryTool],
        };
        
        console.log(`[Execute Tool] Sending tool result back to Gemini.`);
        const apiResponse = await fetch(url, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });

        if (!apiResponse.ok) return res.status(apiResponse.status).json({ error: await handleApiError(apiResponse) });
        
        const geminiResponseData = await apiResponse.json();

        if (!geminiResponseData.candidates || geminiResponseData.candidates.length === 0) {
            return res.status(400).json({ error: handleNoCandidatesOrBlocked(geminiResponseData) });
        }

        const finalPart = geminiResponseData.candidates[0].content?.parts?.[0];
        if (!finalPart || !finalPart.text) return res.status(500).json({ error: "Respons final dari Gemini tidak berisi teks." });
        
        console.log("Gemini returned final text response after tool execution.");
        res.json({ type: 'final_response', response: finalPart.text });

    } catch (err) {
        console.error("Error in /api/chat/execute-tool:", err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}. Ready to handle chat requests.`));
