// server.js

require('dotenv').config();
process.noDeprecation = true;

const express = require("express");
const path = require("path");
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());

app.post("/api/generate", async (req, res) => {
    const prompt = req.body.prompt;
    const history = req.body.history || []; // <--- Pastikan history diterima di sini dan default ke array kosong

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("Error: Gemini API Key not configured!");
        return res.status(500).json({ error: "Gemini API Key not configured on the server." });
    }

    const contents = [...history, { role: "user", parts: [{ text: prompt }] }]; // <--- History digunakan di sini

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: contents,
            }),
        });

        const data = await response.json();

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
