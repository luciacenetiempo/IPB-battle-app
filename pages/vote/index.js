import { useEffect, useState, useRef } from 'react';
import { pollGameState, voteCast } from '../../lib/api';
import styles from '../../styles/Vote.module.css';
import Logo from '../../components/Logo';

export default function Vote() {
    const [gameState, setGameState] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const pollingIntervalRef = useRef(null);

    useEffect(() => {
        const pollState = async () => {
            try {
                const state = await pollGameState();
                setGameState(state);
            } catch (error) {
                console.error('[Vote] Error polling state:', error);
            }
        };

        pollState();
        // Poll every 1 second for voting page
        pollingIntervalRef.current = setInterval(pollState, 1000);

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, []);

    const handleVote = (id) => {
        if (hasVoted) return;
        setSelectedId(id);
    };

    const confirmVote = async () => {
        if (!selectedId) return;

        try {
            await voteCast(selectedId);
            setHasVoted(true);
            // Persist vote to avoid refresh-spam
            if (gameState) {
                localStorage.setItem(`voted_round_${gameState.round}`, 'true');
            }
        } catch (error) {
            console.error('[Vote] Error casting vote:', error);
            alert('Errore nel votare: ' + error.message);
        }
    };

    // Check local storage on load/round change
    useEffect(() => {
        if (gameState) {
            const voted = localStorage.getItem(`voted_round_${gameState.round}`);
            if (voted) setHasVoted(true);
        }
    }, [gameState?.round]);

    if (!gameState) return <div className={styles.container}>Loading...</div>;

    if (gameState.status !== 'VOTING') {
        return (
            <div className={styles.container}>
                <h1 className="glitch" data-text="WAITING">WAITING</h1>
                <p>Voting is not active.</p>
            </div>
        );
    }

    if (hasVoted) {
        return (
            <div className={styles.container}>
                <h1 className="glitch" data-text="VOTE RECORDED">VOTE RECORDED</h1>
                <p>Thank you for participating.</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <Logo size="small" />
            <h1>VOTE NOW</h1>
            <div className={styles.grid}>
                {Object.values(gameState.participants).map((p) => (
                    <div
                        key={p.id}
                        className={`${styles.card} ${selectedId === p.id ? styles.selected : ''}`}
                        onClick={() => handleVote(p.id)}
                        style={{ borderColor: p.color, boxShadow: selectedId === p.id ? `0 0 15px ${p.color}` : 'none' }}
                    >
                        {/* Placeholder for image */}
                        <div className={styles.imagePlaceholder} style={{ backgroundColor: p.color + '22' }}>
                            IMAGE {p.name}
                        </div>
                        <div className={styles.name} style={{ color: p.color }}>{p.name}</div>
                    </div>
                ))}
            </div>

            <button
                className={styles.voteButton}
                disabled={!selectedId}
                onClick={confirmVote}
            >
                CONFIRM VOTE
            </button>
        </div>
    );
}
