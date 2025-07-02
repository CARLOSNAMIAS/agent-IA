require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai'); // Agregado para ChatGPT

// --- Configuración e Inicialización ---
const app = express();
const PORT = 3000;

// --- API Keys (Guardadas de forma segura en el backend) ---
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;         
// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- Inicialización del Modelo Gemini ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Renombrado a geminiModel

// --- Inicialización del Cliente OpenAI ---
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Herramientas que el Bot puede usar ---

const getWeather = async ({ city } = {}) => {
    if (!city) {
        return JSON.stringify({ error: "Por favor, especifica una ciudad." });
    }
    console.log(`Llamando a getWeather para la ciudad: ${city}`);
    const WEATHER_API_URL = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${WEATHER_API_KEY}&units=metric&lang=es`;

    try {
        const response = await fetch(WEATHER_API_URL);
        const data = await response.json();

        if (data.cod !== 200) {
            return JSON.stringify({ error: data.message || `No encontré el clima para "${city}".` });
        }

        const result = {
            city: data.name,
            temperature: data.main.temp,
            description: data.weather[0].description,
            humidity: data.main.humidity
        };

        return JSON.stringify({ result });

    } catch (error) {
        console.error("Error en getWeather:", error);
        return JSON.stringify({ error: "Lo siento, tuve un problema al conectar con el servicio del clima." });
    }
};

const getNews = async ({ topic } = {}) => {
    if (!topic) {
        return JSON.stringify({ error: "Por favor, especifica un tema para las noticias." });
    }
    console.log(`Llamando a getNews para el tema: ${topic}`);
    const NEWS_API_URL = `https://newsapi.org/v2/top-headlines?q=${topic}&apiKey=${NEWS_API_KEY}&pageSize=3&language=es`;

    try {
        const response = await fetch(NEWS_API_URL);
        const data = await response.json();

        if (data.status !== 'ok' || data.articles.length === 0) {
            return JSON.stringify({ summary: `No encontré noticias sobre "${topic}".` });
        }

        const articles = data.articles.map(article => ({
            title: article.title,
            source: article.source.name,
            url: article.url
        }));

        const summary = `Aquí tienes las 3 noticias principales sobre "${topic}":\n` +
                        articles.map((a, i) => `${i + 1}. ${a.title} (Fuente: ${a.source.name})`).join('\n');


        return JSON.stringify({ summary, articles });

    } catch (error) {
        console.error("Error en getNews:", error);
        return JSON.stringify({ error: "Lo siento, tuve un problema al conectar con el servicio de noticias." });
    }
};

const searchWikipedia = async ({ topic } = {}) => {
    console.log(`Llamando a searchWikipedia para el tema: ${topic}`);
    const WIKI_API_URL = 'https://es.wikipedia.org/w/api.php';

    try {
        // 1. Buscar el título del artículo más relevante
        const searchParams = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: topic,
            format: 'json',
            origin: '*',
        });
        const searchResponse = await fetch(`${WIKI_API_URL}?${searchParams}`);
        const searchData = await searchResponse.json();

        if (!searchData.query.search.length) {
            return JSON.stringify({ summary: `No encontré nada en Wikipedia sobre "${topic}".` });
        }
        const pageTitle = searchData.query.search[0].title;

        // 2. Obtener el resumen (extracto) de ese artículo
        const extractParams = new URLSearchParams({
            action: 'query',
            prop: 'extracts',
            exintro: true,
            explaintext: true,
            titles: pageTitle,
            format: 'json',
            redirects: 1,
            origin: '*',
        });
        const extractResponse = await fetch(`${WIKI_API_URL}?${extractParams}`);
        const extractData = await extractResponse.json();
        const pages = extractData.query.pages;
        const pageId = Object.keys(pages)[0];
        const summary = pages[pageId].extract;

        return JSON.stringify({ summary: summary || `Encontré un artículo sobre "${pageTitle}", pero no pude extraer un resumen.` });

    } catch (error) {
        console.error("Error en searchWikipedia:", error);
        return JSON.stringify({ error: "Lo siento, tuve un problema al conectar con Wikipedia." });
    }
};

const searchDeezer = async ({ query }) => {
    console.log(`Llamando a searchDeezer para la consulta: ${query}`);
    const DEEZER_API_URL = 'https://api.deezer.com/search';

    try {
        const searchParams = new URLSearchParams({ q: query });
        const response = await fetch(`${DEEZER_API_URL}?${searchParams}`);
        const data = await response.json();

        if (!data.data || data.data.length === 0) {
            return JSON.stringify({ result: `No encontré ninguna canción llamada "${query}" en Deezer.` });
        }

        const track = data.data[0];
        const result = {
            title: track.title,
            artist: track.artist.name,
            album: track.album.title,
            link: track.link,
            cover: track.album.cover_medium
        };

        return JSON.stringify({ result });

    } catch (error) {
        console.error("Error en searchDeezer:", error);
        return JSON.stringify({ error: "Lo siento, tuve un problema al conectar con Deezer." });
    }
};

const tools = {
    getWeather,
    getNews,
    searchWikipedia,
    searchDeezer
};

// --- Función de reintento con retroceso exponencial ---
async function retryWithBackoff(apiCall, maxRetries = 5, initialDelay = 1000) {
    let retries = 0;
    let delay = initialDelay;

    while (retries < maxRetries) {
        try {
            return await apiCall();
        } catch (error) {
            if (error.name === 'GoogleGenerativeAIFetchError' && error.message.includes('429 Too Many Requests')) {
                console.warn(`Received 429 Too Many Requests. Retrying in ${delay / 1000} seconds... (Attempt ${retries + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Retroceso exponencial
                retries++;
            } else {
                throw error; // Relanzar otros errores inmediatamente
            }
        }
    }
    throw new Error(`Failed after ${maxRetries} retries due to 429 Too Many Requests.`);
}

// --- Endpoint Principal del Chat (Ahora con Gemini) ---
// --- Endpoint Principal del Chat (Ahora con Gemini) ---
app.post('/chat', async (req, res) => {
    const { message, history } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'No se proporcionó ningún mensaje.' });
    }

    let textResponse;
    let updatedHistory = [...(history || []), { role: 'user', parts: [{ text: message }] }];

    try {
        console.log('Intentando con Gemini...');
        const chat = geminiModel.startChat({
            tools: [
                {
                    functionDeclarations: [
                        {
                            name: "getWeather",
                            description: "Obtiene el clima actual para una ciudad específica.",
                            parameters: { type: "OBJECT", properties: { city: { type: "STRING", description: "La ciudad para la cual obtener el clima." } }, required: ["city"] }
                        },
                        {
                            name: "getNews",
                            description: "Obtiene los 3 titulares de noticias más relevantes sobre un tema específico.",
                            parameters: { type: "OBJECT", properties: { topic: { type: "STRING", description: "El tema sobre el cual buscar noticias." } }, required: ["topic"] }
                        },
                        {
                            name: "searchWikipedia",
                            description: "Busca un resumen de un tema o concepto en Wikipedia en español.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    topic: { type: "STRING", description: "El tema o concepto a buscar, por ejemplo, 'Agujero negro' o 'Albert Einstein'." }
                                },
                                required: ["topic"]
                            }
                        },
                        {
                            name: "searchDeezer",
                            description: "Busca una canción en Deezer por su título.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    query: { type: "STRING", description: "El título de la canción a buscar." }
                                },
                                required: ["query"]
                            }
                        }
                    ]
                }
            ],
            history: history || []
        });

        const result = await retryWithBackoff(() => chat.sendMessage(message));
        const call = result.response.functionCalls()?.[0];

        if (call) {
            console.log('Gemini decidió llamar a una herramienta:', call.name, 'con argumentos:', call.args);
            const apiResponse = await tools[call.name](call.args);
            const result2 = await retryWithBackoff(() => chat.sendMessage([
                { functionResponse: { name: call.name, response: JSON.parse(apiResponse) } }
            ]));
            textResponse = result2.response.text();
        } else {
            textResponse = result.response.text();
        }
        updatedHistory.push({ role: 'model', parts: [{ text: textResponse }] });

    } catch (geminiError) {
        console.error('Error con Gemini, intentando con ChatGPT:', geminiError);
        // Fallback a ChatGPT
        try {
            const chatGPTMessages = updatedHistory.map(entry => ({
                role: entry.role === 'user' ? 'user' : 'assistant',
                content: entry.parts[0].text
            }));

            const chatCompletion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: chatGPTMessages,
            });
            textResponse = chatCompletion.choices[0].message.content;
            updatedHistory.push({ role: 'model', parts: [{ text: textResponse }] });

        } catch (chatGPTError) {
            console.error('Error también con ChatGPT:', chatGPTError);
            textResponse = "Lo siento, tanto Gemini como ChatGPT están teniendo problemas en este momento. Por favor, inténtalo de nuevo más tarde.";
        }
    }

    res.json({ response: textResponse, history: updatedHistory });
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor del chatbot (con Gemini y Wikipedia) escuchando en http://localhost:${PORT}`);
});