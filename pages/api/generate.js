import { admin } from '../../lib/firebaseAdmin';
import Replicate from 'replicate';

export const config = {
    runtime: 'nodejs',
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        // Initialize services inside handler to catch config errors
        if (!process.env.REPLICATE_API_TOKEN) {
            throw new Error('REPLICATE_API_TOKEN is not set');
        }

        const db = admin.database();
        console.log('[API] Database initialized successfully'); // Debug URL

        const replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
        });

        const { roundId } = req.body;
        console.log(`[API] Triggering generation for round ${roundId}`);

        // Update state to GENERATING
        await db.ref('gameState').update({
            status: 'GENERATING',
            isTimerRunning: false
        });

        // Fetch participants
        const snapshot = await db.ref('participants').once('value');
        const participants = snapshot.val() || {};
        console.log(`[API] Found ${Object.keys(participants).length} participants`);

        // Helper function to generate with retry
        const generateWithRetry = async (replicate, participant, id, maxRetries = 1) => {
            let lastError;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        console.log(`[API] Retry attempt ${attempt} for ${participant.name} (${id}) after 2 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }

                    console.log(`[API] Generating for ${participant.name} (${id}): ${participant.prompt}`);
                    const output = await replicate.run(
                        "black-forest-labs/flux-2-dev",
                        {
                            input: {
                                prompt: participant.prompt,
                                aspect_ratio: "1:1",
                                output_format: "webp",
                                output_quality: 90
                            }
                        }
                    );

                    console.log(`[API] Raw output from Replicate:`, output);
                    console.log(`[API] Output type:`, typeof output, 'Is array:', Array.isArray(output));

                    // Replicate's ReadableStream has a toString() method that returns the URL
                    // Simply convert to string to get the URL
                    let imageUrl;
                    if (Array.isArray(output)) {
                        imageUrl = String(output[0]);
                    } else {
                        imageUrl = String(output);
                    }

                    console.log(`[API] Extracted imageUrl:`, imageUrl);
                    console.log(`[API] imageUrl type:`, typeof imageUrl);
                    console.log(`[API] Generated for ${participant.name}: ${imageUrl}`);

                    // Update participant with image URL
                    console.log(`[API] Updating participants/${id} with image...`);
                    const updateData = { image: imageUrl };
                    console.log(`[API] Update data:`, updateData);

                    await db.ref(`participants/${id}`).update(updateData);
                    console.log(`[API] Update complete for ${id}`);

                    return; // Success, exit retry loop

                } catch (error) {
                    lastError = error;
                    console.error(`[API] Error generating for ${participant.name} (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);

                    // If this was the last attempt, throw the error
                    if (attempt === maxRetries) {
                        throw error;
                    }
                }
            }
        };

        const generationPromises = Object.entries(participants).map(async ([id, p]) => {
            if (!p.prompt || !p.prompt.trim()) {
                console.log(`[API] Skipping ${p.name} - no prompt`);
                return;
            }

            try {
                await generateWithRetry(replicate, p, id);
            } catch (error) {
                console.error(`[API] Final error generating for ${p.name} after retries:`, error);
                // Optionally mark error in DB
            }
        });

        await Promise.all(generationPromises);

        // Collect results to return to client
        const results = {};
        const updatedSnapshot = await db.ref('participants').once('value');
        const updatedParticipants = updatedSnapshot.val() || {};

        Object.keys(updatedParticipants).forEach(id => {
            if (updatedParticipants[id].image) {
                results[id] = updatedParticipants[id].image;
            }
        });

        console.log('[API] Generation completed');
        return res.status(200).json({ success: true, results });

    } catch (error) {
        console.error('[API] Error in generate handler:', error);
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
}
