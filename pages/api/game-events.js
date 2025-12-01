// API route per gestire eventi del gioco (POST per azioni)
import { getGameState, updateGameState, addParticipant, updateParticipant, setGameState, setOnTimerZeroCallback } from '../../lib/game-state';
import { broadcastEvent } from './game-stream';

// Helper per inviare log al pannello admin
function sendAdminLog(msg, type = 'info') {
    const log = {
        timestamp: new Date().toLocaleTimeString('it-IT'),
        msg: msg,
        type: type
    };
    broadcastEvent('admin:log', log);
    console.log(`[AdminLog] [${type.toUpperCase()}] ${msg}`);
}

// Funzione per triggerare la generazione (non bloccante)
async function triggerGeneration(state) {
    const Replicate = require('replicate');
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    const participants = Object.values(state.participants);
    const participantsWithPrompts = participants.filter(p => p.prompt && p.prompt.trim() !== '');
    
    if (participantsWithPrompts.length === 0) {
        sendAdminLog('⚠️ Nessun prompt disponibile per la generazione', 'warning');
        return;
    }

    sendAdminLog(`🚀 Avvio generazione immagini per ${participantsWithPrompts.length} partecipante/i...`, 'info');
    
    for (const p of participantsWithPrompts) {
        try {
            sendAdminLog(`📝 Inizio generazione per ${p.name}: "${p.prompt.substring(0, 50)}${p.prompt.length > 50 ? '...' : ''}"`, 'info');
            
            const startTime = Date.now();
            let prediction = await replicate.predictions.create({
                model: "black-forest-labs/flux-2-dev",
                input: {
                    prompt: p.prompt.trim(),
                    aspect_ratio: '1:1',
                    output_format: 'webp',
                    output_quality: 90
                }
            });

            sendAdminLog(`⏳ Predizione creata per ${p.name} (ID: ${prediction.id.substring(0, 8)}...)`, 'info');

            let pollCount = 0;
            while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
                await new Promise(resolve => setTimeout(resolve, 2000));
                prediction = await replicate.predictions.get(prediction.id);
                pollCount++;
                
                if (pollCount % 5 === 0) { // Log ogni 10 secondi (5 poll * 2s)
                    sendAdminLog(`⏳ ${p.name}: generazione in corso... (${prediction.status}, tentativo ${pollCount})`, 'info');
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);

            if (prediction.status === 'succeeded') {
                const { updateParticipant } = require('../../lib/game-state');
                const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
                updateParticipant(p.id, { image: imageUrl });
                sendAdminLog(`✅ Immagine generata con successo per ${p.name} (${duration}s)`, 'success');
            } else {
                sendAdminLog(`❌ Generazione fallita per ${p.name}: ${prediction.status}`, 'error');
            }
        } catch (error) {
            sendAdminLog(`❌ Errore durante la generazione per ${p.name}: ${error.message}`, 'error');
            console.error(`[GameEvents] Error generating for ${p.name}:`, error);
        }
    }
    
    sendAdminLog(`✨ Generazione completata per tutti i partecipanti`, 'success');
}

// Configura il callback per triggerare la generazione quando il timer arriva a 0
setOnTimerZeroCallback(async (state) => {
    console.log('[GameEvents] Timer reached zero callback called, triggering generation automatically');
    sendAdminLog('⏰ Timer scaduto! Avvio generazione automatica (via callback)...', 'info');
    await triggerGeneration(state);
    // Broadcast lo stato aggiornato
    broadcastEvent('state:update', getGameState());
});

console.log('[GameEvents] onTimerZeroCallback configured');

export default async function handler(req, res) {
    const { method } = req;
    const { action, socketId, data } = req.body || {};

    // Solo POST è supportato (SSE gestisce gli aggiornamenti)
    if (method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (method === 'POST') {
        if (!action || !socketId) {
            return res.status(400).json({ error: 'action and socketId required' });
        }

        const state = getGameState();
        let newState = state;
        let shouldBroadcastState = false;

        switch (action) {
            case 'admin:start_round':
                newState = updateGameState({
                    round: state.round + 1,
                    theme: data.theme,
                    status: 'WAITING_FOR_PLAYERS',
                    timer: data.timer || 60,
                    isTimerRunning: false,
                    expectedParticipantCount: data.participantCount || 2,
                    validTokens: generateTokens(data.participantCount || 2),
                    participants: {},
                    timerStartTime: null,
                    votingTimerStartTime: null,
                });
                shouldBroadcastState = true;
                break;

            case 'admin:stop_timer':
                newState = updateGameState({ 
                    isTimerRunning: false,
                    timerStartTime: null
                });
                shouldBroadcastState = true;
                break;

            case 'admin:trigger_generation':
                // La generazione viene gestita in un endpoint separato
                // Qui aggiorniamo solo lo stato
                sendAdminLog('🔧 Generazione avviata manualmente dall\'admin', 'info');
                newState = updateGameState({ 
                    status: 'GENERATING',
                    isTimerRunning: false,
                    timerStartTime: null
                });
                shouldBroadcastState = true;
                // Trigger generazione in background (non bloccante)
                triggerGeneration(newState).catch(err => {
                    console.error('[GameEvents] Generation error:', err);
                    sendAdminLog(`❌ Errore critico durante la generazione: ${err.message}`, 'error');
                });
                break;

            case 'join_room':
                // Su Vercel, le "room" sono gestite tramite socketId
                // Non serve fare nulla, ma emettiamo un evento per compatibilità
                return res.status(200).json({ success: true, state: state });

            case 'admin:start_voting':
                newState = updateGameState({ 
                    status: 'VOTING', 
                    votingTimer: 120,
                    votingTimerStartTime: Date.now()
                });
                shouldBroadcastState = true;
                break;

            case 'participant:join':
                console.log('[GameEvents] participant:join request:', { socketId, token: data.token, name: data.name });
                console.log('[GameEvents] Current state:', { 
                    validTokens: state.validTokens, 
                    participantsCount: Object.keys(state.participants).length,
                    status: state.status,
                    expectedCount: state.expectedParticipantCount
                });
                
                if (!state.validTokens || state.validTokens.length === 0) {
                    console.error('[GameEvents] No valid tokens available');
                    return res.status(400).json({ error: 'NO_TOKENS_AVAILABLE' });
                }
                
                if (!data.token || !state.validTokens.includes(data.token.toUpperCase())) {
                    console.error('[GameEvents] Invalid token:', data.token, 'Valid tokens:', state.validTokens);
                    return res.status(400).json({ error: 'INVALID TOKEN' });
                }
                
                // Normalizza il token a uppercase per il confronto
                const normalizedToken = data.token.toUpperCase();
                const existing = Object.values(state.participants).find(p => p.token === normalizedToken);
                
                if (existing && existing.id !== socketId) {
                    console.error('[GameEvents] Token already in use:', normalizedToken, 'by:', existing.id);
                    return res.status(400).json({ error: 'TOKEN ALREADY IN USE' });
                }
                
                // Se il partecipante esiste già con lo stesso socketId, permettere il rejoin
                if (existing && existing.id === socketId) {
                    console.log('[GameEvents] Participant reconnecting with same socketId');
                    // Aggiorna solo il nome se è cambiato
                    if (data.name && data.name !== existing.name) {
                        newState = updateParticipant(socketId, { name: data.name });
                    } else {
                        newState = state;
                    }
                    shouldBroadcastState = true;
                    broadcastEvent('participant:joined', { id: socketId, name: newState.participants[socketId].name, color: newState.participants[socketId].color });
                    break;
                }
                
                const palette = ['#BEFA4F', '#E83399', '#5AA7B9', '#F5B700'];
                const participantIndex = Object.keys(state.participants).length;
                const assignedColor = palette[participantIndex % palette.length];
                
                console.log('[GameEvents] Adding participant:', { socketId, token: normalizedToken, name: data.name, index: participantIndex });
                
                newState = addParticipant(socketId, {
                    id: socketId,
                    token: normalizedToken,
                    name: data.name || `Player ${participantIndex + 1}`,
                    prompt: '',
                    image: null,
                    votes: 0,
                    color: assignedColor
                });
                
                console.log('[GameEvents] Participant added. New participants count:', Object.keys(newState.participants).length);
                
                // Check if all expected participants joined
                if (Object.keys(newState.participants).length === newState.expectedParticipantCount && newState.status === 'WAITING_FOR_PLAYERS') {
                    console.log('[GameEvents] All participants joined, starting WRITING phase');
                    // Aggiorna lo stato a WRITING con timer
                    const timerStartTime = Date.now();
                    newState = updateGameState({ 
                        status: 'WRITING', 
                        isTimerRunning: true,
                        timerStartTime: timerStartTime
                    });
                    // Forza broadcast immediato dello stato aggiornato
                    broadcastEvent('state:update', newState);
                }
                // Emit both events
                broadcastEvent('participant:joined', { id: socketId, name: newState.participants[socketId].name, color: assignedColor });
                shouldBroadcastState = true;
                break;

            case 'participant:update_prompt':
                if (state.participants[socketId] && state.status === 'WRITING') {
                    // Il data potrebbe essere direttamente il prompt (stringa) o un oggetto con {prompt: ...}
                    const promptValue = typeof data === 'string' ? data : (data.prompt || '');
                    console.log('[GameEvents] participant:update_prompt received:', { socketId, promptType: typeof data, promptLength: promptValue.length, promptPreview: promptValue.substring(0, 50) });
                    
                    newState = updateParticipant(socketId, { prompt: promptValue });
                    // Emit prompt update to screen room - assicurati che il prompt sia sempre incluso
                    const promptUpdateData = {
                        id: socketId,
                        prompt: promptValue
                    };
                    console.log('[GameEvents] Broadcasting prompt:update:', promptUpdateData);
                    broadcastEvent('prompt:update', promptUpdateData);
                    
                    // Emetti sempre state:update con debounce di 200ms per sincronizzazione in tempo reale
                    // Questo è necessario per Vercel serverless dove il broadcast diretto potrebbe non funzionare tra istanze
                    const now = Date.now();
                    const lastBroadcast = gameState._lastPromptBroadcast || 0;
                    const timeSinceLastBroadcast = now - lastBroadcast;
                    
                    if (timeSinceLastBroadcast > 200) {
                        // Broadcast immediato
                        shouldBroadcastState = true;
                        gameState._lastPromptBroadcast = now;
                        newState._lastPromptBroadcast = now;
                    } else {
                        // Programma un broadcast dopo il debounce
                        const delay = 200 - timeSinceLastBroadcast;
                        if (gameState._pendingPromptBroadcast) {
                            clearTimeout(gameState._pendingPromptBroadcast);
                        }
                        gameState._pendingPromptBroadcast = setTimeout(() => {
                            const currentState = getGameState();
                            broadcastEvent('state:update', currentState);
                            gameState._lastPromptBroadcast = Date.now();
                            gameState._pendingPromptBroadcast = null;
                        }, delay);
                    }
                }
                break;

            case 'vote:cast':
                if (state.status === 'VOTING' && state.participants[data.participantId]) {
                    const participant = state.participants[data.participantId];
                    newState = updateParticipant(data.participantId, { votes: participant.votes + 1 });
                    shouldBroadcastState = true;
                }
                break;

            default:
                return res.status(400).json({ error: 'Unknown action' });
        }

        // Broadcast state update to all clients via SSE
        if (shouldBroadcastState) {
            broadcastEvent('state:update', newState);
        }

        return res.status(200).json({ success: true, state: newState });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

function generateTokens(count) {
    const tokens = [];
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < count; i++) {
        let token = '';
        for (let j = 0; j < 4; j++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        tokens.push(token);
    }
    console.log('[GameEvents] Generated tokens:', tokens);
    return tokens;
}


