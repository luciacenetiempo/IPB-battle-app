import { io } from 'socket.io-client';

// Rileva se siamo su Vercel
const isVercel = typeof window !== 'undefined' && (
    window.location.hostname.includes('vercel.app') ||
    window.location.hostname.includes('vercel.com') ||
    process.env.NEXT_PUBLIC_USE_POLLING === 'true'
);

// Socket ID univoco per questo client
let clientSocketId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Server-Sent Events Socket per Vercel
class SSESocket {
    constructor() {
        this.listeners = new Map();
        this.eventSource = null;
        this.timerPollingInterval = null;
        this.lightweightPollingInterval = null;
        this.connected = false;
        this.currentState = null;
        this.lastCheckTimerCall = 0;
        this.startSSE();
    }

    startSSE() {
        if (this.eventSource) return;
        
        this.connected = true;
        
        // Connetti a SSE stream
        try {
            this.eventSource = new EventSource(`/api/game-stream?socketId=${clientSocketId}`);
            
            this.eventSource.onmessage = (event) => {
                try {
                    // Gestisci ping/commenti
                    if (event.data.startsWith(':')) {
                        return;
                    }
                    
                    const parsed = JSON.parse(event.data);
                    const { type, data } = parsed;
                    
                    console.log('[SSESocket] Received event:', type, data);
                    
                    if (type === 'state:update') {
                        this.currentState = data;
                        const listeners = this.listeners.get('state:update') || [];
                        listeners.forEach(cb => cb(data));
                        
                        // Avvia polling timer solo se il timer è attivo
                        this.updateTimerPolling(data);
                    } else {
                        // Altri eventi (prompt:update, participant:joined, etc.)
                        console.log('[SSESocket] Dispatching event:', type, 'data:', data);
                        const listeners = this.listeners.get(type) || [];
                        listeners.forEach(cb => {
                            if (data) {
                                cb(data);
                            } else {
                                cb();
                            }
                        });
                    }
                } catch (error) {
                    console.error('[SSESocket] Error parsing message:', error, 'Raw data:', event.data);
                }
            };
            
            this.eventSource.onerror = (error) => {
                console.error('[SSESocket] SSE error:', error);
                // Se SSE non funziona, fallback a polling leggero
                if (this.eventSource?.readyState === EventSource.CLOSED) {
                    console.log('[SSESocket] SSE closed, using lightweight polling fallback');
                    this.eventSource?.close();
                    this.eventSource = null;
                    this.startLightweightPolling();
                } else {
                    // Riconnessione automatica dopo 3 secondi
                    setTimeout(() => {
                        if (this.connected && !this.eventSource) {
                            this.startSSE();
                        }
                    }, 3000);
                }
            };
        } catch (error) {
            console.error('[SSESocket] Failed to create EventSource:', error);
            // Fallback a polling leggero
            this.startLightweightPolling();
        }
    }

    startLightweightPolling() {
        // Polling leggero: solo quando necessario (timer attivo o eventi in attesa)
        if (this.lightweightPollingInterval) return;
        
        let lastStateHash = null;
        
        this.lightweightPollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/game-state`);
                if (!response.ok) return;
                
                const state = await response.json();
                const stateHash = JSON.stringify(state);
                
                // Aggiorna solo se lo stato è cambiato
                if (stateHash !== lastStateHash) {
                    lastStateHash = stateHash;
                    this.currentState = state;
                    
                    const listeners = this.listeners.get('state:update') || [];
                    listeners.forEach(cb => cb(state));
                    
                    this.updateTimerPolling(state);
                }
            } catch (error) {
                console.error('[SSESocket] Lightweight polling error:', error);
            }
        }, 2000); // Poll ogni 2 secondi invece di 1
    }

    updateTimerPolling(state) {
        // Polling solo per il timer quando è attivo
        const needsTimerPolling = 
            (state.status === 'WRITING' && state.isTimerRunning) ||
            (state.status === 'VOTING');
        
        if (needsTimerPolling && !this.timerPollingInterval) {
            // Avvia polling ogni secondo per il timer
            this.timerPollingInterval = setInterval(() => {
                if (this.currentState) {
                    // Calcola timer aggiornato basandosi sul timestamp
                    let timer = this.currentState.timer;
                    let votingTimer = this.currentState.votingTimer;
                    let status = this.currentState.status;
                    
                    if (this.currentState.isTimerRunning && this.currentState.timerStartTime) {
                        const elapsed = Math.floor((Date.now() - this.currentState.timerStartTime) / 1000);
                        timer = Math.max(0, this.currentState.timer - elapsed);
                        
                        // Chiama l'endpoint per controllare se il timer è arrivato a 0
                        // Lo chiamiamo ogni secondo quando il timer è attivo e rimane poco tempo (<= 2 secondi)
                        // Questo assicura che la generazione venga triggerata anche se c'è un piccolo delay
                        if (timer <= 2 && status === 'WRITING' && (this.lastCheckTimerCall === 0 || Date.now() - this.lastCheckTimerCall > 1000)) {
                            this.lastCheckTimerCall = Date.now();
                            console.log('[SSESocket] Calling check-timer, timer:', timer);
                            fetch('/api/check-timer').catch(err => {
                                console.error('[SSESocket] Error calling check-timer:', err);
                            });
                        }
                        
                        if (timer === 0 && status === 'WRITING') {
                            status = 'GENERATING';
                        }
                    }
                    
                    if (this.currentState.votingTimerStartTime) {
                        const elapsed = Math.floor((Date.now() - this.currentState.votingTimerStartTime) / 1000);
                        votingTimer = Math.max(0, this.currentState.votingTimer - elapsed);
                        
                        if (votingTimer === 0) {
                            status = 'ENDED';
                        }
                    }
                    
                    // Emit timer:update per aggiornare il timer
                    const listeners = this.listeners.get('timer:update') || [];
                    listeners.forEach(cb => cb({
                        timer,
                        votingTimer,
                        status
                    }));
                    
                    // Aggiorna anche lo stato locale per mantenere sincronizzazione
                    const oldStatus = this.currentState.status;
                    if (timer !== this.currentState.timer || votingTimer !== this.currentState.votingTimer || status !== oldStatus) {
                        this.currentState = {
                            ...this.currentState,
                            timer,
                            votingTimer,
                            status
                        };
                        
                        // Emit state:update se lo status è cambiato
                        if (status !== oldStatus) {
                            const stateListeners = this.listeners.get('state:update') || [];
                            stateListeners.forEach(cb => cb(this.currentState));
                        }
                    }
                }
            }, 1000);
        } else if (!needsTimerPolling && this.timerPollingInterval) {
            // Ferma polling quando il timer non è attivo
            clearInterval(this.timerPollingInterval);
            this.timerPollingInterval = null;
        }
    }

    async emit(event, data) {
        if (!this.connected) {
            console.warn('[SSESocket] Not connected, cannot emit:', event);
            return;
        }
        
        try {
            // Per eventi che accettano dati come stringa (es. participant:update_prompt)
            // convertiamo in oggetto se necessario
            let payloadData = data;
            if (event === 'participant:update_prompt' && typeof data === 'string') {
                payloadData = { prompt: data };
            }
            
            console.log('[SSESocket] Emitting event:', event, 'data:', payloadData, 'original:', data);
            const response = await fetch('/api/game-events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: event,
                    socketId: clientSocketId,
                    data: payloadData
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('[SSESocket] Error response:', response.status, errorData);
                // Emit error events
                if (event === 'participant:join' && errorData.error) {
                    const listeners = this.listeners.get('error:join') || [];
                    listeners.forEach(cb => cb(errorData.error));
                }
                return;
            }
            
            const result = await response.json();
            console.log('[SSESocket] Event response:', event, 'success:', result.success);
            
            // Emit success events immediatamente
            if (event === 'participant:join' && result.success) {
                const listeners = this.listeners.get('participant:joined') || [];
                const participant = result.state?.participants?.[clientSocketId];
                if (participant) {
                    console.log('[SSESocket] Participant joined successfully:', participant);
                    listeners.forEach(cb => cb({ 
                        id: clientSocketId, 
                        name: participant.name, 
                        color: participant.color 
                    }));
                } else {
                    console.warn('[SSESocket] Participant joined but not found in state');
                }
            }
        } catch (error) {
            console.error('[SSESocket] Error emitting:', event, error);
            // Emit error event for participant:join
            if (event === 'participant:join') {
                const listeners = this.listeners.get('error:join') || [];
                listeners.forEach(cb => cb('NETWORK_ERROR'));
            }
        }
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    disconnect() {
        this.connected = false;
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        if (this.timerPollingInterval) {
            clearInterval(this.timerPollingInterval);
            this.timerPollingInterval = null;
        }
        if (this.lightweightPollingInterval) {
            clearInterval(this.lightweightPollingInterval);
            this.lightweightPollingInterval = null;
        }
    }

    get id() {
        return clientSocketId;
    }
}

let socket;

export const getSocket = () => {
    if (!socket) {
        if (isVercel) {
            console.log('[Socket] Using Server-Sent Events for Vercel');
            socket = new SSESocket();
        } else {
            console.log('[Socket] Using Socket.IO for local development');
            socket = io();
        }
    }
    return socket;
};
