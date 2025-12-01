import { getGameState, updateGameState } from '../../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { participantId } = req.body;
        
        if (!participantId) {
            return res.status(400).json({ error: 'Participant ID is required' });
        }

        const state = await getGameState();

        if (state.status !== 'VOTING') {
            return res.status(400).json({ error: 'Voting is not active' });
        }

        if (!state.participants[participantId]) {
            return res.status(404).json({ error: 'Participant not found' });
        }

        const newParticipants = {
            ...state.participants,
            [participantId]: {
                ...state.participants[participantId],
                votes: (state.participants[participantId].votes || 0) + 1,
            }
        };

        const newState = await updateGameState({
            participants: newParticipants,
        });

        return res.status(200).json({ success: true, gameState: newState });
    } catch (error) {
        console.error('[API] Error casting vote:', error);
        return res.status(500).json({ error: 'Failed to cast vote' });
    }
}

