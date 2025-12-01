import { updateGameState, addLog } from '../../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const newState = await updateGameState({
            status: 'VOTING',
            votingTimer: 120,
            votingTimerStartTime: Date.now(),
        });

        await addLog({ msg: '🗳 Voting started', type: 'info' });

        return res.status(200).json(newState);
    } catch (error) {
        console.error('[API] Error starting voting:', error);
        return res.status(500).json({ error: 'Failed to start voting' });
    }
}

