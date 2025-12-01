import { getGameState, updateGameState, addLog } from '../../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { token, name, participantId } = req.body;
        
        if (!token || !name) {
            return res.status(400).json({ error: 'Token and name are required' });
        }

        const state = await getGameState();

        // Validate token
        if (!state.validTokens.includes(token.toUpperCase())) {
            return res.status(400).json({ error: 'INVALID TOKEN' });
        }

        // Check if token is already used
        const existingParticipant = Object.values(state.participants).find(p => p.token === token.toUpperCase());
        if (existingParticipant && existingParticipant.id !== participantId) {
            return res.status(400).json({ error: 'TOKEN ALREADY IN USE' });
        }

        // Generate participant ID if not provided
        const id = participantId || `participant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const palette = ['#BEFA4F', '#E83399', '#5AA7B9', '#F5B700'];
        const participantIndex = Object.keys(state.participants).length;
        const assignedColor = palette[participantIndex % palette.length];

        const newParticipants = {
            ...state.participants,
            [id]: {
                id,
                token: token.toUpperCase(),
                name: name.trim(),
                prompt: existingParticipant?.prompt || '',
                image: existingParticipant?.image || null,
                votes: existingParticipant?.votes || 0,
                color: existingParticipant?.color || assignedColor,
            }
        };

        // Check if all expected participants have joined
        let newStatus = state.status;
        let isTimerRunning = state.isTimerRunning;
        let timerStartTime = state.timerStartTime;
        
        if (Object.keys(newParticipants).length === state.expectedParticipantCount && state.status === 'WAITING_FOR_PLAYERS') {
            newStatus = 'WRITING';
            isTimerRunning = true;
            timerStartTime = Date.now();
            await addLog({ msg: '✅ All participants joined, starting timer', type: 'success' });
        }

        const newState = await updateGameState({
            participants: newParticipants,
            status: newStatus,
            isTimerRunning,
            timerStartTime,
        });

        await addLog({ msg: `👤 ${name} joined (${token.toUpperCase()})`, type: 'info' });

        return res.status(200).json({
            success: true,
            participant: newState.participants[id],
            gameState: newState,
        });
    } catch (error) {
        console.error('[API] Error joining participant:', error);
        return res.status(500).json({ error: 'Failed to join' });
    }
}

