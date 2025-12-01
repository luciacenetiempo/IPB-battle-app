// API client to replace Socket.io for Vercel compatibility

const API_BASE = '';

// Game state polling
export const pollGameState = async () => {
    try {
        const response = await fetch(`${API_BASE}/api/game-state`);
        if (!response.ok) {
            throw new Error('Failed to fetch game state');
        }
        return await response.json();
    } catch (error) {
        console.error('[API] Error polling game state:', error);
        throw error;
    }
};

// Admin APIs
export const adminStartRound = async (data) => {
    const response = await fetch(`${API_BASE}/api/admin/start-round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start round');
    }
    return await response.json();
};

export const adminStopTimer = async () => {
    const response = await fetch(`${API_BASE}/api/admin/stop-timer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to stop timer');
    }
    return await response.json();
};

export const adminTriggerGeneration = async () => {
    const response = await fetch(`${API_BASE}/api/admin/trigger-generation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to trigger generation');
    }
    return await response.json();
};

export const adminStartVoting = async () => {
    const response = await fetch(`${API_BASE}/api/admin/start-voting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start voting');
    }
    return await response.json();
};

export const adminGetLogs = async () => {
    const response = await fetch(`${API_BASE}/api/admin/logs`);
    if (!response.ok) {
        throw new Error('Failed to get logs');
    }
    return await response.json();
};

// Participant APIs
export const participantJoin = async (data) => {
    const response = await fetch(`${API_BASE}/api/participant/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to join');
    }
    return await response.json();
};

export const participantUpdatePrompt = async (participantId, prompt) => {
    const response = await fetch(`${API_BASE}/api/participant/update-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, prompt }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update prompt');
    }
    return await response.json();
};

// Vote APIs
export const voteCast = async (participantId) => {
    const response = await fetch(`${API_BASE}/api/vote/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cast vote');
    }
    return await response.json();
};

