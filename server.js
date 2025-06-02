// server.js

// Memuat variabel dari .env ke process.env (hanya untuk pengembangan lokal)
// Baris ini akan diabaikan oleh Vercel karena Vercel akan langsung menyediakan variabel lingkungan
require('dotenv').config();

process.noDeprecation = true;

const express = require("express");
const path = require("path");
// const fs = require("fs"); // Hapus baris ini karena kita tidak lagi membaca/menulis file lokal
const cors = require('cors'); // Tambahkan ini untuk mengatasi masalah CORS

const app = express();

app.use(express.json()); // Middleware untuk parsing body JSON
app.use(express.static(path.join(__dirname, "public"))); // Melayani file statis dari folder 'public'
app.use(cors()); // Mengizinkan semua origin untuk development, bisa diatur lebih spesifik nanti

// Hapus semua fungsi terkait config.json dan promptForApiKey:
// const CONFIG_FILE = "config.json";
// const loadApiKey = () => { /* ... */ };
// const saveApiKey = (apiKey) => { /* ... */ };
// const promptForApiKey = async () => { /* ... */ };

app.post("/api/generate", async (req, res) => {
    // req.body.prompt akan berisi pesan terbaru dari pengguna
    // req.body.history akan berisi array objek history dari frontend
    const prompt = req.body.prompt;
    const history = req.body.history || []; // Dapatkan history dari request body

    const apiKey = process.env.GEMINI_API_KEY; // Ambil API Key dari environment variables

    if (!apiKey) {
        console.error("Error: Gemini API Key not configured!");
        return res.status(500).json({ error: "Gemini API Key not configured on the server." });
    }

    // Bangun struktur 'contents' yang sesuai dengan API Gemini
    // Gabungkan history yang diterima dari frontend dengan prompt saat ini
    const contents = [...history, { role: "user", parts: [{ text: prompt }] }];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`; // Menggunakan model gemini-1.0-pro untuk percakapan, sesuaikan jika perlu

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: contents, // Mengirimkan history dan prompt
            }),
        });

        const data = await response.json();

        // Tangani error dari API Gemini itu sendiri
        if (data.error) {
            console.error("Gemini API Error:", data.error);
            return res.status(data.error.code || 500).json({ error: data.error.message || "Error from Gemini API." });
        }

        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            const generatedText = data.candidates[0].content.parts[0].text;
            res.json({ response: generatedText });
        } else {
            console.error("Gemini API: No results found or unexpected response format.", data);
            res.status(400).json({ error: "No response from Gemini or unexpected format." });
        }
    } catch (err) {
        console.error("Error during API call to Gemini:", err);
        res.status(500).json({ error: "Server error occurred when connecting to Gemini API." });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

const initializeServer = async () => {
    // console.clear(); // Hapus ini, tidak relevan untuk server yang di-deploy
    // Bagian API Key prompt tidak diperlukan lagi karena menggunakan Environment Variables
    // let apiKey = loadApiKey();
    // if (!apiKey) {
    //     apiKey = await promptForApiKey();
    // }

    // Gunakan process.env.PORT yang disediakan Vercel, fallback ke 3000 untuk lokal
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log("=======================================");
        console.log("            GEMINI AI TOOLS            ");
        console.log("=======================================");
        console.log(`Server is running at: http://localhost:${PORT}`);
        console.log("Use this tool to generate AI content.\n");
        console.log("API Key Source: Environment Variable (for deployment) or .env (for local development)");
    });
};

initializeServer();
