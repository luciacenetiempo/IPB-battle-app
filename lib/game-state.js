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
    generationTriggered: false, // Flag per evitare di triggerare la generazione più volte
};

// Listeners per notificare cambiamenti di stato
const stateListeners = new Set();

// Callback per triggerare la generazione quando il timer arriva a 0
let onTimerZeroCallback = null;

export const setOnTimerZeroCallback = (callback) => {
    onTimerZeroCallback = callback;
};

export const getGameState = () => {
    // Calcola il timer rimanente in base al timestamp
    const state = { ...gameState };
    
    if (state.isTimerRunning && state.timerStartTime) {
        const elapsed = Math.floor((Date.now() - state.timerStartTime) / 1000);
        const remaining = Math.max(0, state.timer - elapsed);
        state.timer = remaining;
        
        if (remaining <= 0 && state.status === 'WRITING' && !state.generationTriggered) {
            // Timer arrivato a 0, triggera la generazione
            console.log('[GameState] Timer reached zero in getGameState(), triggering generation');
            state.isTimerRunning = false;
            state.status = 'GENERATING';
            state.generationTriggered = true;
            
            // Aggiorna lo stato reale
            gameState = { ...gameState, ...state };
            
            // Triggera la generazione se c'è un callback
            if (onTimerZeroCallback) {
                console.log('[GameState] Calling onTimerZeroCallback');
                onTimerZeroCallback(state).catch(err => {
                    console.error('[GameState] Error triggering generation:', err);
                });
            } else {
                console.warn('[GameState] No onTimerZeroCallback set!');
            }
            
            // Notifica i listener
            notifyListeners();
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
    // Reset generationTriggered quando si avvia un nuovo round
    if (updates.status === 'WAITING_FOR_PLAYERS' || updates.status === 'WRITING') {
        gameState.generationTriggered = false;
    }
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

