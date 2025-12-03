import { admin, initFirebase } from '../../lib/firebaseAdmin';

export const config = {
    runtime: 'nodejs',
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Ensure Firebase is initialized
        initFirebase();

        // Get database instance
        const db = admin.database();
        console.log('[Session Closure] Database initialized successfully');

        const dbRef = db.ref();

        // Get current game state
        const gameStateSnapshot = await dbRef.child('gameState').once('value');
        const gameState = gameStateSnapshot.val() || {};
        const currentSessionId = gameState.sessionId || 'legacy';

        // Get all history entries
        // Keep ALL rounds in database - they will be filtered by sessionId in the admin panel
        // Only delete truly legacy rounds (without sessionId or with 'legacy' sessionId) that are NOT from current session
        const historySnapshot = await dbRef.child('history').once('value');
        const history = historySnapshot.val() || {};
        const updates = {};
        let deletedRoundCount = 0;

        // Delete only legacy rounds that are NOT from current session
        // Rounds from current session will remain in database but won't be shown in new session due to sessionId filter
        Object.entries(history).forEach(([roundId, roundData]) => {
            if (roundData) {
                // Delete only if it's a legacy round (no sessionId or 'legacy') AND it's not from current session
                const isLegacy = !roundData.sessionId || roundData.sessionId === 'legacy';
                const isFromCurrentSession = roundData.sessionId === currentSessionId;

                if (isLegacy && !isFromCurrentSession) {
                    updates[`history/${roundId}`] = null; // Delete by setting to null
                    deletedRoundCount++;
                    console.log(`[Session Closure] Deleting legacy round ${roundId} from history`);
                }
            }
        });

        // Generate new session ID
        const newSessionId = `session-${Date.now()}`;

        // Reset game state to initial values with new session ID
        const resetState = {
            sessionId: newSessionId,
            round: 0,
            theme: '',
            status: 'IDLE',
            timer: 60,
            duration: 60,
            votingTimer: 120,
            expectedParticipantCount: 2,
            validTokens: null,
            startTime: 0
        };

        // Clear participants and update game state
        updates['gameState'] = resetState;
        updates['participants'] = null;

        // Apply all updates at once
        await dbRef.update(updates);

        console.log(`[Session Closure] Session closed. New session ID: ${newSessionId}. Deleted ${deletedRoundCount} round(s) from previous session(s).`);

        return res.status(200).json({
            success: true,
            message: 'Session closed successfully',
            newSessionId: newSessionId,
            deletedRoundCount: deletedRoundCount
        });

    } catch (error) {
        console.error('[Session Closure] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            details: error instanceof Error ? error.message : String(error)
        });
    }
}
