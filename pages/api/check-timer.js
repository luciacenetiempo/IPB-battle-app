// API route per controllare se il timer è arrivato a 0 e triggerare la generazione
import { getGameState, updateGameState } from '../../lib/game-state';
import { broadcastEvent } from './game-stream';

// Helper per inviare log al pannello admin
function sendAdminLog(msg, type = 'info') {
    const log = {
        timestamp: new Date().toLocaleTimeString('it-IT'),
        msg: msg,
        type: type
    };
    broadcastEvent('admin:log', log);
    console.log(`[AdminLog] [${type.toUpperCase()}] ${msg}`);
}

// Funzione per triggerare la generazione
async function triggerGeneration(state) {
    const Replicate = require('replicate');
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    const participants = Object.values(state.participants);
    const participantsWithPrompts = participants.filter(p => p.prompt && p.prompt.trim() !== '');
    
    if (participantsWithPrompts.length === 0) {
        sendAdminLog('⚠️ Nessun prompt disponibile per la generazione', 'warning');
        return;
    }

    sendAdminLog(`🚀 Avvio generazione immagini per ${participantsWithPrompts.length} partecipante/i...`, 'info');
    
    for (const p of participantsWithPrompts) {
        try {
            sendAdminLog(`📝 Inizio generazione per ${p.name}: "${p.prompt.substring(0, 50)}${p.prompt.length > 50 ? '...' : ''}"`, 'info');
            
            const startTime = Date.now();
            let prediction = await replicate.predictions.create({
                model: "black-forest-labs/flux-2-dev",
                input: {
                    prompt: p.prompt.trim(),
                    aspect_ratio: '1:1',
                    output_format: 'webp',
                    output_quality: 90
                }
            });

            sendAdminLog(`⏳ Predizione creata per ${p.name} (ID: ${prediction.id.substring(0, 8)}...)`, 'info');

            let pollCount = 0;
            while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
                await new Promise(resolve => setTimeout(resolve, 2000));
                prediction = await replicate.predictions.get(prediction.id);
                pollCount++;
                
                if (pollCount % 5 === 0) { // Log ogni 10 secondi (5 poll * 2s)
                    sendAdminLog(`⏳ ${p.name}: generazione in corso... (${prediction.status}, tentativo ${pollCount})`, 'info');
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);

            if (prediction.status === 'succeeded') {
                const { updateParticipant } = require('../../lib/game-state');
                const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
                updateParticipant(p.id, { image: imageUrl });
                sendAdminLog(`✅ Immagine generata con successo per ${p.name} (${duration}s)`, 'success');
            } else {
                sendAdminLog(`❌ Generazione fallita per ${p.name}: ${prediction.status}`, 'error');
            }
        } catch (error) {
            sendAdminLog(`❌ Errore durante la generazione per ${p.name}: ${error.message}`, 'error');
            console.error(`[CheckTimer] Error generating for ${p.name}:`, error);
        }
    }
    
    sendAdminLog(`✨ Generazione completata per tutti i partecipanti`, 'success');
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
            sendAdminLog('⏰ Timer scaduto! Avvio generazione automatica...', 'info');
            
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
                sendAdminLog(`❌ Errore critico durante la generazione: ${err.message}`, 'error');
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

