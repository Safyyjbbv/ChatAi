// index.js
process.noDeprecation = true;

const express = require("express");
const path = require("path");
// const fs = require("fs"); // Tidak lagi diperlukan untuk membaca/menulis config.json

const app = express();
// const CONFIG_FILE = "config.json"; // Tidak lagi diperlukan

app.use(express.json());
// Untuk Vercel, pastikan direktori 'public' dikenali.
// Jika file index.html ada di root, express.static bisa dihilangkan
// jika Anda ingin Vercel secara otomatis menyajikan file statis dari root.
// Namun, jika ada aset statis lain di 'public', ini tetap relevan.
app.use(express.static(path.join(__dirname, "public")));

// --- Fungsi loadApiKey dan saveApiKey tidak lagi diperlukan ---
// const loadApiKey = () => {
//     try {
//         if (fs.existsSync(CONFIG_FILE)) {
//             const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
//             return config.apiKey || null;
//         }
//     } catch (err) {
//         console.error("Error loading config:", err);
//     }
//     return null;
// };

// const saveApiKey = (apiKey) => {
//     fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey }, null, 2));
// };

// const promptForApiKey = async () => {
//     const readline = require("readline").createInterface({
//         input: process.stdin,
//         output: process.stdout,
//     });

//     return new Promise((resolve) => {
//         readline.question("\nAPI Key not found!\nGet your API Key at: https://aistudio.google.com/app/apikey\nEnter your Gemini API Key: ", (apiKey) => {
//             readline.close();
//             saveApiKey(apiKey);
//             console.log("\n✓ API Key saved successfully!\n");
//             resolve(apiKey);
//         });
//     });
// };
// --- Akhir dari fungsi yang tidak diperlukan ---

app.post("/api/generate", async (req, res) => {
    const prompt = req.body.prompt || "Write a story about a magical bag.";
    // Ambil API Key dari environment variable
    const apiKey = process.env.GEMINI_API_KEY; // Sesuaikan nama variabel lingkungan ini

    if (!apiKey) {
        // Ini akan terjadi jika GEMINI_API_KEY tidak diatur di Vercel
        return res.status(500).json({ error: "Gemini API Key not configured on the server." });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
            }),
        });

        const data = await response.json();

        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            const generatedText = data.candidates[0].content.parts[0].text;
            res.json({ response: generatedText });
        } else {
            // Tangani error dari API Gemini
            console.error("API Error Response:", data);
            res.status(data.error ? data.error.code : 400).json({ 
                error: data.error ? data.error.message : "No results found from Gemini API." 
            });
        }
    } catch (err) {
        console.error("Error calling Gemini API:", err);
        res.status(500).json({ error: "Server error occurred while communicating with Gemini API." });
    }
});

// Vercel secara default akan mencari file index.html di root atau di folder `public`.
// Menggunakan app.get("/") ini bisa opsional jika index.html sudah di root folder proyek Anda.
app.get("/", (req, res) => {
    // Pastikan path ini benar relatif terhadap root proyek Anda
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Inisialisasi server untuk Vercel
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("=======================================");
    console.log("            GEMINI AI TOOLS            ");
    console.log("=======================================");
    console.log(`Server is running on port ${PORT}`);
    console.log("API Key Source: Environment Variable (for deployment)");
    console.log("Note: API key is read from process.env.GEMINI_API_KEY");
});

// Untuk pengembangan lokal, Anda bisa menambahkan file .env
// require('dotenv').config(); // Uncomment this line if you use dotenv for local development
