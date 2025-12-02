import { useEffect, useState } from 'react';
import { getSocket } from '../../lib/socket';
import styles from '../../styles/Vote.module.css';
import Logo from '../../components/Logo';

export default function Vote() {
    const [gameState, setGameState] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const socket = getSocket();

    useEffect(() => {
        socket.on('state:update', (state) => {
            setGameState(state);
        });

        return () => {
            socket.off('state:update');
        };
    }, []);

    const handleVote = (id) => {
        if (hasVoted) return;
        setSelectedId(id);
    };

    const confirmVote = () => {
        if (selectedId) {
            socket.emit('vote:cast', selectedId);
            setHasVoted(true);
            // Persist vote to avoid refresh-spam (simple version)
            localStorage.setItem(`voted_round_${gameState.round}`, 'true');
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
            <div className={styles.header}>
                <Logo size="small" />
                <h1 className={styles.title}>VOTE NOW</h1>
            </div>
            <div className={styles.grid}>
                {Object.values(gameState.participants).map((p) => (
                    <div
                        key={p.id}
                        className={`${styles.card} ${selectedId === p.id ? styles.selected : ''}`}
                        onClick={() => handleVote(p.id)}
                        style={{ 
                            borderColor: selectedId === p.id ? p.color : '#333', 
                            boxShadow: selectedId === p.id ? `0 0 20px ${p.color}` : 'none',
                            borderWidth: selectedId === p.id ? '4px' : '3px'
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
                        {selectedId === p.id && (
                            <div className={styles.checkmark} style={{ color: p.color }}>
                                ✓
                            </div>
                        )}
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
