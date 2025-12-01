import { Redis } from '@upstash/redis';

// Initialize Redis client
// In production, these will come from environment variables
// For local dev, you can use .env.local
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

// Game state key
const GAME_STATE_KEY = 'game:state';
const LOGS_KEY = 'game:logs';

// Helper functions for game state
export const getGameState = async () => {
    try {
        const state = await redis.get(GAME_STATE_KEY);
        if (!state) {
            // Initialize default state
            const defaultState = {
                round: 0,
                theme: '',
                timer: 60,
                timerStartTime: null,
                isTimerRunning: false,
                status: 'IDLE',
                participants: {},
                validTokens: [],
                expectedParticipantCount: 0,
                votingTimer: 120,
                votingTimerStartTime: null,
            };
            await redis.set(GAME_STATE_KEY, JSON.stringify(defaultState));
            return defaultState;
        }
        return typeof state === 'string' ? JSON.parse(state) : state;
    } catch (error) {
        console.error('[Redis] Error getting game state:', error);
        // Return default state on error
        return {
            round: 0,
            theme: '',
            timer: 60,
            timerStartTime: null,
            isTimerRunning: false,
            status: 'IDLE',
            participants: {},
            validTokens: [],
            expectedParticipantCount: 0,
            votingTimer: 120,
            votingTimerStartTime: null,
        };
    }
};

export const setGameState = async (state) => {
    try {
        await redis.set(GAME_STATE_KEY, JSON.stringify(state));
        return true;
    } catch (error) {
        console.error('[Redis] Error setting game state:', error);
        return false;
    }
};

export const updateGameState = async (updates) => {
    try {
        const currentState = await getGameState();
        const newState = { ...currentState, ...updates };
        await setGameState(newState);
        return newState;
    } catch (error) {
        console.error('[Redis] Error updating game state:', error);
        return null;
    }
};

// Calculate remaining time based on start time
export const calculateRemainingTime = (state) => {
    const newState = { ...state };
    
    if (state.status === 'WRITING' && state.isTimerRunning && state.timerStartTime) {
        const elapsed = Math.floor((Date.now() - state.timerStartTime) / 1000);
        const remaining = Math.max(0, state.timer - elapsed);
        newState.timer = remaining;
        
        if (remaining === 0 && state.isTimerRunning) {
            newState.isTimerRunning = false;
        }
    }
    
    if (state.status === 'VOTING' && state.votingTimerStartTime) {
        const elapsed = Math.floor((Date.now() - state.votingTimerStartTime) / 1000);
        const remaining = Math.max(0, state.votingTimer - elapsed);
        newState.votingTimer = remaining;
        
        if (remaining === 0 && state.status === 'VOTING') {
            newState.status = 'ENDED';
        }
    }
    
    return newState;
};

// Logs management
export const addLog = async (log) => {
    try {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = { timestamp, ...log };
        await redis.lpush(LOGS_KEY, JSON.stringify(logEntry));
        // Keep only last 100 logs
        await redis.ltrim(LOGS_KEY, 0, 99);
        return true;
    } catch (error) {
        console.error('[Redis] Error adding log:', error);
        return false;
    }
};

export const getLogs = async () => {
    try {
        const logs = await redis.lrange(LOGS_KEY, 0, 99);
        return logs.map(log => typeof log === 'string' ? JSON.parse(log) : log).reverse();
    } catch (error) {
        console.error('[Redis] Error getting logs:', error);
        return [];
    }
};

export default redis;

