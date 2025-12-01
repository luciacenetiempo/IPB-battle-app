// API route per controllare se il timer è arrivato a 0 e triggerare la generazione
import { getGameState, updateGameState } from '../../lib/game-state';
import { broadcastEvent } from './game-stream';

// Funzione per triggerare la generazione
async function triggerGeneration(state) {
    const Replicate = require('replicate');
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    const participants = Object.values(state.participants);
    
    for (const p of participants) {
        if (p.prompt && p.prompt.trim() !== '') {
            try {
                console.log(`[CheckTimer] Creating prediction for ${p.name} with prompt: "${p.prompt}"`);
                let prediction = await replicate.predictions.create({
                    model: "google/nano-banana-pro",
                    input: {
                        prompt: p.prompt,
                        num_inference_steps: 25,
                        guidance_scale: 7.5
                    }
                });

                while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    prediction = await replicate.predictions.get(prediction.id);
                }

                if (prediction.status === 'succeeded') {
                    const { updateParticipant } = require('../../lib/game-state');
                    updateParticipant(p.id, { image: prediction.output });
                    console.log(`[CheckTimer] Successfully generated image for ${p.name}`);
                } else {
                    console.error(`[CheckTimer] Generation failed for ${p.name}:`, prediction.status);
                }
            } catch (error) {
                console.error(`[CheckTimer] Error generating for ${p.name}:`, error);
            }
        }
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const state = getGameState();
    
    // Controlla se il timer è arrivato a 0 e lo status è ancora WRITING
    if (state.isTimerRunning && state.timerStartTime && state.status === 'WRITING') {
        const elapsed = Math.floor((Date.now() - state.timerStartTime) / 1000);
        const remaining = Math.max(0, state.timer - elapsed);
        
        if (remaining === 0 && !state.generationTriggered) {
            console.log('[CheckTimer] Timer reached zero, triggering generation');
            
            // Aggiorna lo stato a GENERATING
            const newState = updateGameState({
                status: 'GENERATING',
                isTimerRunning: false,
                generationTriggered: true
            });
            
            // Broadcast lo stato aggiornato
            broadcastEvent('state:update', newState);
            
            // Triggera la generazione in background (non bloccante)
            triggerGeneration(newState).catch(err => {
                console.error('[CheckTimer] Generation error:', err);
            });
            
            return res.status(200).json({ 
                success: true, 
                message: 'Generation triggered',
                state: newState 
            });
        }
    }
    
    return res.status(200).json({ 
        success: true, 
        timer: state.timer,
        status: state.status 
    });
}

