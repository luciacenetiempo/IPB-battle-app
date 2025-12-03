import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { ref, onValue, runTransaction } from 'firebase/database';
import styles from '../../styles/Vote.module.css';
import Logo from '../../components/Logo';

export default function Vote() {
    const [gameState, setGameState] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);
    const [votedId, setVotedId] = useState(null);
    const [participants, setParticipants] = useState({});
    const [votingTimer, setVotingTimer] = useState(120);

    useEffect(() => {
        const stateRef = ref(db, 'gameState');
        const unsubscribe = onValue(stateRef, (snapshot) => {
            setGameState(snapshot.val());
        });

        const participantsRef = ref(db, 'participants');
        const unsubParticipants = onValue(participantsRef, (snapshot) => {
            setParticipants(snapshot.val() || {});
        });

        return () => {
            unsubscribe();
            unsubParticipants();
        };
    }, []);

    // Timer logic for voting
    useEffect(() => {
        if (!gameState || gameState.status !== 'VOTING') return;
        
        const interval = setInterval(() => {
            if (gameState.votingTimerStartTime) {
                const elapsed = Math.floor((Date.now() - gameState.votingTimerStartTime) / 1000);
                const remaining = Math.max(0, 120 - elapsed);
                setVotingTimer(remaining);
            } else {
                // Fallback: use votingTimer if votingTimerStartTime is not set
                setVotingTimer(gameState.votingTimer || 120);
            }
        }, 1000);
        
        return () => clearInterval(interval);
    }, [gameState]);

    const handleVote = async (id) => {
        if (hasVoted || gameState?.status !== 'VOTING' || !gameState?.round) return;
        
        try {
            const voteRef = ref(db, `participants/${id}/votes`);
            await runTransaction(voteRef, (currentVotes) => {
                return (currentVotes || 0) + 1;
            });
            
            // Save vote status to localStorage with round ID
            const storageKey = `vote_round_${gameState.round}`;
            localStorage.setItem(storageKey, JSON.stringify({
                hasVoted: true,
                votedId: id,
                round: gameState.round
            }));
            
            setHasVoted(true);
            setVotedId(id);
        } catch (error) {
            console.error('Error voting:', error);
        }
    };

    // Check if user has already voted in current round using localStorage
    useEffect(() => {
        if (!gameState || !gameState.round) return;
        
        const storageKey = `vote_round_${gameState.round}`;
        const votedData = localStorage.getItem(storageKey);
        
        if (votedData) {
            try {
                const { hasVoted: storedVoted, votedId: storedVotedId } = JSON.parse(votedData);
                if (storedVoted) {
                    setHasVoted(true);
                    setVotedId(storedVotedId);
                }
            } catch (e) {
                console.error('Error parsing vote data:', e);
            }
        } else {
            // Reset if new round
            setHasVoted(false);
            setVotedId(null);
        }
    }, [gameState?.round]);

    if (!gameState) return <div className={styles.container}>Loading...</div>;

    if (gameState.status === 'ENDED') {
        const participantsList = Object.values(participants);
        const winner = participantsList.sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <Logo size="small" />
                    <h1 className="glitch" data-text="VOTING ENDED">VOTING ENDED</h1>
                    {winner && (
                        <div className={styles.winner}>
                            <h2 className={styles.winnerLabel}>WINNER</h2>
                            <div className={styles.winnerName} style={{ color: winner.color }}>
                                {winner.name}
                            </div>
                            <div className={styles.winnerVotes}>
                                {winner.votes || 0} {winner.votes === 1 ? 'VOTE' : 'VOTES'}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (gameState.status !== 'VOTING') {
        return (
            <div className={styles.container}>
                <h1 className="glitch" data-text="WAITING">WAITING</h1>
                <p>Voting is not active.</p>
            </div>
        );
    }

    const participantsList = Object.values(participants);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Logo size="small" />
                {hasVoted ? (
                    <>
                        <h1 className={`${styles.title} glitch`} data-text="VOTE RECORDED">VOTE RECORDED</h1>
                        <p className={styles.subtitle}>Thank you for participating</p>
                    </>
                ) : (
                    <>
                        <h1 className={styles.title}>VOTE NOW</h1>
                        <div className={styles.timer}>
                            {votingTimer}s
                        </div>
                    </>
                )}
            </div>
            <div className={styles.grid}>
                {participantsList.map((p) => {
                    // p.id is the token here
                    const id = p.id || p.token;
                    const isVoted = hasVoted && votedId === id;
                    const isNotVoted = hasVoted && votedId !== id;
                    
                    return (
                        <div
                            key={id}
                            className={`${styles.card} ${isVoted ? styles.cardVoted : ''} ${isNotVoted ? styles.cardNotVoted : ''}`}
                            onClick={() => !hasVoted && handleVote(id)}
                            style={{
                                borderColor: isVoted ? p.color : '#333',
                                cursor: hasVoted ? 'not-allowed' : 'pointer',
                                pointerEvents: hasVoted ? 'none' : 'auto'
                            }}
                        >
                            {p.image ? (
                                <img
                                    src={p.image}
                                    alt={`Generated image for ${p.name}`}
                                    className={styles.image}
                                />
                            ) : (
                                <div className={styles.imagePlaceholder} style={{ backgroundColor: p.color + '22' }}>
                                    <div className={styles.imagePlaceholderText}>NO IMAGE</div>
                                </div>
                            )}
                            <div className={styles.name} style={{ color: p.color }}>{p.name}</div>
                            {isVoted && (
                                <div className={styles.votedBadge} style={{ color: p.color }}>
                                    ✓
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
