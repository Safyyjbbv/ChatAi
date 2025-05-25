const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file

const app = express();
// Vercel automatically assigns a port, so use process.env.PORT
const port = process.env.PORT || 3000; 

// Enable CORS for all routes
// In production, consider limiting CORS to your Vercel frontend domain
app.use(cors()); 
app.use(express.json()); // Enable JSON body parser

// Serve static files from the root of your project
// On Vercel, this is implicitly handled if your index.html is at the root.
// However, for local development and explicit serving, this is good.
// For Vercel, it often makes sense to put frontend files in a 'public' directory
// and configure Vercel to serve them as static assets.
app.use(express.static(__dirname));

app.post('/api/generate', async (req, res) => {
    // API Key and model now come from the request body
    // For security, it's generally better to pass API Key via Vercel Environment Variables
    // and access it as process.env.GEMINI_API_KEY on the server.
    // However, your current setup of sending it from the client has implications:
    // 1. It exposes the API key in client-side code (less secure).
    // 2. It requires the client to store the API key, which might be insecure.
    // For this reconstruction, we'll keep your current method but strongly advise
    // moving the API key to a server-side environment variable.
    const { prompt, history, apiKey, model: selectedModel, systemInstruction } = req.body; 

    // Validate if API Key is provided
    // If using Vercel Environment Variable, you would check process.env.GEMINI_API_KEY here
    if (!apiKey) {
        return res.status(400).json({ error: 'Gemini API Key is required. Please set it in your settings.' });
    }

    // Validate if prompt is provided
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    // Validate selected model
    const allowedModels = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro", "models/gemini-pro"];
    // Note: "gemini-2.5-flash" might not be universally available or stable. 
    // Always check the official Gemini API documentation for available models.
    if (!allowedModels.includes(selectedModel)) {
        return res.status(400).json({ error: `Invalid AI model selected: ${selectedModel}. Allowed models: ${allowedModels.join(', ')}.` });
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

        const chatConfig = {
            history: chatHistory,
            generationConfig: {
                maxOutputTokens: 10000000, // Be cautious with such large token limits
            },
        };

        // Add system instruction if provided and not empty
        if (systemInstruction && systemInstruction.trim() !== '') {
            chatConfig.systemInstruction = systemInstruction;
        }

        const chat = model.startChat(chatConfig);

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

        if (error.message.includes('API key not valid') || error.message.includes('invalid credentials')) {
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
            errorMessage = `Content generation blocked: ${error.message}. This might be due to safety settings or content policy violations.`;
        } else if (error.name === 'AbortError') {
             statusCode = 400; // Client-side abortion
             errorMessage = 'Request aborted by client.';
        }
        
        // If an error occurs during streaming, send JSON error before ending
        if (!res.headersSent) {
            res.status(statusCode).json({ error: errorMessage });
        } else {
            // If headers already sent (meaning some chunks were sent), log and just end
            console.error('Error after headers sent (response might be incomplete):', errorMessage);
            res.end();
        }
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
