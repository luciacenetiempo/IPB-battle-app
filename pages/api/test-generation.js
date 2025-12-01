import Replicate from 'replicate';

// Helper function to generate image with a single model
const generateWithModel = async (model, prompt, replicate) => {
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
    const maxPolls = 120; // Max 4 minutes (120 * 2s)
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
        if (pollCount >= maxPolls) {
            throw new Error('Timeout: Generation took too long');
        }
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

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('[TestAPI] Request body:', JSON.stringify(req.body));
    const { prompt, model, testBoth } = req.body;
    
    // Ensure testBoth is a boolean
    const shouldTestBoth = testBoth === true || testBoth === 'true';
    console.log('[TestAPI] testBoth value:', testBoth, 'converted to:', shouldTestBoth);

    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!process.env.REPLICATE_API_TOKEN) {
        console.error('[TestAPI] REPLICATE_API_TOKEN not configured');
        return res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    // Initialize Replicate
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

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
                    const result = await generateWithModel('black-forest-labs/flux-2-dev', prompt, replicate);
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
                    const result = await generateWithModel('google/nano-banana-pro', prompt, replicate);
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

            return res.status(200).json({
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
            const result = await generateWithModel(selectedModel, prompt, replicate);
            
            return res.status(200).json({
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
}

// Increase timeout for Vercel (max 60s on Pro, 10s on Hobby)
export const config = {
    maxDuration: 60,
};

