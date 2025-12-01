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
                    const { type, data } = JSON.parse(event.data);
                    
                    if (type === 'state:update') {
                        this.currentState = data;
                        const listeners = this.listeners.get('state:update') || [];
                        listeners.forEach(cb => cb(data));
                        
                        // Avvia polling timer solo se il timer è attivo
                        this.updateTimerPolling(data);
                    } else {
                        // Altri eventi
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
                    console.error('[SSESocket] Error parsing message:', error);
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
                    const listeners = this.listeners.get('timer:update') || [];
                    if (listeners.length > 0) {
                        // Calcola timer aggiornato
                        let timer = this.currentState.timer;
                        let votingTimer = this.currentState.votingTimer;
                        
                        if (this.currentState.isTimerRunning && this.currentState.timerStartTime) {
                            const elapsed = Math.floor((Date.now() - this.currentState.timerStartTime) / 1000);
                            timer = Math.max(0, this.currentState.timer - elapsed);
                        }
                        
                        if (this.currentState.votingTimerStartTime) {
                            const elapsed = Math.floor((Date.now() - this.currentState.votingTimerStartTime) / 1000);
                            votingTimer = Math.max(0, this.currentState.votingTimer - elapsed);
                        }
                        
                        listeners.forEach(cb => cb({
                            timer,
                            votingTimer,
                            status: this.currentState.status
                        }));
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
        if (!this.connected) return;
        
        try {
            const response = await fetch('/api/game-events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: event,
                    socketId: clientSocketId,
                    data: data
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                // Emit error events
                if (event === 'participant:join' && errorData.error) {
                    const listeners = this.listeners.get('error:join') || [];
                    listeners.forEach(cb => cb(errorData.error));
                }
                return;
            }
            
            const result = await response.json();
            
            // Emit success events immediatamente
            if (event === 'participant:join' && result.success) {
                const listeners = this.listeners.get('participant:joined') || [];
                const participant = result.state?.participants?.[clientSocketId];
                if (participant) {
                    listeners.forEach(cb => cb({ 
                        id: clientSocketId, 
                        name: participant.name, 
                        color: participant.color 
                    }));
                }
            }
        } catch (error) {
            console.error('[SSESocket] Error emitting:', error);
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
