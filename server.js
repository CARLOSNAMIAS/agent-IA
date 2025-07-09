require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const mongoose = require('mongoose'); // Importar mongoose

const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai'); // Agregado para ChatGPT
const { google } = require('googleapis'); // Importar googleapis
const admin = require('firebase-admin'); // Add this import

// --- Configuración e Inicialización ---
const app = express();
const PORT = 3000;

// Initialize Firebase Admin SDK
// IMPORTANT: You need to set the FIREBASE_SERVICE_ACCOUNT_KEY_PATH environment variable
// to the path of your Firebase service account key JSON file.
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
    const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized.');
} else {
    console.warn('FIREBASE_SERVICE_ACCOUNT_KEY_PATH environment variable not set. Firebase Admin SDK not initialized. Authentication will not work.');
}

// --- Conexión a MongoDB ---
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log('Conectado a MongoDB Atlas'))
        .catch(err => console.error('Error al conectar a MongoDB Atlas:', err));
} else {
    console.warn('MONGODB_URI no está definida en las variables de entorno. La base de datos no se conectará.');
}

// --- API Keys (Guardadas de forma segura en el backend) ---
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; // Cargar la nueva clave

// --- Middlewares ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- Authentication Endpoints ---
// Register a new user
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
        });
        res.status(201).json({ message: 'User created successfully', uid: userRecord.uid });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(400).json({ error: error.message });
    }
});

// Login (Firebase client-side handles this, but we can have a placeholder or server-side verification if needed)
// For now, client-side Firebase handles login and gets the ID token.
// This endpoint is more for demonstration or if you want to verify the token on the server immediately after client login.
app.post('/login', async (req, res) => {
    const { idToken } = req.body; // Expecting ID token from client-side Firebase login
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        res.status(200).json({ message: 'Login successful', uid: decodedToken.uid });
    } catch (error) {
        console.error('Error verifying ID token:', error);
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// Logout (client-side Firebase handles this, no server-side action typically needed unless revoking tokens)
app.post('/logout', async (req, res) => {
    // In a real app, you might revoke the token here if you want to immediately invalidate it.
    // For simplicity, client-side Firebase signOut handles most logout needs.
    res.status(200).json({ message: 'Logout successful (client-side handled)' });
});

// --- Authentication Middleware ---
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        return res.status(401).json({ error: 'No token provided. Unauthorized.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // Attach user info to request
        next();
    } catch (error) {
        console.error('Error verifying authentication token:', error);
        return res.status(403).json({ error: 'Invalid or expired token. Forbidden.' });
    }
};

// --- Inicialización del Modelo Gemini ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Eres un asistente de IA servicial y potente. Tu trabajo es ayudar a los usuarios respondiendo a sus preguntas. Tienes acceso a varias herramientas para obtener información en tiempo real. Debes priorizar el uso de estas herramientas siempre que una pregunta del usuario pueda ser respondida por una de ellas. No dudes en utilizar tus herramientas.",
});

// --- Inicialización del Cliente OpenAI ---
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Inicialización del Cliente de YouTube ---
const youtube = google.youtube({
    version: 'v3',
    auth: YOUTUBE_API_KEY
});

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

const searchFlights = async ({ origin, destination, date }) => {
    console.log(`Llamando a searchFlights con: ${origin}, ${destination}, ${date}`);
    const TRAVELPAYOUTS_API_URL = `http://api.travelpayouts.com/v1/prices/cheap?origin=${origin}&destination=${destination}&depart_date=${date}&token=f786cfdad70ef527f29c0c2a87c33698`;

    try {
        const response = await fetch(TRAVELPAYOUTS_API_URL);
        const data = await response.json();

        if (!data.success || Object.keys(data.data).length === 0) {
            return JSON.stringify({ result: `No encontré vuelos de ${origin} a ${destination} para la fecha ${date}.` });
        }

        const flight = Object.values(data.data)[0];
        const result = {
            price: flight.price,
            airline: flight.airline,
            flight_number: flight.flight_number,
            departure_at: flight.departure_at,
            return_at: flight.return_at,
            expires_at: flight.expires_at
        };

        return JSON.stringify({ result });

    } catch (error) {
        console.error("Error en searchFlights:", error);
        return JSON.stringify({ error: "Lo siento, tuve un problema al conectar con el servicio de vuelos." });
    }
};

// --- NUEVA HERRAMIENTA DE YOUTUBE ---
const getYouTubeArtistStats = async ({ artistName }) => {
    if (!artistName) {
        return JSON.stringify({ error: "Por favor, especifica un nombre de artista." });
    }
    console.log(`Llamando a getYouTubeArtistStats para el artista: ${artistName}`);

    try {
        // 1. Buscar el ID del canal del artista
        const searchResponse = await youtube.search.list({
            part: 'snippet',
            q: `${artistName} oficial`, // Búsqueda más precisa
            type: 'channel',
            maxResults: 1
        });

        if (searchResponse.data.items.length === 0) {
            return JSON.stringify({ summary: `No encontré un canal de YouTube oficial para "${artistName}".` });
        }

        const channelId = searchResponse.data.items[0].id.channelId;
        const channelTitle = searchResponse.data.items[0].snippet.title;

        // 2. Obtener las estadísticas del canal
        const channelResponse = await youtube.channels.list({
            part: 'statistics,snippet',
            id: channelId
        });

        const stats = channelResponse.data.items[0].statistics;
        const snippet = channelResponse.data.items[0].snippet;

        const result = {
            channelName: channelTitle,
            subscribers: parseInt(stats.subscriberCount).toLocaleString('es-ES'),
            totalViews: parseInt(stats.viewCount).toLocaleString('es-ES'),
            totalVideos: parseInt(stats.videoCount).toLocaleString('es-ES'),
            description: snippet.description.split('\n')[0], // Primera línea de la descripción
            thumbnailUrl: snippet.thumbnails.default.url
        };

        const summary = `El canal oficial de ${result.channelName} en YouTube tiene aproximadamente ${result.subscribers} suscriptores, ${result.totalViews} visualizaciones totales y ${result.totalVideos} videos subidos.`;

        return JSON.stringify({ summary, result });

    } catch (error) {
        console.error("Error en getYouTubeArtistStats:", error.response ? error.response.data : error.message);
        return JSON.stringify({ error: "Lo siento, tuve un problema al conectar con la API de YouTube." });
    }
};

const tools = {
    getWeather,
    getNews,
    searchWikipedia,
    searchDeezer,
    searchFlights,
    getYouTubeArtistStats // Añadir la nueva herramienta
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

// --- Importar el modelo de Conversación ---
const Conversacion = require('./models/Conversacion');

// --- Endpoint Principal del Chat (Ahora con Gemini) ---
app.post('/chat', authenticateToken, async (req, res) => {
    const { message, history } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'No se proporcionó ningún mensaje.' });
    }

    // Traer últimas 5 conversaciones del usuario
    let historialGuardado = [];
    try {
        const conversaciones = await Conversacion.find({ uid: req.user.uid })
            .sort({ timestamp: -1 })
            .limit(5)
            .lean();

        // Convertir a formato de historial Gemini
        conversaciones.reverse().forEach(conv => {
            historialGuardado.push(
                { role: 'user', parts: [{ text: conv.mensaje_usuario }] },
                { role: 'model', parts: [{ text: conv.respuesta_bot }] }
            );
        });
    } catch (error) {
        console.warn('No se pudo recuperar historial del usuario:', error);
    }

    let textResponse;
    let updatedHistory = [...historialGuardado, { role: 'user', parts: [{ text: message }] }];

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
                        },
                        {
                            name: "searchFlights",
                            description: "Busca vuelos baratos entre dos ciudades en una fecha específica.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    origin: { type: "STRING", description: "El código IATA de la ciudad de origen." },
                                    destination: { type: "STRING", description: "El código IATA de la ciudad de destino." },
                                    date: { type: "STRING", description: "La fecha del vuelo en formato YYYY-MM-DD." }
                                },
                                required: ["origin", "destination", "date"]
                            }
                        },
                        // --- AÑADIR LA NUEVA HERRAMIENTA A GEMINI ---
                        {
                            name: "getYouTubeArtistStats",
                            description: "Obtiene estadísticas de un canal de artista en YouTube, como suscriptores y visualizaciones totales.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    artistName: { type: "STRING", description: "El nombre del artista a buscar en YouTube. Por ejemplo, 'Shakira' o 'Coldplay'." }
                                },
                                required: ["artistName"]
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

    // --- Guardar la conversación en MongoDB ---
    try {
        const nuevaConversacion = new Conversacion({
            uid: req.user.uid,
            mensaje_usuario: message,
            respuesta_bot: textResponse,
            fuente: textResponse.includes('Gemini') ? 'Gemini' : 'ChatGPT'
        });

        await nuevaConversacion.save();
        console.log('Conversación guardada en MongoDB');
    } catch (error) {
        console.error('Error al guardar la conversación:', error);
    }

    res.json({ response: textResponse, history: updatedHistory });
});

// --- Iniciar el Servidor ---
app.get('/', authenticateToken, (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => {
    console.log(`Servidor del chatbot (con Gemini y Wikipedia) escuchando en http://localhost:${PORT}`);
});