import { useEffect, useState, useRef } from 'react';
import { pollGameState } from '../../lib/api';
import styles from '../../styles/Screen.module.css';
import Logo from '../../components/Logo';

export default function Screen() {
    const [gameState, setGameState] = useState(null);
    const [localPrompts, setLocalPrompts] = useState({});
    const pollingIntervalRef = useRef(null);

    useEffect(() => {
        const pollState = async () => {
            try {
                const state = await pollGameState();
                setGameState(state);
                
                // Sync prompts from state
                const prompts = {};
                Object.values(state.participants).forEach(p => {
                    prompts[p.id] = p.prompt;
                });
                setLocalPrompts(prompts);
            } catch (error) {
                console.error('[Screen] Error polling state:', error);
            }
        };

        pollState();
        // Poll every 500ms for real-time updates
        pollingIntervalRef.current = setInterval(pollState, 500);

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, []);

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
                                    {localPrompts[p.id] || ''}<span className={styles.cursor}></span>
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
