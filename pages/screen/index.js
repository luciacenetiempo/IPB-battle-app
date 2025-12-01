import { useEffect, useState } from 'react';
import { getSocket } from '../../lib/socket';
import styles from '../../styles/Screen.module.css';
import Logo from '../../components/Logo';

export default function Screen() {
    const [gameState, setGameState] = useState(null);
    const [localPrompts, setLocalPrompts] = useState({});
    const socket = getSocket();

    useEffect(() => {
        socket.emit('join_room', 'screen');

        socket.on('state:update', (state) => {
            console.log('[Screen] State update received:', state.status, 'Participants:', Object.keys(state.participants || {}).length);
            setGameState(state);
            // Sync prompts from state on full update - questo assicura che i prompt siano sempre aggiornati
            const prompts = {};
            Object.values(state.participants || {}).forEach(p => {
                // Includi anche prompt vuoti per mantenere la sincronizzazione
                if (p.prompt !== undefined && p.prompt !== null) {
                    // Gestisce stringhe, oggetti annidati, ecc.
                    let promptValue = p.prompt;
                    if (typeof promptValue === 'object') {
                        if (typeof promptValue.prompt === 'string') {
                            promptValue = promptValue.prompt;
                        } else if (promptValue.prompt && typeof promptValue.prompt === 'object' && typeof promptValue.prompt.prompt === 'string') {
                            promptValue = promptValue.prompt.prompt;
                        } else {
                            promptValue = '';
                        }
                    }
                    // Assicurati che il prompt sia sempre una stringa
                    const promptStr = String(promptValue || '');
                    prompts[p.id] = promptStr;
                    if (promptStr && promptStr.length > 0) {
                        console.log('[Screen] Found prompt for', p.id, 'length:', promptStr.length, 'preview:', promptStr.substring(0, 30));
                    } else {
                        console.log('[Screen] Prompt for', p.id, 'is empty or invalid, type:', typeof p.prompt, 'value:', p.prompt);
                    }
                }
            });
            setLocalPrompts(prev => {
                // Merge con i prompt esistenti per non perdere aggiornamenti
                // Usa sempre i prompt dallo stato se disponibili
                const merged = { ...prev, ...prompts };
                console.log('[Screen] Updated prompts:', Object.keys(merged), 'prompts:', Object.keys(merged).map(id => ({ id, length: typeof merged[id] === 'string' ? merged[id].length : 0, type: typeof merged[id] })));
                return merged;
            });
        });

        socket.on('timer:update', (data) => {
            setGameState(prev => prev ? ({ ...prev, ...data }) : null);
        });

        socket.on('prompt:update', (data) => {
            console.log('[Screen] Prompt update received:', data, 'Full data:', JSON.stringify(data), 'has prompt:', 'prompt' in data, 'prompt value:', data?.prompt);
            if (data && data.id !== undefined) {
                // Prendi il prompt dall'evento - potrebbe essere una stringa o un oggetto con {prompt: "..."}
                let prompt = data.prompt;
                
                // Se il prompt è un oggetto, estrai la stringa
                if (prompt && typeof prompt === 'object' && prompt.prompt !== undefined) {
                    prompt = prompt.prompt;
                }
                
                // Aggiorna sempre, anche se il prompt è una stringa vuota
                if (prompt !== undefined) {
                    // Assicurati che il prompt sia sempre una stringa
                    const promptStr = String(prompt || '');
                    setLocalPrompts(prev => {
                        const updated = {
                            ...prev,
                            [data.id]: promptStr
                        };
                        console.log('[Screen] Updated localPrompts for', data.id, 'prompt length:', promptStr.length, 'preview:', promptStr.substring(0, 50));
                        return updated;
                    });
                } else {
                    // Se il prompt non è nell'evento, aggiorna dallo stato corrente usando setState callback
                    setGameState(currentState => {
                        if (currentState?.participants?.[data.id]?.prompt !== undefined) {
                            const prompt = currentState.participants[data.id].prompt;
                            // Assicurati che il prompt sia sempre una stringa
                            const promptStr = String(prompt || '');
                            setLocalPrompts(prev => {
                                const updated = { ...prev, [data.id]: promptStr };
                                console.log('[Screen] Updated localPrompts from state for', data.id, 'prompt length:', promptStr.length);
                                return updated;
                            });
                        } else {
                            console.warn('[Screen] Prompt update received but no prompt found for', data.id, 'in event or state');
                        }
                        return currentState;
                    });
                }
            }
        });

        return () => {
            socket.off('state:update');
            socket.off('timer:update');
            socket.off('prompt:update');
        };
    }, [socket]);

    if (!gameState) return <div className={styles.loading}>INITIALIZING...</div>;

    const participants = Object.values(gameState.participants);
    const isVoting = gameState.status === 'VOTING' || gameState.status === 'ENDED';

    return (
        <div className={styles.container}>
            <Logo size="medium" />
            <div className={styles.header}>
                <div className={styles.roundInfo}>
                    <span className={styles.roundLabel}>ROUND {gameState.round}</span>
                    <h1 className="glitch" data-text={gameState.theme}>{gameState.theme}</h1>
                </div>
                <div className={styles.timer}>
                    {isVoting ? gameState.votingTimer : gameState.timer}
                </div>
            </div>

            <div className={styles.grid}>
                {participants.map((p) => (
                    <div key={p.id} className={styles.card} style={{ backgroundColor: p.color || '#B6FF6C' }}>
                        <div className={styles.cardHeader}>
                            <span className={styles.playerName}>{p.name}</span>
                            {isVoting && <span className={styles.votes}>{p.votes} VOTES</span>}
                        </div>

                        <div className={styles.cardContent}>
                            {/* SHOW PROMPT IF WRITING OR GENERATING */}
                            {!isVoting && (
                                <div className={styles.promptDisplay}>
                                    {/* Mostra sempre il prompt più aggiornato da localPrompts o dallo stato */}
                                    {(() => {
                                        let displayPrompt = '';
                                        if (localPrompts[p.id] !== undefined) {
                                            displayPrompt = typeof localPrompts[p.id] === 'string' ? localPrompts[p.id] : String(localPrompts[p.id] || '');
                                        } else if (p.prompt) {
                                            if (typeof p.prompt === 'string') {
                                                displayPrompt = p.prompt;
                                            } else if (typeof p.prompt === 'object' && p.prompt.prompt) {
                                                displayPrompt = String(p.prompt.prompt || '');
                                            } else {
                                                displayPrompt = String(p.prompt || '');
                                            }
                                        }
                                        return displayPrompt;
                                    })()}<span className={styles.cursor}></span>
                                </div>
                            )}

                            {/* SHOW IMAGE IF GENERATING (Placeholder) OR VOTING */}
                            {(gameState.status === 'GENERATING' || isVoting) && (
                                <div className={styles.imageContainer}>
                                    {p.image ? (
                                        <img src={p.image} alt={`Generated image for ${p.name}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    ) : (
                                        <div className={styles.placeholder}>
                                            {gameState.status === 'GENERATING' ? 'GENERATING...' : 'IMAGE_READY'}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {isVoting && (
                            <div
                                className={styles.voteOverlay}
                                style={{ height: `${(p.votes / (Object.values(gameState.participants).reduce((a, b) => a + b.votes, 0) || 1)) * 100}%` }}
                            />
                        )}
                    </div>
                ))}
            </div>

            {gameState.status === 'ENDED' && (
                <div className={styles.winnerOverlay}>
                    <h1 className="glitch" data-text="WINNER">WINNER</h1>
                    {/* Logic to calculate winner */}
                    <h2>{participants.sort((a, b) => b.votes - a.votes)[0]?.name}</h2>
                </div>
            )}
        </div>
    );
}
