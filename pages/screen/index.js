import { useEffect, useState, useRef } from 'react';
import { db } from '../../lib/firebase';
import { ref, onValue, update } from 'firebase/database';
import styles from '../../styles/Screen.module.css';

export default function Screen() {
    const [gameState, setGameState] = useState(null);
    const [participants, setParticipants] = useState({});
    const promptRefs = useRef({});

    useEffect(() => {
        // Listen to GameState
        const stateRef = ref(db, 'gameState');
        const unsubscribe = onValue(stateRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setGameState(data);
            }
        });

        // Listen to Participants (real-time typing)
        const participantsRef = ref(db, 'participants');
        const unsubParticipants = onValue(participantsRef, (snapshot) => {
            const data = snapshot.val() || {};
            console.log('[SCREEN] Participants update received:', data);
            console.log('[SCREEN] Participant IDs:', Object.keys(data));
            Object.entries(data).forEach(([id, p]) => {
                console.log(`[SCREEN] Participant ${id}:`, {
                    name: p.name,
                    prompt: p.prompt?.substring(0, 20) + '...',
                    hasImage: !!p.image,
                    imageUrl: p.image
                });
            });
            setParticipants(data);
        });

        return () => {
            unsubscribe();
            unsubParticipants();
        };
    }, []);

    // Timer Logic
    const [displayTimer, setDisplayTimer] = useState(0);
    useEffect(() => {
        if (!gameState) return;
        const interval = setInterval(() => {
            if (gameState.status === 'WRITING' && gameState.startTime) {
                const elapsed = Math.floor((Date.now() - gameState.startTime) / 1000);
                const remaining = Math.max(0, gameState.duration - elapsed);
                setDisplayTimer(remaining);
            } else if (gameState.status === 'VOTING' && gameState.votingTimerStartTime) {
                // Calculate voting timer based on start time
                const elapsed = Math.floor((Date.now() - gameState.votingTimerStartTime) / 1000);
                const remaining = Math.max(0, 120 - elapsed);
                setDisplayTimer(remaining);
                
                // Auto-end voting when timer reaches 0
                if (remaining === 0 && gameState.status === 'VOTING') {
                    // Update status to ENDED in Firebase
                    update(ref(db, 'gameState'), { status: 'ENDED' });
                }
            } else if (gameState.status === 'VOTING') {
                // Fallback: use votingTimer if votingTimerStartTime is not set
                setDisplayTimer(gameState.votingTimer || 0);
            } else {
                setDisplayTimer(gameState.timer || 0);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [gameState]);

    // Auto-scroll logic: scroll to bottom when prompt changes
    useEffect(() => {
        if (!gameState || (gameState.status !== 'WRITING' && gameState.status !== 'GENERATING')) return;

        const scrollTimeouts = [];
        const participantsList = Object.entries(participants);

        participantsList.forEach(([id, p]) => {
            const contentRef = promptRefs.current[id];

            if (contentRef) {
                // Scroll to bottom with smooth animation
                const scrollToBottom = () => {
                    requestAnimationFrame(() => {
                        contentRef.scrollTo({
                            top: contentRef.scrollHeight,
                            behavior: 'smooth'
                        });
                    });
                };

                // Small delay to ensure DOM is updated with new prompt text
                const timeoutId = setTimeout(scrollToBottom, 100);
                scrollTimeouts.push(timeoutId);
            }
        });

        return () => {
            scrollTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        };
    }, [participants, gameState?.status]);

    if (!gameState) return <div className={styles.loading}>INITIALIZING...</div>;

    const participantsList = Object.entries(participants);
    const isVoting = gameState.status === 'VOTING' || gameState.status === 'ENDED';

    const participantCount = participantsList.length;
    const isTwoParticipants = participantCount === 2;

    const isFourParticipants = participantCount === 4;

    return (
        <div className={styles.container}>
            {!isFourParticipants && (
                <div className={styles.themeHeader}>
                    <span className={styles.roundLabel}>ROUND {gameState.round}</span>
                    {gameState.theme && (
                        <h1 className={`${styles.theme} glitch`} data-text={gameState.theme}>
                            {gameState.theme}
                        </h1>
                    )}
                </div>
            )}

            <div className={`${styles.grid} ${isTwoParticipants ? styles.gridTwo : styles.gridFour}`}>
                {participantsList.map(([id, p]) => {
                    const totalVotes = Object.values(participants).reduce((a, b) => a + (b.votes || 0), 0) || 1;
                    const votePercentage = isVoting ? ((p.votes || 0) / totalVotes) * 100 : 0;

                    return (
                        <div
                            key={id}
                            className={styles.card}
                            style={{ backgroundColor: p.color || '#B6FF6C' }}
                        >

                            <div
                                className={styles.cardContent}
                                ref={(el) => {
                                    if (el) {
                                        promptRefs.current[id] = el;
                                    }
                                }}
                            >
                                {/* WRITING MODE: Show prompt only */}
                                {gameState.status === 'WRITING' && (
                                    <div className={styles.promptDisplay}>
                                        {p.prompt || ''}<span className={styles.cursor}></span>
                                    </div>
                                )}

                                {/* GENERATING MODE: Show image large in center, no prompt */}
                                {gameState.status === 'GENERATING' && (
                                    <div className={styles.generatingWrapper}>
                                        {!p.image && (
                                            <div className={styles.generatingBadge}>
                                                <div className={styles.generatingSpinner}></div>
                                                <span>GENERATING...</span>
                                            </div>
                                        )}
                                        {p.image ? (
                                            <div className={styles.imageContainer}>
                                                <img
                                                    src={p.image}
                                                    alt={`Generated image for ${p.name}`}
                                                    className={styles.image}
                                                />
                                            </div>
                                        ) : (
                                            <div className={styles.imageContainer}>
                                                <div className={styles.placeholder}>
                                                    GENERATING...
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* VOTING MODE: Show image only */}
                                {isVoting && (
                                    <div className={styles.imageContainer}>
                                        {p.image ? (
                                            <img
                                                src={p.image}
                                                alt={`Generated image for ${p.name}`}
                                                className={styles.image}
                                            />
                                        ) : (
                                            <div className={styles.placeholder}>
                                                IMAGE_READY
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className={styles.cardFooter}>
                                {p.name}
                            </div>

                            {isVoting && (
                                <>
                                    <div
                                        className={styles.voteOverlay}
                                        style={{ height: `${votePercentage}%` }}
                                    />
                                    {votePercentage > 0 && (
                                        <div className={styles.votePercentage}>
                                            {Math.round(votePercentage)}%
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {!isFourParticipants && (
                <div className={styles.timerFooter}>
                    <div className={styles.timer}>
                        {displayTimer}<span className={styles.timerUnit}>s</span>
                    </div>
                </div>
            )}

            {gameState.status === 'ENDED' && (() => {
                const winner = participantsList.sort((a, b) => ((b[1]?.votes || 0) - (a[1]?.votes || 0)))[0]?.[1];
                return (
                    <div className={styles.winnerOverlay}>
                        {winner?.image && (
                            <div 
                                className={styles.winnerImageBackground}
                                style={{ backgroundImage: `url(${winner.image})` }}
                            />
                        )}
                        <div className={styles.winnerOverlayDark}>
                            <h1 className={`${styles.winnerTitle} glitch`} data-text="WINNER">
                                WINNER
                            </h1>
                            <h2 className={styles.winnerName}>
                                {winner?.name || 'No Winner'}
                            </h2>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
