import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { firebaseConfig } from './firebase-config.js'; // Import your Firebase config

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

class AIBot {
    constructor() {
        this.messagesContainer = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
        this.voiceStatus = document.getElementById('voiceStatus');
        this.welcomeMessageContainer = document.getElementById('welcomeMessage');
        this.suggestionChipsContainer = document.getElementById('suggestionChips');
        this.logoutBtn = document.getElementById('logoutBtn'); // New: Logout button

        this.chatHistory = []; // Initialize chat history

        this.welcomeMessages = [
            "¡Hola! Soy tu asistente de IA. ¿En qué puedo ayudarte hoy?",
            "¡Saludos! Estoy aquí para asistirte. ¿Qué necesitas?",
            "¡Bienvenido! Pregúntame lo que quieras."
        ];

        this.suggestions = [
            { text: '¿Qué puedes hacer? 🤔', message: 'Ayuda' }
        ];

        // Reconocimiento y síntesis de voz
        this.recognition = null;
        this.isRecording = false;
        this.isVoiceMessage = false;
        this.initSpeechRecognition();
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.loadVoices();

        this.init();
    }

    init() {
        this.displayWelcomeMessage();
        this.displaySuggestionChips();
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.voiceBtn.addEventListener('click', () => this.toggleVoiceRecognition());
        if (this.logoutBtn) { // New: Add event listener for logout button
            this.logoutBtn.addEventListener('click', () => this.logout());
        }

        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        this.messageInput.addEventListener('input', () => {
            this.sendBtn.disabled = this.messageInput.value.trim() === '';
        });

        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') this.isVoiceMessage = false;
        });

        this.sendBtn.disabled = true;

        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.loadVoices();
        }
    }

    displayWelcomeMessage() {
        const welcomeText = this.welcomeMessages[Math.floor(Math.random() * this.welcomeMessages.length)];
        if (this.welcomeMessageContainer) {
            this.welcomeMessageContainer.innerHTML = `${welcomeText}<br><small> Escribe o  habla para interactuar</small>`;
        }
    }

    displaySuggestionChips() {
        this.suggestionChipsContainer.innerHTML = '';
        this.suggestions.forEach(suggestion => {
            const chip = document.createElement('div');
            chip.className = 'suggestion-chip';
            chip.textContent = suggestion.text;
            chip.addEventListener('click', () => {
                this.messageInput.value = suggestion.message;
                this.sendBtn.disabled = false;
                this.sendMessage();
                this.suggestionChipsContainer.style.display = 'none';
            });
            this.suggestionChipsContainer.appendChild(chip);
        });
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;

        this.addMessage(message, 'user');
        this.messageInput.value = '';
        this.sendBtn.disabled = true;
        if (this.suggestionChipsContainer) {
            this.suggestionChipsContainer.style.display = 'none';
        }

        const wasVoiceMessage = this.isVoiceMessage;
        this.isVoiceMessage = false;

        this.showTypingIndicator();

        this.chatHistory.push({ role: 'user', parts: [{ text: message }] });
        console.log('Historial de chat antes de enviar:', this.chatHistory);
        const { response, history } = await this.getBotResponseFromServer(message);
        this.chatHistory = history;
        console.log('Historial de chat después de recibir:', this.chatHistory);

        this.hideTypingIndicator();
        this.addMessage(response, 'bot', wasVoiceMessage);
        if (wasVoiceMessage) {
            this.speak(response);
        }
    }

    async getBotResponseFromServer(message) {
        try {
            const user = auth.currentUser;
            if (!user) {
                console.error('No authenticated user found. Redirecting to login.');
                window.location.href = 'login.html';
                return { response: "Error de autenticación. Por favor, inicia sesión de nuevo.", history: this.chatHistory };
            }

            const idToken = await user.getIdToken(true); // Get fresh ID token

            const response = await fetch('http://localhost:3000/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}` // Include ID token
                },
                body: JSON.stringify({ message, history: this.chatHistory })
            });

            if (response.status === 401 || response.status === 403) {
                console.error('Authentication error from server. Redirecting to login.');
                await signOut(auth); // Sign out the user
                window.location.href = 'login.html';
                return { response: "Tu sesión ha expirado o no estás autorizado. Por favor, inicia sesión de nuevo.", history: this.chatHistory };
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error del servidor (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            return data;

        } catch (error) {
            console.error("Error al conectar con el servidor del bot:", error);
            return { response: "Lo siento, no puedo conectar con mi cerebro en este momento. Asegúrate de que el servidor esté funcionando.", history: this.chatHistory };
        }
    }

    addMessage(data, sender, isVoiceResponse = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';

        if (sender === 'bot' && isVoiceResponse) {
            bubbleDiv.innerHTML = `<img src="img/voice-waveform.gif" alt="Respuesta de voz" class="voice-waveform">`;
            bubbleDiv.classList.add('voice-response');
        } else if (sender === 'bot' && typeof data === 'object' && data.result && data.result.title) {
            const song = data.result;
            bubbleDiv.innerHTML = `
                <div class="song-card">
                    <img src="${song.cover}" alt="Carátula de ${song.album}" class="song-cover">
                    <div class="song-info">
                        <div class="song-title">${song.title}</div>
                        <div class="song-artist">${song.artist}</div>
                        <a href="${song.link}" target="_blank" class="song-link">Escuchar en Deezer</a>
                    </div>
                </div>
            `;
        } else {
            bubbleDiv.innerHTML = data;
        }

        messageDiv.appendChild(bubbleDiv);
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot';
        typingDiv.id = 'typingIndicator';
        typingDiv.innerHTML = `<div class="message-bubble"><div class="typing-indicator" style="display: block;"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>`;
        this.messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    // New: Logout function
    async logout() {
        try {
            await signOut(auth);
            window.location.href = 'login.html'; // Redirect to login page after logout
        } catch (error) {
            console.error('Error during logout:', error);
            alert('Error al cerrar sesión. Por favor, inténtalo de nuevo.');
        }
    }

    // --- Funciones de Voz (sin cambios) ---
    initSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'es-ES';
            this.recognition.onstart = () => { this.isRecording = true; this.voiceBtn.classList.add('recording'); this.voiceStatus.classList.add('show'); this.voiceStatus.textContent = 'Escuchando...'; };
            this.recognition.onresult = (event) => { const transcript = event.results[0][0].transcript; this.messageInput.value = transcript; this.sendBtn.disabled = false; this.voiceStatus.textContent = 'Texto capturado'; this.isVoiceMessage = true; setTimeout(() => this.voiceStatus.classList.remove('show'), 1500); };
            this.recognition.onerror = (event) => { console.error('Error de reconocimiento de voz:', event.error); this.voiceStatus.textContent = 'Error al escuchar'; setTimeout(() => this.voiceStatus.classList.remove('show'), 2000); this.stopRecording(); };
            this.recognition.onend = () => this.stopRecording();
        } else { this.voiceBtn.disabled = true; this.voiceBtn.title = 'Reconocimiento de voz no disponible'; this.voiceBtn.style.opacity = '0.5'; }
    }
    toggleVoiceRecognition() { if (!this.recognition) return; if (this.isRecording) { this.recognition.stop(); } else { this.isVoiceMessage = true; this.recognition.start(); } }
    stopRecording() { this.isRecording = false; this.voiceBtn.classList.remove('recording'); if (!this.voiceStatus.textContent.includes('capturado') && !this.voiceStatus.textContent.includes('Error')) { this.voiceStatus.classList.remove('show'); } }
    speak(text) { if (this.synth.speaking) { console.error('SpeechSynthesis.speaking'); return; } const cleanText = text.replace(/<[^>]*>?/gm, ''); if (cleanText !== '') { const utterThis = new SpeechSynthesisUtterance(cleanText); utterThis.onerror = (event) => console.error('SpeechSynthesisUtterance.onerror', event); const spanishVoice = this.voices.find(voice => voice.name === 'Microsoft Sabina - Spanish (Mexico)') || this.voices[0]; if (spanishVoice) { utterThis.voice = spanishVoice; } utterThis.lang = 'es-ES'; this.synth.speak(utterThis); } }
    loadVoices() { this.voices = this.synth.getVoices().filter(voice => voice.lang.startsWith('es')); if (this.voices.length === 0) { console.warn("No se encontraron voces en español para la síntesis de voz."); } }
}

// Authentication state listener
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is signed in, proceed with the app
        console.log('User is signed in:', user.uid);
        new AIBot(); // Initialize AIBot directly
    } else {
        // User is signed out, redirect to login page
        console.log('User is signed out. Redirecting to login.html');
        window.location.href = 'login.html';
    }
});
