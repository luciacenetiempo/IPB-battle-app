// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;

// Log API token status on startup
console.log('[Server] REPLICATE_API_TOKEN:', process.env.REPLICATE_API_TOKEN ? '✓ Loaded' : '❌ NOT FOUND');

app.prepare().then(() => {
    const server = express();
    const httpServer = http.createServer(server);
    const io = new Server(httpServer);

    // Replicate Init
    const Replicate = require('replicate');
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    // Game State
    let gameState = {
        round: 0, // Start at 0 so first "Start Round" makes it 1
        theme: '',
        timer: 60,
        isTimerRunning: false,
        status: 'IDLE', // IDLE, WAITING_FOR_PLAYERS, WRITING, GENERATING, VOTING, ENDED
        participants: {}, // { socketId: { id, name, prompt, image, votes } }
        validTokens: [], // Array of valid access tokens for the current round
        expectedParticipantCount: 0, // Number of participants expected for the current round
        votingTimer: 120,
    };

    // Helper to log to admin
    const logToAdmin = (msg, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        io.to('admin').emit('admin:log', { timestamp, msg, type });
        console.log(`[${type.toUpperCase()}] ${msg}`);
    };

    // Helper function per normalizzare il prompt a stringa
    const normalizePrompt = (prompt) => {
        if (prompt === undefined || prompt === null) {
            return '';
        }
        
        // Se è già una stringa, ritorna trimmed
        if (typeof prompt === 'string') {
            return prompt.trim();
        }
        
        // Se è un oggetto, prova a estrarre la stringa
        if (typeof prompt === 'object') {
            // Prova {prompt: "..."}
            if (prompt.prompt && typeof prompt.prompt === 'string') {
                return prompt.prompt.trim();
            }
            // Prova {prompt: {prompt: "..."}}
            if (prompt.prompt && typeof prompt.prompt === 'object' && prompt.prompt.prompt && typeof prompt.prompt.prompt === 'string') {
                return prompt.prompt.prompt.trim();
            }
            // Se non riesce, converte l'oggetto in stringa JSON
            try {
                return JSON.stringify(prompt).trim();
            } catch (e) {
                return String(prompt).trim();
            }
        }
        
        // Per qualsiasi altro tipo, converti in stringa
        return String(prompt || '').trim();
    };

    // Async function to trigger generation
    const triggerGeneration = async () => {
        console.log('[Server] triggerGeneration() called');
        logToAdmin('🚀 Generation started', 'info');

        gameState.status = 'GENERATING';
        gameState.isTimerRunning = false;
        io.emit('state:update', gameState);
        logToAdmin('Starting generation process...', 'info');

        // Trigger generation for all participants with a prompt
        const participants = Object.values(gameState.participants);
        console.log(`[Server] Found ${participants.length} participants`);
        logToAdmin(`Found ${participants.length} participants`, 'info');

        // Check Replicate API token
        if (!process.env.REPLICATE_API_TOKEN) {
            logToAdmin('❌ ERROR: REPLICATE_API_TOKEN not found in environment', 'error');
            console.error('[Server] REPLICATE_API_TOKEN not set');
            return;
        }
        logToAdmin('✓ Replicate API token found', 'success');

        const generationPromises = participants.map(async (p) => {
            // Normalizza il prompt PRIMA di qualsiasi operazione
            console.log(`[Server] Processing participant ${p.name} (${p.id})`);
            console.log(`[Server] Raw prompt type:`, typeof p.prompt, 'value:', p.prompt);
            
            const promptText = normalizePrompt(p.prompt);
            console.log(`[Server] Normalized prompt for ${p.name}: "${promptText.substring(0, 50)}${promptText.length > 50 ? '...' : ''}" (length: ${promptText.length})`);
            
            if (promptText !== '') {
                try {
                    const startTime = Date.now();
                    logToAdmin(`📝 Inizio generazione per ${p.name}: "${promptText.substring(0, 50)}${promptText.length > 50 ? '...' : ''}"`, 'info');
                    console.log(`[Server] ====== STARTING GENERATION FOR ${p.name} ======`);
                    console.log(`[Server] Original prompt type:`, typeof p.prompt, 'value:', p.prompt);
                    console.log(`[Server] Processed prompt: "${promptText}"`);
                    
                    // Preparazione input
                    const inputData = {
                        prompt: promptText,
                        aspect_ratio: '1:1',
                        output_format: 'webp',
                        output_quality: 90
                    };
                    console.log(`[Server] Input data:`, JSON.stringify(inputData, null, 2));
                    logToAdmin(`🔧 Chiamando Replicate API per ${p.name}...`, 'info');
                    console.log(`[Server] Calling: replicate.predictions.create()`);
                    console.log(`[Server] Model: black-forest-labs/flux-2-dev`);
                    console.log(`[Server] Input:`, inputData);

                    // 1. Create prediction con Flux 2
                    let prediction;
                    try {
                        console.log(`[Server] [${p.name}] Making API call to Replicate...`);
                        prediction = await replicate.predictions.create({
                            model: "black-forest-labs/flux-2-dev",
                            input: inputData
                        });
                        console.log(`[Server] [${p.name}] ✅ API call successful!`);
                        console.log(`[Server] [${p.name}] Response received:`, JSON.stringify({
                            id: prediction.id,
                            status: prediction.status,
                            created_at: prediction.created_at,
                            urls: prediction.urls
                        }, null, 2));
                        logToAdmin(`⏳ Predizione creata per ${p.name} (ID: ${prediction.id.substring(0, 8)}...)`, 'info');
                        console.log(`[Server] [${p.name}] Full prediction object:`, prediction);
                    } catch (createError) {
                        console.error(`[Server] [${p.name}] ❌ ERROR during API call:`, createError);
                        console.error(`[Server] [${p.name}] Error message:`, createError.message);
                        console.error(`[Server] [${p.name}] Error stack:`, createError.stack);
                        logToAdmin(`❌ Errore nella chiamata API per ${p.name}: ${createError.message}`, 'error');
                        throw createError;
                    }

                    // 2. Poll for result
                    let pollCount = 0;
                    console.log(`[Server] [${p.name}] Starting polling loop...`);
                    logToAdmin(`🔄 Inizio polling per ${p.name}...`, 'info');
                    
                    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
                        pollCount++;
                        
                        try {
                            console.log(`[Server] [${p.name}] Poll #${pollCount}: Fetching prediction status...`);
                            console.log(`[Server] [${p.name}] Calling: replicate.predictions.get("${prediction.id}")`);
                            
                            const previousStatus = prediction.status;
                            prediction = await replicate.predictions.get(prediction.id);
                            
                            console.log(`[Server] [${p.name}] Poll #${pollCount} response received:`);
                            console.log(`[Server] [${p.name}]   - Previous status: ${previousStatus}`);
                            console.log(`[Server] [${p.name}]   - Current status: ${prediction.status}`);
                            console.log(`[Server] [${p.name}]   - Full response:`, JSON.stringify({
                                id: prediction.id,
                                status: prediction.status,
                                output: prediction.output,
                                error: prediction.error,
                                logs: prediction.logs
                            }, null, 2));
                            
                            // Log ogni poll
                            logToAdmin(`🔄 ${p.name}: Poll #${pollCount} - Status: ${prediction.status}`, 'info');
                            
                            // Se c'è un errore nella risposta
                            if (prediction.error) {
                                console.error(`[Server] [${p.name}] ⚠️ Error in prediction:`, prediction.error);
                                logToAdmin(`⚠️ ${p.name}: Errore nella predizione - ${prediction.error}`, 'error');
                            }
                            
                            // Se ci sono log, mostrali
                            if (prediction.logs) {
                                console.log(`[Server] [${p.name}] Logs:`, prediction.logs);
                            }
                        } catch (pollError) {
                            console.error(`[Server] [${p.name}] ❌ ERROR during poll #${pollCount}:`, pollError);
                            console.error(`[Server] [${p.name}] Error message:`, pollError.message);
                            console.error(`[Server] [${p.name}] Error stack:`, pollError.stack);
                            logToAdmin(`❌ Errore durante il polling #${pollCount} per ${p.name}: ${pollError.message}`, 'error');
                            throw pollError;
                        }
                    }

                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log(`[Server] [${p.name}] ====== POLLING COMPLETED ======`);
                    console.log(`[Server] [${p.name}] Final status: ${prediction.status}`);
                    console.log(`[Server] [${p.name}] Total polls: ${pollCount}`);
                    console.log(`[Server] [${p.name}] Duration: ${duration}s`);

                    if (prediction.status === 'succeeded') {
                        const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
                        console.log(`[Server] [${p.name}] ✅ SUCCESS!`);
                        console.log(`[Server] [${p.name}] Image URL:`, imageUrl);
                        console.log(`[Server] [${p.name}] Output type:`, Array.isArray(prediction.output) ? 'array' : typeof prediction.output);
                        console.log(`[Server] [${p.name}] Full output:`, prediction.output);
                        
                        gameState.participants[p.id].image = imageUrl;
                        logToAdmin(`✅ Immagine generata con successo per ${p.name} (${duration}s)`, 'success');
                        console.log(`[Server] [${p.name}] Image saved to gameState`);
                    } else {
                        console.error(`[Server] [${p.name}] ❌ FAILED/CANCELED`);
                        console.error(`[Server] [${p.name}] Status: ${prediction.status}`);
                        console.error(`[Server] [${p.name}] Error:`, prediction.error);
                        logToAdmin(`❌ Generazione fallita per ${p.name}: ${prediction.status}`, 'error');
                    }
                } catch (error) {
                    console.error(`[Server] [${p.name}] ====== FATAL ERROR ======`);
                    console.error(`[Server] [${p.name}] Error type:`, error.constructor.name);
                    console.error(`[Server] [${p.name}] Error message:`, error.message);
                    console.error(`[Server] [${p.name}] Error stack:`, error.stack);
                    if (error.response) {
                        console.error(`[Server] [${p.name}] Error response status:`, error.response.status);
                        console.error(`[Server] [${p.name}] Error response data:`, error.response.data);
                    }
                    logToAdmin(`❌ Errore durante la generazione per ${p.name}: ${error.message}`, 'error');
                }
            } else {
                logToAdmin(`⚠️ Skipping ${p.name} (no prompt)`, 'warning');
                console.log(`[Server] Skipping ${p.name} - no prompt`);
            }
        });

        await Promise.all(generationPromises);
        logToAdmin('✓ All generations completed', 'success');
        console.log('[Server] All generations completed');

        // Once all done, emit update
        io.emit('state:update', gameState);
    };

    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Send initial state
        socket.emit('state:update', gameState);

        // --- Admin Events ---
        socket.on('admin:start_round', (data) => {
            // Auto-increment round if not specified (or logic could be: always increment on start new round)
            // Requirement: "numero del round deve essere automatico e progressivo"
            // We'll assume "Start Round" means "Start NEXT Round"
            gameState.round += 1;
            gameState.theme = data.theme;
            gameState.status = 'WAITING_FOR_PLAYERS';
            gameState.timer = data.timer || 60; // Use provided timer or default
            gameState.isTimerRunning = false; // Don't start timer yet
            gameState.expectedParticipantCount = data.participantCount || 2;

            // Generate unique tokens for participants
            const count = data.participantCount || 2;
            gameState.validTokens = [];
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
            for (let i = 0; i < count; i++) {
                let token = '';
                for (let j = 0; j < 4; j++) {
                    token += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                gameState.validTokens.push(token);
            }

            // Clear participants from previous round
            gameState.participants = {};

            io.emit('state:update', gameState);
        });

        socket.on('admin:stop_timer', () => {
            gameState.isTimerRunning = false;
            io.emit('state:update', gameState);
        });

        // Manual trigger from admin
        socket.on('admin:trigger_generation', async () => {
            console.log('[Server] admin:trigger_generation event received');
            logToAdmin('🎮 Manual trigger from admin', 'info');
            await triggerGeneration();
        });

        socket.on('admin:start_voting', () => {
            gameState.status = 'VOTING';
            gameState.votingTimer = 120;
            // Start voting timer logic could be here or client side driven by admin tick
            // Better to have server authoritative timer
            io.emit('state:update', gameState);
        });

        // --- Participant Events ---
        socket.on('participant:join', (data) => {
            const token = data.token;

            // Validate token
            if (!gameState.validTokens.includes(token)) {
                socket.emit('error:join', 'INVALID TOKEN');
                return;
            }

            // Check if token is already used by another socket
            const existingParticipant = Object.values(gameState.participants).find(p => p.token === token);
            if (existingParticipant && existingParticipant.id !== socket.id) {
                // Allow reconnect if same socket? No, socket ID changes on reconnect usually.
                // For now, simple rule: if token used, reject. 
                // TODO: Implement reconnect logic (if token matches, update socket ID)
                socket.emit('error:join', 'TOKEN ALREADY IN USE');
                return;
            }

            const palette = ['#BEFA4F', '#E83399', '#5AA7B9', '#F5B700'];
            const participantIndex = Object.keys(gameState.participants).length;
            const assignedColor = palette[participantIndex % palette.length];

            gameState.participants[socket.id] = {
                id: socket.id,
                token: token,
                name: data.name || `Player ${participantIndex + 1}`,
                prompt: '', // Sempre una stringa vuota all'inizio
                image: null,
                votes: 0,
                color: assignedColor
            };
            console.log(`[Server] Created participant ${socket.id} with prompt type:`, typeof gameState.participants[socket.id].prompt);

            socket.emit('participant:joined', { id: socket.id, name: gameState.participants[socket.id].name, color: assignedColor });

            // Check if all expected participants have joined
            const joinedCount = Object.keys(gameState.participants).length;
            if (joinedCount === gameState.expectedParticipantCount && gameState.status === 'WAITING_FOR_PLAYERS') {
                // All participants have joined, start the timer
                gameState.status = 'WRITING';
                gameState.isTimerRunning = true;
            }

            io.emit('state:update', gameState);
        });

        socket.on('participant:update_prompt', (data) => {
            if (gameState.participants[socket.id] && gameState.status === 'WRITING') {
                // Gestisce sia stringa che oggetto {prompt: "..."}
                let promptValue = '';
                if (typeof data === 'string') {
                    promptValue = data;
                } else if (data && typeof data === 'object') {
                    if (typeof data.prompt === 'string') {
                        promptValue = data.prompt;
                    } else if (data.prompt && typeof data.prompt === 'object' && typeof data.prompt.prompt === 'string') {
                        promptValue = data.prompt.prompt;
                    } else {
                        promptValue = '';
                    }
                }
                
                // Assicurati che sia sempre una stringa
                promptValue = String(promptValue || '').trim();
                
                gameState.participants[socket.id].prompt = promptValue;
                console.log(`[Server] Updated prompt for ${socket.id}:`, promptValue.substring(0, 50));
                console.log(`[Server] Prompt type after update:`, typeof gameState.participants[socket.id].prompt);
                
                // Verifica che il prompt sia effettivamente una stringa nello stato
                if (typeof gameState.participants[socket.id].prompt !== 'string') {
                    console.error(`[Server] ⚠️ WARNING: Prompt is not a string! Type:`, typeof gameState.participants[socket.id].prompt, 'Value:', gameState.participants[socket.id].prompt);
                    // Forza conversione
                    gameState.participants[socket.id].prompt = String(gameState.participants[socket.id].prompt || '');
                }
                
                // Broadcast to screen (and admin) but maybe not other participants if we want secrecy?
                // Requirement: "nessun modo per vedere testo degli altri prima del tempo" -> 
                // Screen needs it, Admin needs it. Other participants should NOT receive it.
                // So we might need targeted emits or just trust the client UI to not show it.
                // Safer: emit 'screen:update_prompt' to specific room 'screen'
                io.to('screen').to('admin').emit('prompt:update', { id: socket.id, prompt: promptValue });
            }
        });

        // --- Voting Events ---
        socket.on('vote:cast', (participantId) => {
            if (gameState.status === 'VOTING') {
                if (gameState.participants[participantId]) {
                    gameState.participants[participantId].votes += 1;
                    io.emit('state:update', gameState);
                }
            }
        });

        // Join rooms
        socket.on('join_room', (room) => {
            socket.join(room);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
            // Optional: remove participant or mark as offline
        });
    });

    // Timer Loop (Simple implementation)
    setInterval(() => {
        let changed = false;
        if (gameState.status === 'WRITING' && gameState.isTimerRunning && gameState.timer > 0) {
            gameState.timer--;
            changed = true;
            if (gameState.timer === 0) {
                gameState.isTimerRunning = false;
                // Auto-trigger generation when timer ends
                console.log('[Server] Timer ended, auto-triggering generation');
                logToAdmin('⏰ Timer ended, starting generation automatically', 'info');
                triggerGeneration(); // Call async function (no await needed in setInterval)
            }
        }

        if (gameState.status === 'VOTING' && gameState.votingTimer > 0) {
            gameState.votingTimer--;
            changed = true;
            if (gameState.votingTimer === 0) {
                gameState.status = 'ENDED';
            }
        }

        if (changed) {
            io.emit('timer:update', {
                timer: gameState.timer,
                votingTimer: gameState.votingTimer,
                status: gameState.status
            });
        }
    }, 1000);

    // Middleware per parsing JSON (necessario per altre API routes se presenti)
    server.use(express.json());

    // Tutte le richieste non gestite da Express vengono passate a Next.js
    server.use((req, res) => {
        return handle(req, res);
    });

    // In locale, avvia il server HTTP con Socket.IO
    // Su Vercel, le API routes Next.js funzionano automaticamente da pages/api/
    httpServer.listen(port, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${port}`);
    });
});
