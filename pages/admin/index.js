import { useEffect, useState } from 'react';
import { getSocket } from '../../lib/socket';
import styles from '../../styles/Admin.module.css';
import Logo from '../../components/Logo';

export default function Admin() {
    const [gameState, setGameState] = useState(null);
    const [themeInput, setThemeInput] = useState('');
    const [timerDuration, setTimerDuration] = useState(60);
    const [participantCount, setParticipantCount] = useState(2);
    const socket = getSocket();

    const [logs, setLogs] = useState([]);
    const logsEndRef = require('react').useRef(null);

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [logs]);

    useEffect(() => {
        // Join admin room to receive logs
        socket.emit('join_room', 'admin');
        console.log('[Admin] Joined admin room');

        socket.on('state:update', (state) => {
            setGameState(state);
            if (state.theme) setThemeInput(state.theme);
        });

        socket.on('timer:update', (data) => {
            setGameState(prev => ({ ...prev, ...data }));
        });

        socket.on('admin:log', (log) => {
            console.log('[Admin] Received log:', log);
            setLogs(prev => [...prev, log]);
        });

        return () => {
            socket.off('state:update');
            socket.off('timer:update');
            socket.off('admin:log');
        };
    }, []);

    const startRound = () => {
        socket.emit('admin:start_round', {
            theme: themeInput,
            timer: timerDuration,
            participantCount: participantCount
        });
    };

    const stopTimer = () => {
        socket.emit('admin:stop_timer');
    };

    const triggerGeneration = () => {
        console.log('[Admin] Triggering generation...');
        socket.emit('admin:trigger_generation');
    };

    const startVoting = () => {
        socket.emit('admin:start_voting');
    };

    if (!gameState) return <div className={styles.container}>Loading...</div>;

    const isRoundActive = gameState.status === 'WRITING';
    const isVotingActive = gameState.status === 'VOTING';

    return (
        <div className={styles.container}>
            <Logo size="small" />
            <div className={styles.header}>
                <div>
                    <div className={styles.title}>REGIA // CONTROL PANEL</div>
                    <div className={styles.roundDisplay}>ROUND {gameState.round}</div>
                </div>
                <div className={`${styles.statusBadge} ${gameState.status !== 'IDLE' ? styles.active : ''}`}>
                    {gameState.status}
                    {gameState.status === 'WAITING_FOR_PLAYERS' && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                            ({Object.keys(gameState.participants).length}/{gameState.expectedParticipantCount})
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.mainGrid}>
                <div className={styles.controlPanel}>
                    <section className={styles.section}>
                        <div className={styles.sectionTitle}>Round Setup</div>
                        <input
                            className={styles.themeInput}
                            type="text"
                            value={themeInput}
                            onChange={(e) => setThemeInput(e.target.value)}
                            placeholder="Enter Round Theme..."
                        />

                        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '2rem' }}>
                            <div>
                                <div className={styles.sectionTitle}>Timer</div>
                                <div className={styles.timerControls}>
                                    {[60, 120, 180].map(time => (
                                        <button
                                            key={time}
                                            className={`${styles.timeBtn} ${timerDuration === time ? styles.selected : ''}`}
                                            onClick={() => setTimerDuration(time)}
                                        >
                                            {time}s
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className={styles.sectionTitle}>Participants</div>
                                <div className={styles.timerControls}>
                                    {[2, 4].map(count => (
                                        <button
                                            key={count}
                                            className={`${styles.timeBtn} ${participantCount === count ? styles.selected : ''}`}
                                            onClick={() => setParticipantCount(count)}
                                        >
                                            {count}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    <div className={styles.actionGrid}>
                        <button
                            className={`${styles.actionBtn} ${styles.btnPrimary}`}
                            onClick={startRound}
                            disabled={isRoundActive}
                        >
                            Start Round
                        </button>

                        <button
                            className={`${styles.actionBtn} ${styles.btnDestructive}`}
                            onClick={stopTimer}
                            disabled={!gameState.isTimerRunning}
                        >
                            Stop Timer
                        </button>

                        <button
                            className={`${styles.actionBtn} ${styles.btnSecondary}`}
                            onClick={triggerGeneration}
                            disabled={gameState.status === 'GENERATING' || gameState.status === 'VOTING'}
                        >
                            Trigger Gen
                        </button>

                        <button
                            className={`${styles.actionBtn} ${styles.btnVote}`}
                            onClick={startVoting}
                            disabled={isVotingActive}
                        >
                            Start Voting
                        </button>
                    </div>
                </div>

                <div className={styles.infoPanel}>
                    <div className={styles.statCard}>
                        <div className={styles.statValue}>
                            {gameState.status === 'VOTING' ? gameState.votingTimer : gameState.timer}
                        </div>
                        <div className={styles.statLabel}>Seconds Remaining</div>
                    </div>

                    {gameState.validTokens && gameState.validTokens.length > 0 && (
                        <div className={styles.section} style={{ textAlign: 'center' }}>
                            <div className={styles.sectionTitle}>Access Tokens</div>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold', letterSpacing: '2px', color: 'var(--secondary-color)' }}>
                                {gameState.validTokens.join('   ')}
                            </div>
                        </div>
                    )}

                    <div className={styles.participantsList}>
                        <div className={styles.listHeader}>
                            Connected ({Object.keys(gameState.participants).length} / {gameState.validTokens ? gameState.validTokens.length : 0})
                        </div>
                        <div className={styles.listContent}>
                            {Object.values(gameState.participants).map(p => (
                                <div key={p.id} className={styles.participantRow}>
                                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: p.color, marginRight: '8px', display: 'inline-block' }}></div>
                                    <span>{p.name} <small style={{ color: '#666' }}>({p.token})</small></span>
                                    <div className={styles.participantStatus}
                                        style={{ background: p.prompt ? '#00ff00' : '#444' }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Log Panel */}
            <div className={styles.logPanel} style={{ marginTop: '2rem', padding: '1rem', background: '#111', borderRadius: '8px', border: '1px solid #333', maxHeight: '300px', overflowY: 'auto', fontFamily: 'monospace' }}>
                <div style={{ position: 'sticky', top: 0, background: '#111', paddingBottom: '0.5rem', borderBottom: '1px solid #333', marginBottom: '0.5rem', fontWeight: 'bold', color: '#888' }}>SYSTEM LOGS</div>
                {logs.map((log, i) => (
                    <div key={i} style={{ marginBottom: '4px', color: log.type === 'error' ? '#ff4444' : log.type === 'success' ? '#44ff44' : log.type === 'warning' ? '#ffaa00' : '#ccc', fontSize: '0.9rem' }}>
                        <span style={{ color: '#666', marginRight: '8px' }}>[{log.timestamp}]</span>
                        {log.msg}
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
}
