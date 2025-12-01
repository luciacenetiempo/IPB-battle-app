import { io } from 'socket.io-client';

// Rileva se siamo su Vercel
const isVercel = typeof window !== 'undefined' && (
    window.location.hostname.includes('vercel.app') ||
    window.location.hostname.includes('vercel.com') ||
    process.env.NEXT_PUBLIC_USE_POLLING === 'true'
);

// Socket ID univoco per questo client
let clientSocketId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Polling HTTP per Vercel
class PollingSocket {
    constructor() {
        this.listeners = new Map();
        this.pollingInterval = null;
        this.connected = false;
        this.startPolling();
    }

    startPolling() {
        if (this.pollingInterval) return;
        
        this.connected = true;
        this.pollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/game-events?socketId=${clientSocketId}`);
                if (!response.ok) return;
                
                const { events, state } = await response.json();
                
                // Emit state update sempre (per sincronizzazione)
                if (state) {
                    const listeners = this.listeners.get('state:update') || [];
                    listeners.forEach(cb => cb(state));
                    
                    // Emit timer:update se il timer è cambiato
                    const timerListeners = this.listeners.get('timer:update') || [];
                    if (timerListeners.length > 0) {
                        timerListeners.forEach(cb => cb({
                            timer: state.timer,
                            votingTimer: state.votingTimer,
                            status: state.status
                        }));
                    }
                }
                
                // Emit pending events
                if (events && events.length > 0) {
                    events.forEach(event => {
                        const listeners = this.listeners.get(event.type) || [];
                        listeners.forEach(cb => {
                            if (event.data) {
                                cb(event.data);
                            } else {
                                cb();
                            }
                        });
                    });
                }
            } catch (error) {
                console.error('[PollingSocket] Error polling:', error);
            }
        }, 1000); // Poll ogni secondo
    }

    async emit(event, data) {
        if (!this.connected) return;
        
        try {
            // Invia evento al server
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
            
            // Emit success events
            if (event === 'participant:join' && result.success) {
                const listeners = this.listeners.get('participant:joined') || [];
                listeners.forEach(cb => cb(result.state?.participants?.[clientSocketId] || {}));
            }
        } catch (error) {
            console.error('[PollingSocket] Error emitting:', error);
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
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
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
            console.log('[Socket] Using HTTP polling for Vercel');
            socket = new PollingSocket();
        } else {
            console.log('[Socket] Using Socket.IO for local development');
            socket = io();
        }
    }
    return socket;
};
