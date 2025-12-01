import { getGameState, updateGameState, addLog } from '../../../lib/redis';
import Replicate from 'replicate';

// Helper function to generate image with a single model
const generateWithModel = async (model, prompt, replicate) => {
    console.log(`[Generation] generateWithModel called for model: ${model}`);
    
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
    } else {
        input = {
            prompt: prompt.trim(),
            aspect_ratio: '16:9',
            output_format: 'webp',
            output_quality: 90
        };
    }

    // Create prediction
    let prediction = await replicate.predictions.create({
        model: model,
        input: input
    });

    // Poll for result
    let pollCount = 0;
    const maxPolls = 120; // Max 4 minutes
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
        if (pollCount >= maxPolls) {
            throw new Error('Timeout: Generation took too long');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        prediction = await replicate.predictions.get(prediction.id);
        pollCount++;
    }

    if (prediction.status === 'succeeded') {
        const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        return imageUrl;
    } else {
        throw new Error(`Generation failed with status: ${prediction.status}`);
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Debug: log environment variable status
        const hasToken = !!process.env.REPLICATE_API_TOKEN;
        const tokenLength = process.env.REPLICATE_API_TOKEN ? process.env.REPLICATE_API_TOKEN.length : 0;
        console.log('[Generation] REPLICATE_API_TOKEN check:', {
            exists: hasToken,
            length: tokenLength,
            startsWith: process.env.REPLICATE_API_TOKEN ? process.env.REPLICATE_API_TOKEN.substring(0, 5) + '...' : 'N/A'
        });

        if (!process.env.REPLICATE_API_TOKEN) {
            console.error('[Generation] REPLICATE_API_TOKEN not configured');
            console.error('[Generation] Available env vars:', Object.keys(process.env).filter(k => k.includes('REPLICATE') || k.includes('API')));
            await addLog({ msg: '❌ ERROR: REPLICATE_API_TOKEN not found', type: 'error' });
            return res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' });
        }

        const replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
        });

        let state = await getGameState();
        
        // Update status to GENERATING
        state = await updateGameState({
            status: 'GENERATING',
            isTimerRunning: false,
        });

        await addLog({ msg: '🚀 Generation started', type: 'info' });

        // Trigger generation for all participants with a prompt
        const participants = Object.values(state.participants);
        await addLog({ msg: `Found ${participants.length} participants`, type: 'info' });

        const generationPromises = participants.map(async (p) => {
            if (p.prompt && p.prompt.trim() !== '') {
                try {
                    await addLog({ msg: `Creating prediction for ${p.name} (${p.id})`, type: 'info' });
                    
                    const imageUrl = await generateWithModel('google/nano-banana-pro', p.prompt, replicate);
                    
                    // Update participant image
                    const currentState = await getGameState();
                    const newParticipants = {
                        ...currentState.participants,
                        [p.id]: {
                            ...currentState.participants[p.id],
                            image: imageUrl,
                        }
                    };
                    await updateGameState({ participants: newParticipants });
                    
                    await addLog({ msg: `✓ Success for ${p.name}`, type: 'success' });
                } catch (error) {
                    await addLog({ msg: `❌ Error for ${p.name}: ${error.message}`, type: 'error' });
                    console.error(`[Generation] Error for ${p.name}:`, error);
                }
            } else {
                await addLog({ msg: `⚠ Skipping ${p.name} (no prompt)`, type: 'warning' });
            }
        });

        await Promise.all(generationPromises);
        await addLog({ msg: '✓ All generations completed', type: 'success' });

        const finalState = await getGameState();
        return res.status(200).json(finalState);
    } catch (error) {
        console.error('[API] Error triggering generation:', error);
        await addLog({ msg: `❌ Generation error: ${error.message}`, type: 'error' });
        return res.status(500).json({ error: 'Failed to trigger generation' });
    }
}

// Increase timeout for Vercel
export const config = {
    maxDuration: 60,
};

