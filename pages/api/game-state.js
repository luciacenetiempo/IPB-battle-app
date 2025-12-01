import { getGameState, calculateRemainingTime } from '../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let state = await getGameState();
        // Calculate remaining time based on timestamps
        state = calculateRemainingTime(state);
        
        // Auto-trigger generation if timer reached 0
        if (state.status === 'WRITING' && state.timer === 0 && state.isTimerRunning) {
            // This will be handled by the client or a separate endpoint
            // For now, just update the state
            const { updateGameState } = await import('../../lib/redis');
            state.isTimerRunning = false;
            await updateGameState({ isTimerRunning: false });
        }
        
        return res.status(200).json(state);
    } catch (error) {
        console.error('[API] Error getting game state:', error);
        return res.status(500).json({ error: 'Failed to get game state' });
    }
}

