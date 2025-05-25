const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const port = 3000;

app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Enable JSON body parser

// Serve static files from the current directory (where index.html is)
app.use(express.static(__dirname));

app.post('/api/generate', async (req, res) => {
    // API Key and model now come from the request body
    const { prompt, history, apiKey, model: selectedModel } = req.body; 

    // Validate if API Key is provided
    if (!apiKey) {
        return res.status(400).json({ error: 'Gemini API Key is required.' });
    }

    // Validate if prompt is provided
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    // Validate selected model
    const allowedModels = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-pro", "models/gemini-pro"]; // Add more if needed
    if (!allowedModels.includes(selectedModel)) {
        return res.status(400).json({ error: 'Invalid AI model selected.' });
    }

    try {
        // Initialize GoogleGenerativeAI with the provided API Key
        const genAI = new GoogleGenerativeAI(apiKey);
        // Use the model selected by the user
        const model = genAI.getGenerativeModel({ model: selectedModel }); 

        // Transform history to match Gemini's expected format if necessary
        const chatHistory = history.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model', // Ensure roles are 'user' or 'model'
            parts: msg.parts.map(part => ({ text: part.text })) // Ensure parts have 'text' property
        }));

        const chat = model.startChat({
            history: chatHistory,
            generationConfig: {
                maxOutputTokens: 10000000,
            },
        });

        // ----- PERUBAHAN UNTUK STREAMING DI SINI -----
        const result = await chat.sendMessageStream(prompt);

        // Set header untuk streaming
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');

        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                res.write(chunkText);
            }
        }
        res.end(); // Akhiri respons setelah semua chunk dikirim

    } catch (error) {
        console.error('Error generating content:', error);
        // Provide more specific error messages if possible
        let statusCode = 500;
        let errorMessage = `An internal server error occurred: ${error.message}`;

        if (error.message.includes('API key not valid')) {
            statusCode = 401;
            errorMessage = 'Invalid Gemini API Key. Please check your key in settings.';
        } else if (error.message.includes('quota')) {
            statusCode = 429;
            errorMessage = 'API quota exceeded. Please try again later or check your Google Cloud Console.';
        } else if (error.message.includes('model is not found') || error.message.includes('400 Not Found')) {
            statusCode = 404;
            errorMessage = 'AI model not found or unavailable. Please check your API key region or try a different model.';
        } else if (error.message.includes('Blocked reason')) {
            statusCode = 403; // Forbidden
            errorMessage = `Content generation blocked: ${error.message}`;
        } else if (error.name === 'AbortError') {
             // Handle client-side abortion (although not typical for server errors directly from client)
             statusCode = 400;
             errorMessage = 'Request aborted by client.';
        }
        
        // If an error occurs during streaming, send JSON error before ending
        if (!res.headersSent) {
            res.status(statusCode).json({ error: errorMessage });
        } else {
            // If headers already sent (meaning some chunks were sent), log and just end
            console.error('Error after headers sent:', errorMessage);
            res.end();
        }
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

