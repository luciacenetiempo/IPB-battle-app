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
    console.log('[CheckTimer] triggerGeneration called with state:', {
        status: state.status,
        participantsCount: Object.keys(state.participants || {}).length,
        participants: Object.keys(state.participants || {})
    });
    
    const Replicate = require('replicate');
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    const participants = Object.values(state.participants || {});
    console.log('[CheckTimer] All participants:', participants.map(p => ({
        id: p.id,
        token: p.token,
        name: p.name,
        promptType: typeof p.prompt,
        promptLength: typeof p.prompt === 'string' ? p.prompt.length : 0,
        hasPrompt: !!p.prompt
    })));
    
    // Normalizza i prompt a stringhe prima di filtrare
    const participantsWithPrompts = participants.filter(p => {
        if (!p.prompt) return false;
        const promptStr = String(p.prompt || '').trim();
        const hasValidPrompt = promptStr !== '';
        console.log(`[CheckTimer] Participant ${p.name} (${p.id}): prompt type=${typeof p.prompt}, length=${promptStr.length}, valid=${hasValidPrompt}`);
        return hasValidPrompt;
    });
    
    console.log(`[CheckTimer] Found ${participantsWithPrompts.length} participants with valid prompts`);
    
    if (participantsWithPrompts.length === 0) {
        sendAdminLog('⚠️ Nessun prompt disponibile per la generazione', 'warning');
        console.log('[CheckTimer] No participants with prompts, aborting generation');
        return;
    }

    sendAdminLog(`🚀 Avvio generazione immagini per ${participantsWithPrompts.length} partecipante/i...`, 'info');
    
    for (const p of participantsWithPrompts) {
        try {
            // Assicurati che il prompt sia sempre una stringa
            const promptStr = String(p.prompt || '').trim();
            console.log(`[CheckTimer] Generating for ${p.name} (${p.id}), prompt length: ${promptStr.length}`);
            sendAdminLog(`📝 Inizio generazione per ${p.name}: "${promptStr.substring(0, 50)}${promptStr.length > 50 ? '...' : ''}"`, 'info');
            
            const startTime = Date.now();
            let prediction = await replicate.predictions.create({
                model: "black-forest-labs/flux-2-dev",
                input: {
                    prompt: promptStr,
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
                const { updateParticipant, getGameState } = require('../../lib/game-state');
                const { broadcastEvent } = require('./game-stream');
                const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
                // p.id è ora il token
                console.log(`[CheckTimer] Updating participant ${p.id} (${p.name}) with image URL:`, imageUrl);
                updateParticipant(p.id, { image: imageUrl });
                // Broadcast lo stato aggiornato dopo ogni immagine generata
                const updatedState = getGameState();
                broadcastEvent('state:update', updatedState);
                sendAdminLog(`✅ Immagine generata con successo per ${p.name} (${duration}s)`, 'success');
            } else {
                sendAdminLog(`❌ Generazione fallita per ${p.name}: ${prediction.status}`, 'error');
            }
        } catch (error) {
            sendAdminLog(`❌ Errore durante la generazione per ${p.name}: ${error.message}`, 'error');
            console.error(`[CheckTimer] Error generating for ${p.name}:`, error);
            if (error.stack) {
                console.error(`[CheckTimer] Error stack:`, error.stack);
            }
        }
    }
    
    // Broadcast finale dello stato aggiornato
    const { getGameState } = require('../../lib/game-state');
    const { broadcastEvent } = require('./game-stream');
    const finalState = getGameState();
    broadcastEvent('state:update', finalState);
    sendAdminLog(`✨ Generazione completata per tutti i partecipanti`, 'success');
    console.log('[CheckTimer] Generation completed, final state broadcasted');
}

export default async function handler(req, res) {
    console.log('[CheckTimer] ====== ENDPOINT CALLED ======');
    
    if (req.method !== 'GET') {
        console.log('[CheckTimer] Method not allowed:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const state = getGameState();
    
    // Log per debugging
    console.log('[CheckTimer] Called - status:', state.status, 'isTimerRunning:', state.isTimerRunning, 'timer:', state.timer, 'generationTriggered:', state.generationTriggered, 'timerStartTime:', state.timerStartTime);
    sendAdminLog(`🔍 CheckTimer chiamato - Status: ${state.status}, Timer: ${state.timer}, Running: ${state.isTimerRunning}`, 'info');
    
    // Controlla se il timer è arrivato a 0 e lo status è ancora WRITING
    if (state.isTimerRunning && state.timerStartTime && state.status === 'WRITING') {
        const elapsed = Math.floor((Date.now() - state.timerStartTime) / 1000);
        const remaining = Math.max(0, state.timer - elapsed);
        
        console.log('[CheckTimer] Timer check - elapsed:', elapsed, 'original timer:', state.timer, 'remaining:', remaining, 'generationTriggered:', state.generationTriggered);
        sendAdminLog(`⏱️ Timer check - Elapsed: ${elapsed}s, Remaining: ${remaining}s`, 'info');
        
        // Controlla anche se remaining è <= 0 (per gestire casi di arrotondamento)
        if (remaining <= 0 && !state.generationTriggered) {
            console.log('[CheckTimer] ✅ Timer reached zero, triggering generation');
            sendAdminLog('⏰ Timer scaduto! Avvio generazione automatica...', 'info');
            
            // Aggiorna lo stato a GENERATING
            const newState = updateGameState({
                status: 'GENERATING',
                isTimerRunning: false,
                generationTriggered: true
            });
            
            console.log('[CheckTimer] State updated to GENERATING');
            
            // Broadcast lo stato aggiornato
            broadcastEvent('state:update', newState);
            
            // Triggera la generazione in background (non bloccante)
            console.log('[CheckTimer] Starting triggerGeneration...');
            triggerGeneration(newState).catch(err => {
                console.error('[CheckTimer] Generation error:', err);
                sendAdminLog(`❌ Errore critico durante la generazione: ${err.message}`, 'error');
            });
            
            return res.status(200).json({ 
                success: true, 
                message: 'Generation triggered',
                state: newState 
            });
        } else {
            if (remaining > 0) {
                console.log('[CheckTimer] ⏳ Timer not yet zero, remaining:', remaining);
            }
            if (state.generationTriggered) {
                console.log('[CheckTimer] ⚠️ Generation already triggered');
                sendAdminLog('⚠️ Generazione già in corso', 'warning');
            }
        }
    } else {
        // Log quando le condizioni non sono soddisfatte
        const reasons = [];
        if (!state.isTimerRunning) {
            reasons.push('timer not running');
            console.log('[CheckTimer] ❌ Timer not running');
        }
        if (!state.timerStartTime) {
            reasons.push('no timerStartTime');
            console.log('[CheckTimer] ❌ No timerStartTime');
        }
        if (state.status !== 'WRITING') {
            reasons.push(`status is ${state.status}`);
            console.log('[CheckTimer] ❌ Status is not WRITING:', state.status);
        }
        if (state.generationTriggered) {
            reasons.push('generation already triggered');
            console.log('[CheckTimer] ❌ Generation already triggered');
        }
        sendAdminLog(`⚠️ Condizioni non soddisfatte: ${reasons.join(', ')}`, 'warning');
    }
    
    return res.status(200).json({ 
        success: true, 
        timer: state.timer,
        status: state.status,
        isTimerRunning: state.isTimerRunning,
        generationTriggered: state.generationTriggered,
        timerStartTime: state.timerStartTime
    });
}

