// API route per gestire eventi del gioco (POST per azioni)
import { getGameState, updateGameState, addParticipant, updateParticipant, setGameState, setOnTimerZeroCallback } from '../../lib/game-state';
import { broadcastEvent } from './game-stream';

// Configura il callback per triggerare la generazione quando il timer arriva a 0
setOnTimerZeroCallback(async (state) => {
    console.log('[GameEvents] Timer reached zero, triggering generation automatically');
    await triggerGeneration(state);
    // Broadcast lo stato aggiornato
    broadcastEvent('state:update', getGameState());
});

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
                newState = updateGameState({ 
                    status: 'GENERATING',
                    isTimerRunning: false,
                    timerStartTime: null
                });
                shouldBroadcastState = true;
                // Trigger generazione in background (non bloccante)
                triggerGeneration(newState).catch(err => {
                    console.error('[GameEvents] Generation error:', err);
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
                if (!state.validTokens || !state.validTokens.includes(data.token)) {
                    return res.status(400).json({ error: 'INVALID TOKEN' });
                }
                const existing = Object.values(state.participants).find(p => p.token === data.token);
                if (existing && existing.id !== socketId) {
                    return res.status(400).json({ error: 'TOKEN ALREADY IN USE' });
                }
                const palette = ['#BEFA4F', '#E83399', '#5AA7B9', '#F5B700'];
                const participantIndex = Object.keys(state.participants).length;
                const assignedColor = palette[participantIndex % palette.length];
                newState = addParticipant(socketId, {
                    id: socketId,
                    token: data.token,
                    name: data.name || `Player ${participantIndex + 1}`,
                    prompt: '',
                    image: null,
                    votes: 0,
                    color: assignedColor
                });
                // Check if all expected participants joined
                if (Object.keys(newState.participants).length === newState.expectedParticipantCount && newState.status === 'WAITING_FOR_PLAYERS') {
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
                    newState = updateParticipant(socketId, { prompt: data.prompt });
                    // Emit prompt update to screen room
                    console.log('[GameEvents] Broadcasting prompt:update for', socketId, 'prompt length:', data.prompt?.length);
                    broadcastEvent('prompt:update', { id: socketId, prompt: data.prompt });
                    
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
    return tokens;
}

// Funzione per triggerare la generazione (non bloccante)
async function triggerGeneration(state) {
    const Replicate = require('replicate');
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    const participants = Object.values(state.participants);
    
    for (const p of participants) {
        if (p.prompt && p.prompt.trim() !== '') {
            try {
                let prediction = await replicate.predictions.create({
                    model: "google/nano-banana-pro",
                    input: {
                        prompt: p.prompt,
                        num_inference_steps: 25,
                        guidance_scale: 7.5
                    }
                });

                while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    prediction = await replicate.predictions.get(prediction.id);
                }

                if (prediction.status === 'succeeded') {
                    const { updateParticipant } = require('../../lib/game-state');
                    updateParticipant(p.id, { image: prediction.output });
                }
            } catch (error) {
                console.error(`[GameEvents] Error generating for ${p.name}:`, error);
            }
        }
    }
}

