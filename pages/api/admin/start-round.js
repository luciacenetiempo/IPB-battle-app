import { getGameState, updateGameState, addLog } from '../../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { theme, timer, participantCount } = req.body;
        
        if (!theme || !theme.trim()) {
            return res.status(400).json({ error: 'Theme is required' });
        }

        const currentState = await getGameState();
        
        // Generate unique tokens for participants
        const count = participantCount || 2;
        const validTokens = [];
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
        for (let i = 0; i < count; i++) {
            let token = '';
            for (let j = 0; j < 4; j++) {
                token += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            validTokens.push(token);
        }

        const newState = await updateGameState({
            round: currentState.round + 1,
            theme: theme.trim(),
            timer: timer || 60,
            timerStartTime: null,
            isTimerRunning: false,
            status: 'WAITING_FOR_PLAYERS',
            participants: {},
            validTokens,
            expectedParticipantCount: count,
            votingTimer: 120,
            votingTimerStartTime: null,
        });

        await addLog({ msg: `🚀 Round ${newState.round} started: ${theme}`, type: 'info' });

        return res.status(200).json(newState);
    } catch (error) {
        console.error('[API] Error starting round:', error);
        return res.status(500).json({ error: 'Failed to start round' });
    }
}

