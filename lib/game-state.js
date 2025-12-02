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
    // Se si avvia un nuovo round, pulisci il mapping tokenToSocketId e rigenera i sessionSecret
    if (updates.status === 'WAITING_FOR_PLAYERS' && updates.participants && Object.keys(updates.participants).length === 0) {
        console.log('[GameState] New round started, clearing tokenToSocketIdMap and resetting sessionSecrets');
        tokenToSocketIdMap = {};
        // I sessionSecret verranno rigenerati quando i partecipanti si riconnettono nel nuovo round
    }
    // Log quando i token vengono aggiornati
    if (updates.validTokens) {
        console.log('[GameState] Valid tokens updated:', updates.validTokens);
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

// Mapping token -> socketId per tracciare le connessioni
// I partecipanti sono memorizzati con token come chiave, ma manteniamo anche il mapping socketId
let tokenToSocketIdMap = {};

// Genera un sessionSecret univoco per proteggere il rejoin
function generateSessionSecret() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}`;
}

// Helper per gestire i partecipanti - usa TOKEN come chiave primaria
export const addParticipant = (socketId, participantData, providedSessionSecret = null) => {
    const token = participantData.token;
    if (!token) {
        console.error('[GameState] Cannot add participant without token');
        return gameState;
    }
    
    const existingParticipant = gameState.participants[token];
    
    // Se il token esiste già, verifica il sessionSecret per permettere il rejoin
    if (existingParticipant) {
        // Se viene fornito un sessionSecret, verifica che corrisponda
        if (providedSessionSecret) {
            if (existingParticipant.sessionSecret !== providedSessionSecret) {
                console.error(`[GameState] Rejoin rejected: sessionSecret mismatch for token ${token}`);
                throw new Error('INVALID_SESSION_SECRET');
            }
            // SessionSecret valido, permettere il rejoin
            console.log(`[GameState] Valid rejoin for token ${token}, updating socketId from ${existingParticipant.socketId} to ${socketId}`);
        } else {
            // Nessun sessionSecret fornito ma il token esiste già = tentativo di furto
            console.error(`[GameState] Rejoin rejected: no sessionSecret provided for existing token ${token}`);
            throw new Error('SESSION_SECRET_REQUIRED');
        }
        
        // Rimuovi il vecchio mapping
        const oldSocketId = existingParticipant.socketId;
        if (oldSocketId && tokenToSocketIdMap[oldSocketId] === token) {
            delete tokenToSocketIdMap[oldSocketId];
        }
    } else {
        // Nuovo partecipante: genera un sessionSecret
        participantData.sessionSecret = generateSessionSecret();
        console.log(`[GameState] New participant, generated sessionSecret for token ${token}`);
    }
    
    // Aggiungi/aggiorna il partecipante con token come chiave
    gameState.participants[token] = {
        ...participantData,
        socketId: socketId, // Mantieni anche il socketId per riferimento
        id: token, // id è ora il token stesso
        sessionSecret: existingParticipant?.sessionSecret || participantData.sessionSecret // Mantieni il sessionSecret esistente o usa quello nuovo
    };
    
    // Aggiorna il mapping
    tokenToSocketIdMap[socketId] = token;
    
    console.log(`[GameState] Participant added/updated: token=${token}, socketId=${socketId}, total participants: ${Object.keys(gameState.participants).length}`);
    notifyListeners();
    return gameState;
};

export const removeParticipant = (socketId) => {
    const token = tokenToSocketIdMap[socketId];
    if (token && gameState.participants[token]) {
        delete gameState.participants[token];
        delete tokenToSocketIdMap[socketId];
        console.log(`[GameState] Participant removed: token=${token}, socketId=${socketId}`);
        notifyListeners();
    }
    return gameState;
};

// Aggiorna partecipante per token (metodo principale)
export const updateParticipant = (token, updates) => {
    if (gameState.participants[token]) {
        gameState.participants[token] = { ...gameState.participants[token], ...updates };
        notifyListeners();
        return gameState;
    }
    console.warn(`[GameState] Cannot update participant: token ${token} not found`);
    return gameState;
};

// Aggiorna partecipante per socketId (per compatibilità)
export const updateParticipantBySocketId = (socketId, updates) => {
    const token = tokenToSocketIdMap[socketId];
    if (token) {
        return updateParticipant(token, updates);
    }
    console.warn(`[GameState] Cannot update participant: socketId ${socketId} not found in mapping`);
    return gameState;
};

// Ottieni partecipante per token
export const getParticipantByToken = (token) => {
    return gameState.participants[token] || null;
};

// Ottieni partecipante per socketId
export const getParticipantBySocketId = (socketId) => {
    const token = tokenToSocketIdMap[socketId];
    return token ? gameState.participants[token] : null;
};

// Ottieni token da socketId
export const getTokenBySocketId = (socketId) => {
    return tokenToSocketIdMap[socketId] || null;
};

