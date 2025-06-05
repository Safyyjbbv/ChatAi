// server.js

// Memuat variabel dari .env ke process.env (hanya untuk pengembangan lokal)
require('dotenv').config();

process.noDeprecation = true;

const express = require("express");
const path = require("path");
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());

// --- IMPLEMENTASI FUNCTION CALLING DENGAN WTTR.IN ---
// Definisi Tool untuk Gemini
const weatherTool = {
    functionDeclarations: [
        {
            name: "getCurrentWeather",
            description: "Get the current weather in a given city or location. It can also understand provinces or broader areas.",
            parameters: {
                type: "OBJECT",
                properties: {
                    city: { // Kita tetap sebut 'city' agar konsisten dengan contoh sebelumnya, Gemini akan cerdas
                        type: "STRING",
                        description: "The city name, province, or general location (e.g., Jakarta, Jawa Barat, London, Mount Everest)."
                    }
                },
                required: ["city"]
            }
        }
    ]
};

// Fungsi untuk mendapatkan data cuaca dari wttr.in
async function getWeatherDataWttrIn(location) {
    if (!location) {
        console.error("Location name is required for weather lookup.");
        // Mengembalikan pesan error yang bisa dipahami AI untuk diteruskan ke user
        return { error: "Nama lokasi tidak diberikan. Tolong sebutkan kota atau lokasi yang ingin Anda ketahui cuacanya." };
    }

    const encodedLocation = encodeURIComponent(location);
    const wttrUrl = `https://wttr.in/${encodedLocation}?format=j1`;

    try {
        console.log(`Fetching weather for ${location} from wttr.in...`);
        const response = await fetch(wttrUrl, {
            headers: {
                'User-Agent': 'GeminiChatAI-Project/1.0' // Ganti dengan URL proyek Anda jika ada
            }
        });

        if (!response.ok) {
            const errorText = await response.text(); // Coba baca teks error jika ada
            console.error(`wttr.in API Error (HTTP ${response.status}) for ${location}:`, errorText.substring(0, 500)); // Log sebagian teks error
            // Kembalikan objek error agar bisa diproses sebagai functionResponse
            return { error: `Maaf, saya tidak bisa mendapatkan data cuaca untuk ${location} saat ini. Layanan cuaca mungkin tidak mengenali lokasi tersebut atau sedang ada gangguan.` };
        }

        const data = await response.json();

        if (data.current_condition && data.current_condition.length > 0) {
            const current = data.current_condition[0];
            const nearestArea = data.nearest_area && data.nearest_area.length > 0 ? data.nearest_area[0] : null;
            const weatherDescArray = data.weather && data.weather.length > 0 ? data.weather[0].hourly : null;


            let cityName = location;
            let region = "";
            let country = "";

            if (nearestArea) {
                if (nearestArea.areaName && nearestArea.areaName.length > 0) {
                    cityName = nearestArea.areaName[0].value;
                }
                if (nearestArea.region && nearestArea.region.length > 0) {
                    region = nearestArea.region[0].value;
                }
                if (nearestArea.country && nearestArea.country.length > 0) {
                    country = nearestArea.country[0].value;
                }
            }
            
            let fullLocation = cityName;
            if (region && region !== cityName) fullLocation += `, ${region}`;
            if (country) fullLocation += `, ${country}`;


            let description = "Tidak ada deskripsi";
            if (current.weatherDesc && current.weatherDesc.length > 0 && current.weatherDesc[0].value) {
                description = current.weatherDesc[0].value;
            } else if (weatherDescArray && weatherDescArray.length > 0 && weatherDescArray[0].weatherDesc && weatherDescArray[0].weatherDesc.length > 0 && weatherDescArray[0].weatherDesc[0].value) {
                // Fallback ke deskripsi dari data per jam pertama jika deskripsi utama kosong
                description = weatherDescArray[0].weatherDesc[0].value;
            }


            return { // Ini akan menjadi bagian 'response' dalam functionResponse
                location: fullLocation,
                temperature: `${current.temp_C}°C`,
                feels_like: `${current.FeelsLikeC}°C`,
                description: description,
                humidity: `${current.humidity}%`,
                wind_speed: `${current.windspeedKmph} km/jam (arah ${current.winddir16Point})`,
                precipitation_mm: `${current.precipMM} mm`,
                visibility_km: `${current.visibility} km`,
                pressure_mb: `${current.pressure} mb`,
                observation_time: current.observation_time,
                // Anda bisa menambahkan lebih banyak info jika mau
                // sunrise: data.weather[0].astronomy[0].sunrise,
                // sunset: data.weather[0].astronomy[0].sunset,
            };
        } else {
            console.error("wttr.in response format unexpected or no current condition for location:", location, JSON.stringify(data, null, 2));
            return { error: `Format data cuaca dari layanan tidak sesuai atau tidak ada informasi kondisi saat ini untuk ${location}.` };
        }
    } catch (error) {
        console.error(`Error calling wttr.in for ${location}:`, error);
        return { error: `Terjadi kesalahan internal saat mencoba mengambil data cuaca untuk ${location}.` };
    }
}
// --- AKHIR IMPLEMENTASI FUNCTION CALLING ---

app.post("/api/generate", async (req, res) => {
    const userPrompt = req.body.prompt;
    const history = req.body.history || [];
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("Error: Gemini API Key not configured!");
        return res.status(500).json({ error: "Gemini API Key not configured on the server." });
    }

    // Selalu mulai dengan prompt pengguna saat ini
    let currentContents = [...history, { role: "user", parts: [{ text: userPrompt }] }];

    // URL API Gemini
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`; // Ganti ke gemini-pro jika ingin menggunakan model yang lebih kuat untuk function calling, atau tetap flash.
    // NOTE: Gemini 1.5 Flash juga mendukung function calling. Gemini 1.0 Pro juga.
    // Jika menggunakan gemini-1.5-flash-latest atau gemini-1.5-pro-latest, endpointnya bisa beda (misal ada /v1beta/)

    try {
        let geminiResponseData;
        let safetyRatingsCheck = true; // Flag untuk menandakan apakah perlu cek safety ratings

        // Loop untuk menangani kemungkinan function calling
        for (let i = 0; i < 5; i++) { // Batasi iterasi untuk mencegah loop tak terbatas
            console.log(`[Iteration ${i + 1}] Sending to Gemini. Contents length: ${currentContents.length}`);
            // currentContents.forEach((item, idx) => console.log(`Content ${idx}: ${JSON.stringify(item).substring(0,100)}`));


            const payload = {
                contents: currentContents,
                tools: [weatherTool], // Sertakan tools di setiap panggilan
                // generationConfig: { // Opsional: bisa tambahkan konfigurasi generasi
                //   temperature: 0.7,
                // },
                // safetySettings: [ // Opsional: sesuaikan safety settings jika perlu
                //   { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                // ]
            };

            const apiResponse = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!apiResponse.ok) {
                const errorBody = await apiResponse.text();
                console.error("Gemini API request failed:", apiResponse.status, errorBody);
                return res.status(apiResponse.status).json({ error: `Gemini API error: ${errorBody}` });
            }
            
            geminiResponseData = await apiResponse.json();

            // Cek jika ada block karena safety settings atau alasan lain
            if (!geminiResponseData.candidates || geminiResponseData.candidates.length === 0) {
                console.warn("Gemini API: No candidates returned.", JSON.stringify(geminiResponseData, null, 2));
                let errorMessage = "Maaf, saya tidak bisa memberikan respons saat ini.";
                if (geminiResponseData.promptFeedback && geminiResponseData.promptFeedback.blockReason) {
                    errorMessage = `Permintaan Anda diblokir karena: ${geminiResponseData.promptFeedback.blockReason}. Mohon ubah pertanyaan Anda.`;
                     if (geminiResponseData.promptFeedback.safetyRatings && geminiResponseData.promptFeedback.safetyRatings.length > 0) {
                        geminiResponseData.promptFeedback.safetyRatings.forEach(rating => {
                            console.warn(`Safety Rating Block: ${rating.category} - ${rating.probability}`);
                        });
                    }
                }
                return res.status(400).json({ error: errorMessage });
            }


            const candidate = geminiResponseData.candidates[0];

            // Penting: Periksa safety ratings pada kandidat yang diterima
            if (candidate.safetyRatings && safetyRatingsCheck) {
                for (const rating of candidate.safetyRatings) {
                    if (rating.probability !== 'NEGLIGIBLE' && rating.probability !== 'LOW') {
                        console.warn(`Potensi konten tidak aman terdeteksi: ${rating.category} - ${rating.probability}`);
                        // Anda bisa memilih untuk memblokir atau memberi tahu pengguna
                        // Untuk sekarang, kita teruskan tapi log peringatannya
                    }
                }
            }
            // Setelah pemeriksaan pertama, tidak perlu lagi memeriksa safety ratings jika ini adalah hasil dari function call
            safetyRatingsCheck = false;


            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                const part = candidate.content.parts[0];

                if (part.functionCall) {
                    console.log("Gemini requested a function call:", JSON.stringify(part.functionCall, null, 2));
                    const functionCall = part.functionCall;
                    let functionResponseData;

                    if (functionCall.name === "getCurrentWeather") {
                        // Pastikan argumen 'city' ada
                        const locationArg = functionCall.args && functionCall.args.city ? functionCall.args.city : null;
                        if (!locationArg) {
                            console.error("getCurrentWeather called without 'city' argument.");
                            functionResponseData = { error: "Argumen 'city' (lokasi) tidak ditemukan dalam permintaan fungsi." };
                        } else {
                            functionResponseData = await getWeatherDataWttrIn(locationArg);
                        }
                    } else {
                        console.error(`Unknown function call requested: ${functionCall.name}`);
                        functionResponseData = { error: `Fungsi ${functionCall.name} tidak dikenal.` };
                    }

                    // Tambahkan function call dari model dan function response dari kita ke history
                    currentContents.push({ role: "model", parts: [part] }); // Respons model (functionCall)
                    currentContents.push({
                        role: "user", // Sesuai dokumentasi Gemini API v1beta, role "user" untuk function response
                        parts: [{
                            functionResponse: {
                                name: functionCall.name,
                                response: functionResponseData // Ini sudah objek dari getWeatherDataWttrIn
                            }
                        }]
                    });
                    // Lanjutkan loop untuk mengirim hasil fungsi kembali ke Gemini

                } else if (part.text) {
                    // Ini adalah respons teks final dari Gemini
                    console.log("Gemini returned final text response.");
                    return res.json({ response: part.text });
                } else {
                    console.error("Gemini API: Unexpected part format, no text or functionCall.", JSON.stringify(part, null, 2));
                    return res.status(500).json({ error: "Format respons dari Gemini tidak dikenali." });
                }
            } else {
                 // Ini bisa terjadi jika kandidat ada tapi tidak ada 'content' atau 'parts'
                console.error("Gemini API: Candidate exists but no content or parts.", JSON.stringify(candidate, null, 2));
                let finishReason = candidate.finishReason || "UNKNOWN";
                if (finishReason === "SAFETY") {
                     let safetyMessage = "Respons tidak dapat dihasilkan karena terkait isu keamanan.";
                     if (candidate.safetyRatings && candidate.safetyRatings.length > 0) {
                         const specificReasons = candidate.safetyRatings
                             .filter(r => r.probability !== 'NEGLIGIBLE' && r.probability !== 'LOW')
                             .map(r => `${r.category.replace('HARM_CATEGORY_', '')}: ${r.probability}`)
                             .join(', ');
                         if (specificReasons) {
                             safetyMessage += ` Detail: ${specificReasons}.`;
                         }
                     }
                     console.warn(safetyMessage);
                     return res.status(400).json({ error: safetyMessage });
                }
                return res.status(500).json({ error: `Respons dari Gemini tidak lengkap atau tidak valid. Alasan: ${finishReason}` });
            }
        }
        // Jika loop selesai tanpa return (misalnya, terlalu banyak iterasi function call)
        console.error("Exceeded maximum function call iterations.");
        return res.status(500).json({ error: "Gagal mendapatkan respons setelah beberapa upaya pemanggilan fungsi." });

    } catch (err) {
        console.error("Error during API call to Gemini or function execution:", err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

const initializeServer = async () => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}. Function calling for weather is enabled.`));
};

initializeServer();
