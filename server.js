// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv'); // Tetap ada, tapi Vercel akan menggunakan env vars dari dashboardnya
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load .env (hanya akan berjalan di lokal, di Vercel akan diabaikan)
dotenv.config();

// Cek apakah API_KEY tersedia
// Ini tetap penting untuk pengembangan lokal dan sebagai "fail-safe"
if (!process.env.API_KEY) {
  console.error("❌ API_KEY belum diset di file .env atau di environment Vercel.");
  // Di Vercel, ini akan teratasi jika API_KEY diset di dashboard
  // Di lokal, ini akan menghentikan server jika .env tidak ada/kosong
  process.exit(1);
}

// Inisialisasi Google Gemini API
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000; // Vercel akan menyediakan PORT sendiri

app.use(cors());
app.use(express.json());

// Melayani file statis dari direktori root proyek
// Karena index.html ada di root, ini sudah benar.
app.use(express.static(path.join(__dirname)));

// Endpoint utama
app.post('/generate', async (req, res) => {
  const prompt = req.body.prompt;

  if (!prompt || prompt.trim() === "") {
    return res.status(400).json({ error: 'Prompt tidak boleh kosong' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    res.json({ response: text });
  } catch (error) {
    console.error("Error saat generate:", error);
    res.status(500).json({ error: 'Gagal menghasilkan respons dari Gemini' });
  }
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`✅ Server berjalan di http://localhost:${PORT}`);
  console.log("Catatan: Di Vercel, ini mungkin tidak terlihat di log build, tapi aplikasi akan berjalan.");
});
