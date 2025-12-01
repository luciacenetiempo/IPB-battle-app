// Game State Manager - condiviso tra API routes e server Express
// Questo file gestisce lo stato del gioco in memoria

let gameState = {
    round: 0,
    theme: '',
    timer: 60,
    isTimerRunning: false,
    status: 'IDLE',
    participants: {},
    validTokens: [],
    expectedParticipantCount: 0,
    votingTimer: 120,
    timerStartTime: null, // Timestamp quando il timer è stato avviato
    votingTimerStartTime: null, // Timestamp quando il voting timer è stato avviato
};

// Listeners per notificare cambiamenti di stato
const stateListeners = new Set();

export const getGameState = () => {
    // Calcola il timer rimanente in base al timestamp
    const state = { ...gameState };
    
    if (state.isTimerRunning && state.timerStartTime) {
        const elapsed = Math.floor((Date.now() - state.timerStartTime) / 1000);
        const remaining = Math.max(0, state.timer - elapsed);
        state.timer = remaining;
        
        if (remaining === 0 && state.status === 'WRITING') {
            state.isTimerRunning = false;
            state.status = 'GENERATING';
        }
    }
    
    if (state.status === 'VOTING' && state.votingTimerStartTime) {
        const elapsed = Math.floor((Date.now() - state.votingTimerStartTime) / 1000);
        const remaining = Math.max(0, state.votingTimer - elapsed);
        state.votingTimer = remaining;
        
        if (remaining === 0) {
            state.status = 'ENDED';
        }
    }
    
    return state;
};

export const updateGameState = (updates) => {
    gameState = { ...gameState, ...updates };
    notifyListeners();
    return gameState;
};

export const setGameState = (newState) => {
    gameState = { ...newState };
    notifyListeners();
    return gameState;
};

export const addStateListener = (callback) => {
    stateListeners.add(callback);
    return () => stateListeners.delete(callback);
};

const notifyListeners = () => {
    // Notifica con lo stato calcolato (con timer aggiornato)
    const computedState = getGameState();
    stateListeners.forEach(callback => {
        try {
            callback(computedState);
        } catch (error) {
            console.error('Error in state listener:', error);
        }
    });
};

// Helper per gestire i partecipanti
export const addParticipant = (socketId, participantData) => {
    gameState.participants[socketId] = participantData;
    notifyListeners();
    return gameState;
};

export const removeParticipant = (socketId) => {
    delete gameState.participants[socketId];
    notifyListeners();
    return gameState;
};

export const updateParticipant = (socketId, updates) => {
    if (gameState.participants[socketId]) {
        gameState.participants[socketId] = { ...gameState.participants[socketId], ...updates };
        notifyListeners();
    }
    return gameState;
};

