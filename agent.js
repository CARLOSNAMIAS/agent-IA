class AIBot {
    constructor() {
        this.messagesContainer = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
        this.voiceStatus = document.getElementById('voiceStatus');
        this.welcomeMessageContainer = document.getElementById('welcomeMessage');
        this.suggestionChipsContainer = document.getElementById('suggestionChips');

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

        // La única tarea es llamar al backend
        this.chatHistory.push({ role: 'user', parts: [{ text: message }] });
        console.log('Historial de chat antes de enviar:', this.chatHistory);
        const { response, history } = await this.getBotResponseFromServer(message);
        this.chatHistory = history;
        console.log('Historial de chat después de recibir:', this.chatHistory);

        this.hideTypingIndicator();
        this.addMessage(response, 'bot');
        if (wasVoiceMessage) {
            this.speak(response);
        }
    }

    // ¡NUEVA FUNCIÓN! Habla con nuestro servidor
    async getBotResponseFromServer(message) {
        try {
            const response = await fetch('http://localhost:3000/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message, history: this.chatHistory })
            });

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

    addMessage(data, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';

        let messageText = data;

        // Comprobar si la respuesta es un objeto con una propiedad 'result' (de Deezer)
        if (sender === 'bot' && typeof data === 'object' && data.result && data.result.title) {
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
            messageText = `Canción: ${song.title} de ${song.artist}`; // Para el historial
        } else {
            // Si no, es texto plano
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

document.addEventListener('DOMContentLoaded', () => {
    new AIBot();
});
