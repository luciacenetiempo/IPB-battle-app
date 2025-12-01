// API route per Server-Sent Events (SSE) - streaming di eventi in tempo reale
import { getGameState, addStateListener } from '../../lib/game-state';

// Store per connessioni SSE attive
const connections = new Map(); // socketId -> response object

export default async function handler(req, res) {
    // Solo GET è supportato per SSE
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { socketId } = req.query;
    if (!socketId) {
        return res.status(400).json({ error: 'socketId required' });
    }

    // Configura headers per SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disabilita buffering su Nginx

    // Invia stato iniziale
    const initialState = getGameState();
    res.write(`data: ${JSON.stringify({ type: 'state:update', data: initialState })}\n\n`);

    // Salva la connessione
    connections.set(socketId, res);

    // Listener per cambiamenti di stato
    const removeListener = addStateListener((state) => {
        try {
            res.write(`data: ${JSON.stringify({ type: 'state:update', data: state })}\n\n`);
        } catch (error) {
            console.error('[SSE] Error writing to connection:', error);
            connections.delete(socketId);
            removeListener();
        }
    });

    // Gestisci disconnessione
    req.on('close', () => {
        console.log(`[SSE] Client disconnected: ${socketId}`);
        connections.delete(socketId);
        removeListener();
        res.end();
    });

    // Keep-alive ping ogni 30 secondi
    const keepAlive = setInterval(() => {
        try {
            res.write(': ping\n\n');
        } catch (error) {
            clearInterval(keepAlive);
            connections.delete(socketId);
            removeListener();
        }
    }, 30000);

    req.on('close', () => {
        clearInterval(keepAlive);
    });
}

// Funzione per broadcastare eventi a tutte le connessioni
export function broadcastEvent(eventType, data) {
    const event = JSON.stringify({ type: eventType, data });
    connections.forEach((res, socketId) => {
        try {
            res.write(`data: ${event}\n\n`);
        } catch (error) {
            console.error(`[SSE] Error broadcasting to ${socketId}:`, error);
            connections.delete(socketId);
        }
    });
}

