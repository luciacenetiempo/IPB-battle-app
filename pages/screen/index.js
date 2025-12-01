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
            setGameState(prevState => {
                // Mantieni lo stato precedente per il fallback dei prompt
                return state;
            });
            // Sync prompts from state on full update - questo assicura che i prompt siano sempre aggiornati
            const prompts = {};
            Object.values(state.participants || {}).forEach(p => {
                // Includi anche prompt vuoti per mantenere la sincronizzazione
                if (p.prompt !== undefined && p.prompt !== null) {
                    prompts[p.id] = p.prompt;
                    if (p.prompt && p.prompt.length > 0) {
                        console.log('[Screen] Found prompt for', p.id, 'length:', p.prompt.length, 'preview:', p.prompt.substring(0, 30));
                    }
                }
            });
            setLocalPrompts(prev => {
                // Merge con i prompt esistenti per non perdere aggiornamenti
                // Usa sempre i prompt dallo stato se disponibili
                const merged = { ...prev, ...prompts };
                console.log('[Screen] Updated prompts:', Object.keys(merged), 'prompts:', Object.keys(merged).map(id => ({ id, length: merged[id]?.length || 0 })));
                return merged;
            });
        });

        socket.on('timer:update', (data) => {
            setGameState(prev => prev ? ({ ...prev, ...data }) : null);
        });

        socket.on('prompt:update', (data) => {
            console.log('[Screen] Prompt update received:', data, 'Full data:', JSON.stringify(data), 'gameState:', gameState?.participants?.[data?.id]);
            if (data && data.id !== undefined) {
                // Prendi il prompt dall'evento o dallo stato corrente
                let prompt = data.prompt;
                if (prompt === undefined || prompt === null) {
                    // Se il prompt non è presente nell'evento, prendilo dallo stato
                    prompt = gameState?.participants?.[data.id]?.prompt;
                    console.log('[Screen] Prompt not in event, taking from state:', prompt?.substring(0, 50));
                }
                
                if (prompt !== undefined && prompt !== null) {
                    setLocalPrompts(prev => {
                        const updated = {
                            ...prev,
                            [data.id]: prompt
                        };
                        console.log('[Screen] Updated localPrompts for', data.id, 'prompt length:', prompt?.length, 'preview:', prompt?.substring(0, 50));
                        return updated;
                    });
                } else {
                    console.warn('[Screen] Prompt update received but no prompt found for', data.id, 'in event or state');
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
                                    {(localPrompts[p.id] !== undefined ? localPrompts[p.id] : (p.prompt || ''))}<span className={styles.cursor}></span>
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
