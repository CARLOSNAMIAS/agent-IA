const mongoose = require('mongoose');

const conversacionSchema = new mongoose.Schema({
    uid: {
        type: String,
        required: true
    },
    mensaje_usuario: {
        type: String,
        required: true
    },
    respuesta_bot: {
        type: String,
        required: true
    },
    fuente: {
        type: String,
        enum: ['Gemini', 'ChatGPT'],
        default: 'Gemini'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Conversacion', conversacionSchema);