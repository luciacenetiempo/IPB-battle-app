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
            if (p.prompt && p.prompt.trim() !== '') {
                try {
                    logToAdmin(`Creating prediction for ${p.name} (${p.id})`, 'info');
                    console.log(`[Server] Creating prediction for ${p.name} with prompt: "${p.prompt}"`);

                    // 1. Create prediction
                    let prediction = await replicate.predictions.create({
                        model: "google/nano-banana-pro",
                        input: {
                            prompt: p.prompt,
                            num_inference_steps: 25,
                            guidance_scale: 7.5
                        }
                    });
                    logToAdmin(`Prediction created for ${p.name}: ${prediction.id}`, 'info');
                    console.log(`[Server] Prediction ID: ${prediction.id}, Status: ${prediction.status}`);

                    // 2. Poll for result
                    let pollCount = 0;
                    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
                        prediction = await replicate.predictions.get(prediction.id);
                        pollCount++;
                        logToAdmin(`Polling ${p.name} (${pollCount}): ${prediction.status}`, 'debug');
                        console.log(`[Server] Poll ${pollCount} for ${p.name}: ${prediction.status}`);
                    }

                    if (prediction.status === 'succeeded') {
                        logToAdmin(`✓ Success for ${p.name}`, 'success');
                        console.log(`[Server] Success for ${p.name}:`, prediction.output);
                        gameState.participants[p.id].image = prediction.output;
                    } else {
                        logToAdmin(`❌ Failed/Canceled for ${p.name}: ${prediction.status}`, 'error');
                        console.error(`[Server] Failed for ${p.name}:`, prediction.status);
                    }
                } catch (error) {
                    logToAdmin(`❌ Error for ${p.name}: ${error.message}`, 'error');
                    console.error(`[Server] Error for ${p.name}:`, error);
                }
            } else {
                logToAdmin(`⚠ Skipping ${p.name} (no prompt)`, 'warning');
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
                prompt: '',
                image: null,
                votes: 0,
                color: assignedColor
            };

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

        socket.on('participant:update_prompt', (prompt) => {
            if (gameState.participants[socket.id] && gameState.status === 'WRITING') {
                gameState.participants[socket.id].prompt = prompt;
                // Broadcast to screen (and admin) but maybe not other participants if we want secrecy?
                // Requirement: "nessun modo per vedere testo degli altri prima del tempo" -> 
                // Screen needs it, Admin needs it. Other participants should NOT receive it.
                // So we might need targeted emits or just trust the client UI to not show it.
                // Safer: emit 'screen:update_prompt' to specific room 'screen'
                io.to('screen').to('admin').emit('prompt:update', { id: socket.id, prompt });
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

    // Helper function to generate image with a single model
    const generateWithModel = async (model, prompt) => {
        console.log(`[TestAPI] generateWithModel called for model: ${model}`);
        const startTime = Date.now();
        
        // Prepare input based on model
        let input = {};
        if (model === 'google/nano-banana-pro') {
            input = {
                prompt: prompt.trim(),
                aspect_ratio: '16:9',
                output_format: 'webp',
                resolution: '1K',
                num_images: 1
            };
        } else if (model === 'black-forest-labs/flux-2-dev') {
            input = {
                prompt: prompt.trim(),
                aspect_ratio: '16:9',
                output_format: 'webp',
                output_quality: 90
            };
        } else {
            throw new Error(`Unknown model: ${model}`);
        }

        console.log(`[TestAPI] Creating prediction for ${model} with input:`, JSON.stringify(input));
        // Create prediction
        let prediction = await replicate.predictions.create({
            model: model,
            input: input
        });

        console.log(`[TestAPI] Prediction created for ${model}: ${prediction.id}, Status: ${prediction.status}`);

        // Poll for result
        let pollCount = 0;
        while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
            prediction = await replicate.predictions.get(prediction.id);
            pollCount++;
            console.log(`[TestAPI] Poll ${pollCount} for ${model}: ${prediction.status}`);
        }

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimals

        if (prediction.status === 'succeeded') {
            const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
            return {
                success: true,
                image: imageUrl,
                predictionId: prediction.id,
                model: model,
                duration: duration
            };
        } else {
            throw new Error(`Generation failed with status: ${prediction.status}`);
        }
    };

    // API endpoint for testing image generation
    server.use(express.json());
    server.post('/api/test-generation', async (req, res) => {
        console.log('[TestAPI] Request body:', JSON.stringify(req.body));
        const { prompt, model, testBoth } = req.body;
        
        // Ensure testBoth is a boolean
        const shouldTestBoth = testBoth === true || testBoth === 'true';
        console.log('[TestAPI] testBoth value:', testBoth, 'converted to:', shouldTestBoth);

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        if (!process.env.REPLICATE_API_TOKEN) {
            return res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' });
        }

        try {
            // If testBoth is true, generate with both models in parallel
            if (shouldTestBoth) {
                console.log(`[TestAPI] Generating with both models in parallel for prompt: "${prompt}"`);
                console.log('[TestAPI] Starting BOTH generations simultaneously (FLUX.2 has priority)...');
                
                // Generate both in parallel - FLUX.2 FIRST (priority), then nano-banana
                // Use Promise.allSettled to ensure both complete even if one fails
                const generateFlux = async () => {
                    console.log('[TestAPI] [PRIORITY] Starting flux-2-dev generation...');
                    try {
                        const result = await generateWithModel('black-forest-labs/flux-2-dev', prompt);
                        console.log('[TestAPI] [PRIORITY] flux-2-dev completed successfully');
                        return { ...result, modelLabel: 'FLUX.2 [dev]' };
                    } catch (err) {
                        console.error('[TestAPI] [PRIORITY] Error with flux-2-dev:', err);
                        return {
                            success: false,
                            error: err.message || 'Unknown error',
                            model: 'black-forest-labs/flux-2-dev',
                            modelLabel: 'FLUX.2 [dev]',
                            duration: '0.00',
                            image: null
                        };
                    }
                };

                const generateNanoBanana = async () => {
                    console.log('[TestAPI] [SECONDARY] Starting nano-banana-pro generation...');
                    try {
                        const result = await generateWithModel('google/nano-banana-pro', prompt);
                        console.log('[TestAPI] [SECONDARY] nano-banana-pro completed successfully');
                        return { ...result, modelLabel: 'Nano Banana Pro' };
                    } catch (err) {
                        console.error('[TestAPI] [SECONDARY] Error with nano-banana-pro:', err);
                        return {
                            success: false,
                            error: err.message || 'Unknown error',
                            model: 'google/nano-banana-pro',
                            modelLabel: 'Nano Banana Pro',
                            duration: '0.00',
                            image: null
                        };
                    }
                };

                // Start both immediately in parallel - FLUX.2 first in array for priority
                console.log('[TestAPI] Launching both promises in parallel NOW...');
                const fluxPromise = generateFlux();
                const nanoPromise = generateNanoBanana();
                
                console.log('[TestAPI] Both promises launched, waiting for completion...');
                // Use Promise.allSettled to ensure both complete even if one fails
                const [fluxResult, nanoResult] = await Promise.allSettled([
                    fluxPromise,
                    nanoPromise
                ]);
                
                console.log('[TestAPI] Both promises completed');
                
                // Extract results from settled promises
                const result1 = fluxResult.status === 'fulfilled' 
                    ? fluxResult.value 
                    : {
                        success: false,
                        error: fluxResult.reason?.message || 'Unknown error',
                        model: 'black-forest-labs/flux-2-dev',
                        modelLabel: 'FLUX.2 [dev]',
                        duration: '0.00',
                        image: null
                    };
                
                const result2 = nanoResult.status === 'fulfilled'
                    ? nanoResult.value
                    : {
                        success: false,
                        error: nanoResult.reason?.message || 'Unknown error',
                        model: 'google/nano-banana-pro',
                        modelLabel: 'Nano Banana Pro',
                        duration: '0.00',
                        image: null
                    };

                console.log('[TestAPI] Both generations completed:');
                console.log('[TestAPI] - FLUX.2 [dev] (PRIORITY):', result1.success ? 'SUCCESS' : 'FAILED', result1.duration + 's');
                console.log('[TestAPI] - Nano Banana Pro:', result2.success ? 'SUCCESS' : 'FAILED', result2.duration + 's');

                return res.json({
                    success: true,
                    testBoth: true,
                    results: [result1, result2] // FLUX.2 first (priority)
                });
            } else {
                // Single model generation
                const selectedModel = model || 'google/nano-banana-pro';
                const validModels = ['google/nano-banana-pro', 'black-forest-labs/flux-2-dev'];
                
                if (!validModels.includes(selectedModel)) {
                    console.log(`[TestAPI] Invalid model received: "${selectedModel}"`);
                    return res.status(400).json({ error: `Invalid model. Must be one of: ${validModels.join(', ')}` });
                }

                console.log(`[TestAPI] Generating image with model "${selectedModel}" for prompt: "${prompt}"`);
                const result = await generateWithModel(selectedModel, prompt);
                
                return res.json({
                    success: true,
                    testBoth: false,
                    ...result
                });
            }
        } catch (error) {
            console.error('[TestAPI] Error:', error);
            return res.status(500).json({
                error: error.message || 'Unknown error occurred'
            });
        }
    });

    server.use((req, res) => {
        return handle(req, res);
    });

    httpServer.listen(port, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${port}`);
    });
});
