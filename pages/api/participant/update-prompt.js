import { getGameState, updateGameState } from '../../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { participantId, prompt } = req.body;
        
        if (!participantId) {
            return res.status(400).json({ error: 'Participant ID is required' });
        }

        const state = await getGameState();

        if (!state.participants[participantId]) {
            return res.status(404).json({ error: 'Participant not found' });
        }

        if (state.status !== 'WRITING') {
            return res.status(400).json({ error: 'Not in writing phase' });
        }

        const newParticipants = {
            ...state.participants,
            [participantId]: {
                ...state.participants[participantId],
                prompt: prompt || '',
            }
        };

        await updateGameState({
            participants: newParticipants,
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[API] Error updating prompt:', error);
        return res.status(500).json({ error: 'Failed to update prompt' });
    }
}

