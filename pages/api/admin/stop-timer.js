import { updateGameState, addLog } from '../../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const newState = await updateGameState({
            isTimerRunning: false,
        });

        await addLog({ msg: '⏸ Timer stopped', type: 'info' });

        return res.status(200).json(newState);
    } catch (error) {
        console.error('[API] Error stopping timer:', error);
        return res.status(500).json({ error: 'Failed to stop timer' });
    }
}

