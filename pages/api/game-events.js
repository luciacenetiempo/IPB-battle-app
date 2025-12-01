// API route per gestire eventi del gioco (POST per azioni, GET per polling)
import { getGameState, updateGameState, addParticipant, updateParticipant, setGameState } from '../../lib/game-state';

// Store per eventi in attesa (polling)
const pendingEvents = new Map(); // socketId -> array di eventi

export default async function handler(req, res) {
    const { method } = req;
    const { action, socketId, data } = req.body || {};

    if (method === 'GET') {
        // Polling per eventi
        const { socketId: pollSocketId } = req.query;
        if (!pollSocketId) {
            return res.status(400).json({ error: 'socketId required' });
        }

        const events = pendingEvents.get(pollSocketId) || [];
        pendingEvents.set(pollSocketId, []); // Clear events after reading

        return res.status(200).json({ events, state: getGameState() });
    }

    if (method === 'POST') {
        if (!action || !socketId) {
            return res.status(400).json({ error: 'action and socketId required' });
        }

        const state = getGameState();
        let newState = state;
        let broadcastEvent = null;

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
                broadcastEvent = { type: 'state:update', data: newState };
                break;

            case 'admin:stop_timer':
                newState = updateGameState({ 
                    isTimerRunning: false,
                    timerStartTime: null
                });
                broadcastEvent = { type: 'state:update', data: newState };
                break;

            case 'admin:trigger_generation':
                // La generazione viene gestita in un endpoint separato
                // Qui aggiorniamo solo lo stato
                newState = updateGameState({ 
                    status: 'GENERATING',
                    isTimerRunning: false,
                    timerStartTime: null
                });
                broadcastEvent = { type: 'state:update', data: newState };
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
                broadcastEvent = { type: 'state:update', data: newState };
                break;

            case 'participant:join':
                if (!state.validTokens.includes(data.token)) {
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
                    newState = updateGameState({ 
                        status: 'WRITING', 
                        isTimerRunning: true,
                        timerStartTime: Date.now()
                    });
                }
                broadcastEvent = { type: 'participant:joined', data: { id: socketId, name: newState.participants[socketId].name, color: assignedColor } };
                break;

            case 'participant:update_prompt':
                if (state.participants[socketId] && state.status === 'WRITING') {
                    newState = updateParticipant(socketId, { prompt: data.prompt });
                    broadcastEvent = { type: 'prompt:update', data: { id: socketId, prompt: data.prompt } };
                }
                break;

            case 'vote:cast':
                if (state.status === 'VOTING' && state.participants[data.participantId]) {
                    const participant = state.participants[data.participantId];
                    newState = updateParticipant(data.participantId, { votes: participant.votes + 1 });
                    broadcastEvent = { type: 'state:update', data: newState };
                }
                break;

            default:
                return res.status(400).json({ error: 'Unknown action' });
        }

        // Broadcast event to all clients
        if (broadcastEvent) {
            pendingEvents.forEach((events, id) => {
                if (id !== socketId) {
                    events.push(broadcastEvent);
                }
            });
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

