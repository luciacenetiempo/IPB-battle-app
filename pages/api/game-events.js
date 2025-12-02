// API route per gestire eventi del gioco (POST per azioni)
import { getGameState, updateGameState, addParticipant, updateParticipant, updateParticipantBySocketId, getParticipantByToken, getTokenBySocketId, setGameState, setOnTimerZeroCallback } from '../../lib/game-state';
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
                // p.id è ora il token
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
                const tokenCount = data.participantCount || 2;
                const generatedTokens = generateTokens(tokenCount);
                console.log('[GameEvents] Starting round - generating tokens:', generatedTokens);
                sendAdminLog(`🎮 Round ${state.round + 1} avviato - Token generati: ${generatedTokens.join(', ')}`, 'info');
                // Pulisci i sessionSecret vecchi dal localStorage lato client (sarà gestito dal client quando riceve il nuovo stato)
                newState = updateGameState({
                    round: state.round + 1,
                    theme: data.theme,
                    status: 'WAITING_FOR_PLAYERS',
                    timer: data.timer || 60,
                    isTimerRunning: false,
                    expectedParticipantCount: tokenCount,
                    validTokens: generatedTokens,
                    participants: {}, // Questo pulirà anche tutti i sessionSecret esistenti
                    timerStartTime: null,
                    votingTimerStartTime: null,
                    generationTriggered: false, // Reset flag
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
                    validTokensLength: state.validTokens ? state.validTokens.length : 0,
                    participantsCount: Object.keys(state.participants).length,
                    status: state.status,
                    expectedCount: state.expectedParticipantCount,
                    round: state.round
                });
                
                // Se lo stato è IDLE, significa che non è stato ancora avviato un round
                if (state.status === 'IDLE') {
                    console.error('[GameEvents] Cannot join: Game is in IDLE state. A round must be started first.');
                    sendAdminLog('⚠️ Impossibile unirsi: il gioco è in stato IDLE. Avvia prima un round dall\'admin.', 'error');
                    return res.status(400).json({ 
                        error: 'GAME_NOT_STARTED',
                        message: 'Il gioco non è stato ancora avviato. Attendi che l\'admin avvii un round.'
                    });
                }
                
                if (!state.validTokens || state.validTokens.length === 0) {
                    console.error('[GameEvents] No valid tokens available. State:', JSON.stringify({
                        status: state.status,
                        round: state.round,
                        validTokens: state.validTokens,
                        expectedCount: state.expectedParticipantCount
                    }, null, 2));
                    sendAdminLog(`⚠️ Errore: Nessun token disponibile (Status: ${state.status}, Round: ${state.round}). Assicurati di aver avviato un round.`, 'error');
                    return res.status(400).json({ 
                        error: 'NO_TOKENS_AVAILABLE',
                        message: 'Nessun token disponibile. Assicurati che l\'admin abbia avviato un round.',
                        state: {
                            status: state.status,
                            round: state.round
                        }
                    });
                }
                
                if (!data.token || !state.validTokens.includes(data.token.toUpperCase())) {
                    console.error('[GameEvents] Invalid token:', data.token, 'Valid tokens:', state.validTokens);
                    return res.status(400).json({ error: 'INVALID TOKEN' });
                }
                
                // Normalizza il token a uppercase per il confronto
                const normalizedToken = data.token.toUpperCase();
                const existing = getParticipantByToken(normalizedToken);
                const providedSessionSecret = data.sessionSecret || null;
                
                // Se il token esiste già, verifica il sessionSecret per permettere il rejoin
                if (existing) {
                    try {
                        // addParticipant verificherà il sessionSecret
                        console.log(`[GameEvents] Token ${normalizedToken} already exists, attempting rejoin with sessionSecret: ${providedSessionSecret ? 'provided' : 'missing'}`);
                        
                        // Mantieni i dati esistenti (prompt, image, votes) durante il rejoin
                        newState = addParticipant(socketId, {
                            id: normalizedToken, // id è il token
                            token: normalizedToken,
                            name: data.name || existing.name,
                            prompt: existing.prompt || '',
                            image: existing.image || null,
                            votes: existing.votes || 0,
                            color: existing.color,
                            socketId: socketId
                        }, providedSessionSecret);
                        
                        sendAdminLog(`🔄 ${existing.name} si è riconnesso (token: ${normalizedToken})`, 'info');
                        shouldBroadcastState = true;
                        broadcastEvent('participant:joined', { 
                            id: normalizedToken, 
                            token: normalizedToken,
                            name: newState.participants[normalizedToken].name, 
                            color: newState.participants[normalizedToken].color,
                            sessionSecret: newState.participants[normalizedToken].sessionSecret // Invia il sessionSecret al client
                        });
                        break;
                    } catch (error) {
                        if (error.message === 'INVALID_SESSION_SECRET' || error.message === 'SESSION_SECRET_REQUIRED') {
                            console.error(`[GameEvents] Rejoin rejected for token ${normalizedToken}: ${error.message}`);
                            sendAdminLog(`⚠️ Tentativo di rejoin non autorizzato per token ${normalizedToken}`, 'warning');
                            return res.status(403).json({ 
                                error: 'UNAUTHORIZED_REJOIN',
                                message: 'Token già in uso. Non puoi riconnetterti senza la sessione originale.'
                            });
                        }
                        throw error; // Rilancia altri errori
                    }
                }
                
                // Nuovo partecipante
                const palette = ['#BEFA4F', '#E83399', '#5AA7B9', '#F5B700'];
                const participantIndex = Object.keys(state.participants).length;
                const assignedColor = palette[participantIndex % palette.length];
                
                console.log('[GameEvents] Adding new participant:', { socketId, token: normalizedToken, name: data.name, index: participantIndex });
                
                newState = addParticipant(socketId, {
                    id: normalizedToken, // id è il token
                    token: normalizedToken,
                    name: data.name || `Player ${participantIndex + 1}`,
                    prompt: '',
                    image: null,
                    votes: 0,
                    color: assignedColor,
                    socketId: socketId
                });
                
                console.log('[GameEvents] Participant added. New participants count:', Object.keys(newState.participants).length);
                sendAdminLog(`✅ ${data.name || `Player ${participantIndex + 1}`} si è unito (token: ${normalizedToken})`, 'success');
                
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
                // Emit both events - include sessionSecret per il nuovo partecipante
                broadcastEvent('participant:joined', { 
                    id: normalizedToken, 
                    token: normalizedToken,
                    name: newState.participants[normalizedToken].name, 
                    color: assignedColor,
                    sessionSecret: newState.participants[normalizedToken].sessionSecret // Invia il sessionSecret al client
                });
                shouldBroadcastState = true;
                break;

            case 'participant:update_prompt':
                // Ottieni il token dal socketId
                const token = getTokenBySocketId(socketId);
                if (!token) {
                    console.warn(`[GameEvents] Cannot update prompt: socketId ${socketId} not found in token mapping`);
                    return res.status(400).json({ error: 'PARTICIPANT_NOT_FOUND' });
                }
                
                const participant = getParticipantByToken(token);
                if (!participant || state.status !== 'WRITING') {
                    console.warn(`[GameEvents] Cannot update prompt: participant not found or status is not WRITING (status: ${state.status})`);
                    return res.status(400).json({ error: 'INVALID_STATE' });
                }
                
                // Il data potrebbe essere direttamente il prompt (stringa) o un oggetto con {prompt: ...}
                let promptValue;
                if (typeof data === 'string') {
                    promptValue = data;
                } else if (data && typeof data === 'object') {
                    // Se data è un oggetto, estrai la stringa
                    if (typeof data.prompt === 'string') {
                        promptValue = data.prompt;
                    } else if (data.prompt && typeof data.prompt === 'object' && typeof data.prompt.prompt === 'string') {
                        // Gestisce doppio annidamento
                        promptValue = data.prompt.prompt;
                    } else {
                        promptValue = '';
                    }
                } else {
                    promptValue = '';
                }
                
                // Assicurati che promptValue sia sempre una stringa
                promptValue = String(promptValue || '');
                
                console.log('[GameEvents] participant:update_prompt received:', { token, socketId, promptType: typeof data, promptLength: promptValue.length, promptPreview: promptValue.substring(0, 50) });
                
                newState = updateParticipant(token, { prompt: promptValue });
                // Emit prompt update to screen room - usa token come id
                const promptUpdateData = {
                    id: token, // Usa token invece di socketId
                    token: token,
                    prompt: promptValue  // Sempre una stringa
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
                break;

            case 'vote:cast':
                // data.participantId può essere un token o un socketId
                // Prova prima come token, poi come socketId
                let votedParticipant = null;
                let votedToken = null;
                
                if (state.participants[data.participantId]) {
                    // È un token
                    votedParticipant = state.participants[data.participantId];
                    votedToken = data.participantId;
                } else {
                    // Prova come socketId
                    votedToken = getTokenBySocketId(data.participantId);
                    if (votedToken) {
                        votedParticipant = getParticipantByToken(votedToken);
                    }
                }
                
                if (state.status === 'VOTING' && votedParticipant && votedToken) {
                    newState = updateParticipant(votedToken, { votes: (votedParticipant.votes || 0) + 1 });
                    shouldBroadcastState = true;
                    console.log(`[GameEvents] Vote cast for ${votedParticipant.name} (token: ${votedToken}), new votes: ${newState.participants[votedToken].votes}`);
                } else {
                    console.warn(`[GameEvents] Cannot cast vote: participant not found or invalid state (status: ${state.status})`);
                }
                break;

            default:
                return res.status(400).json({ error: 'Unknown action' });
        }

        // Broadcast state update to all clients via SSE
        if (shouldBroadcastState) {
            console.log('[GameEvents] Broadcasting state update, validTokens:', newState.validTokens);
            broadcastEvent('state:update', newState);
        }

        // Assicurati che lo stato restituito includa sempre i token
        const responseState = getGameState();
        console.log('[GameEvents] Returning state with validTokens:', responseState.validTokens);
        return res.status(200).json({ success: true, state: responseState });
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
    console.log('[GameEvents] Generated', count, 'tokens:', tokens);
    return tokens;
}


