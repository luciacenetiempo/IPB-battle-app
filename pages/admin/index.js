import { useEffect, useState, useRef } from 'react';
import { db } from '../../lib/firebase';
import { ref, onValue, update, set, push } from 'firebase/database';
import styles from '../../styles/Admin.module.css';
import Logo from '../../components/Logo';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export default function Admin() {
    const [gameState, setGameState] = useState({
        sessionId: '',
        round: 0,
        status: 'IDLE',
        participants: {},
        validTokens: [],
        timer: 60,
        votingTimer: 120,
        startTime: 0,
        duration: 60
    });
    const [themeInput, setThemeInput] = useState('');
    const [timerDuration, setTimerDuration] = useState(60);
    const [participantCount, setParticipantCount] = useState(2);
    const [logs, setLogs] = useState([]);
    const [history, setHistory] = useState({});
    const [allHistory, setAllHistory] = useState({}); // Store all history for filtering
    const [expandedRound, setExpandedRound] = useState('current'); // ID of expanded round
    const logsEndRef = useRef(null);
    const generationTriggeredRef = useRef(false); // Track if generation was triggered

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [logs]);

    // Add log helper
    const addLog = (msg, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { timestamp, msg, type }]);
    };

    // Filter history by sessionId - only show rounds from current session
    const filterHistoryBySession = (historyData, sessionId) => {
        setAllHistory(historyData);
        if (sessionId) {
            const filteredHistory = {};
            let totalRounds = 0;
            let matchedRounds = 0;
            const sessionIds = new Set();
            
            Object.entries(historyData).forEach(([id, roundData]) => {
                totalRounds++;
                if (roundData) {
                    if (roundData.sessionId) {
                        sessionIds.add(roundData.sessionId);
                    }
                    // Only include rounds from current session (no legacy rounds)
                    if (roundData.sessionId === sessionId) {
                        filteredHistory[id] = roundData;
                        matchedRounds++;
                    }
                }
            });
            
            console.log(`[History Filter] SessionId: ${sessionId}, Total rounds: ${totalRounds}, Matched: ${matchedRounds}`);
            console.log(`[History Filter] Found sessionIds in history:`, Array.from(sessionIds));
            if (totalRounds > 0 && matchedRounds === 0) {
                const sampleRound = Object.values(historyData).find(rd => rd);
                console.log('[History Filter] No rounds matched! Sample round data:', sampleRound);
                console.log('[History Filter] Looking for sessionId:', sessionId, 'Type:', typeof sessionId);
            }
            
            setHistory(filteredHistory);
        } else {
            // If no sessionId yet, show empty history (new session)
            setHistory({});
        }
    };

    useEffect(() => {
        // Listen to gameState
        const stateRef = ref(db, 'gameState');
        const unsubscribe = onValue(stateRef, async (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setGameState(prev => ({ ...prev, ...data }));
                if (data.theme && !themeInput) setThemeInput(data.theme);

                // Initialize session ID if it doesn't exist
                if (!data.sessionId) {
                    const newSessionId = `session-${Date.now()}`;
                    await update(ref(db, 'gameState'), { sessionId: newSessionId });
                    addLog(`🆔 Session initialized: ${newSessionId}`, 'info');
                }
            }
        });

        // Listen to participants
        const participantsRef = ref(db, 'participants');
        console.log('Client DB URL:', db.app.options.databaseURL); // Debug Client URL

        const unsubParticipants = onValue(participantsRef, (snapshot) => {
            const data = snapshot.val() || {};
            console.log('Client received participants update:', Object.keys(data).length, data); // Debug Data
            setGameState(prev => ({ ...prev, participants: data }));
        });

        // Listen to history
        const historyRef = ref(db, 'history');
        const unsubHistory = onValue(historyRef, (snapshot) => {
            const historyData = snapshot.val() || {};
            // Store all history - will be filtered when gameState.sessionId is available
            setAllHistory(historyData);
        });

        return () => {
            unsubscribe();
            unsubParticipants();
            unsubHistory();
        };
    }, []);

    // Re-filter history when sessionId changes or when allHistory updates
    useEffect(() => {
        if (gameState.sessionId) {
            filterHistoryBySession(allHistory, gameState.sessionId);
        } else if (Object.keys(allHistory).length > 0) {
            // If no sessionId yet, show empty history
            setHistory({});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState.sessionId, allHistory]);

    // Timer logic for display
    const [displayTimer, setDisplayTimer] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            if (gameState.status === 'WRITING' && gameState.startTime) {
                const elapsed = Math.floor((Date.now() - gameState.startTime) / 1000);
                const remaining = Math.max(0, gameState.duration - elapsed);
                setDisplayTimer(remaining);

                if (remaining === 0 && gameState.status === 'WRITING') {
                    // Timer ended, trigger generation automatically
                    if (!generationTriggeredRef.current) {
                        generationTriggeredRef.current = true;
                        addLog('⏰ Timer ended! Auto-triggering generation...', 'info');
                        triggerGeneration();
                    }
                }
            } else if (gameState.status === 'VOTING' && gameState.votingTimerStartTime) {
                // Calculate voting timer based on start time
                const elapsed = Math.floor((Date.now() - gameState.votingTimerStartTime) / 1000);
                const remaining = Math.max(0, 120 - elapsed);
                setDisplayTimer(remaining);
                
                // Auto-end voting when timer reaches 0
                if (remaining === 0 && gameState.status === 'VOTING') {
                    // Use async function to update state
                    (async () => {
                        try {
                            await update(ref(db, 'gameState'), { status: 'ENDED' });
                            addLog('⏰ Voting timer ended! Winner declared.', 'info');
                        } catch (e) {
                            addLog(`Error ending voting: ${e.message}`, 'error');
                        }
                    })();
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

    const startRound = async () => {
        // IMPORTANT: Archive previous round BEFORE starting new one
        const previousRound = gameState.round || 0;
        let participantsToArchive = null;
        
        if (previousRound > 0) {
            try {
                // Get fresh participants data from database before clearing
                const participantsRef = ref(db, 'participants');
                const participantsSnapshot = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout')), 2000);
                    onValue(participantsRef, (snapshot) => {
                        clearTimeout(timeout);
                        resolve(snapshot);
                    }, { onlyOnce: true });
                });
                participantsToArchive = participantsSnapshot.val() || gameState.participants;
            } catch (e) {
                console.warn('[Start Round] Could not fetch participants from DB, using gameState:', e);
                participantsToArchive = gameState.participants;
            }

            // Archive previous round if it has data
            if (participantsToArchive && Object.keys(participantsToArchive).length > 0) {
                const roundId = `round-${previousRound}-${Date.now()}`;
                const currentSessionId = gameState.sessionId || 'legacy';
                const roundData = {
                    round: previousRound,
                    theme: gameState.theme || '',
                    participants: participantsToArchive,
                    timestamp: Date.now(),
                    sessionId: currentSessionId
                };
                try {
                    await set(ref(db, `history/${roundId}`), roundData);
                    console.log(`[Start Round] ✅ Previous round ${previousRound} archived!`, {
                        roundId: roundId,
                        round: roundData.round,
                        theme: roundData.theme,
                        participantsCount: Object.keys(roundData.participants).length,
                        sessionId: roundData.sessionId,
                        sessionIdType: typeof roundData.sessionId,
                        currentSessionId: currentSessionId,
                        currentSessionIdType: typeof currentSessionId
                    });
                    addLog(`✅ Round ${previousRound} archived to history (session: ${currentSessionId}).`, 'success');
                } catch (e) {
                    console.error(`[Start Round] ❌ Error archiving previous round:`, e);
                    addLog(`Error archiving previous round: ${e.message}`, 'error');
                }
            }
        }

        // Now start the new round
        const round = previousRound + 1;

        // Generate tokens
        const tokens = [];
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for (let i = 0; i < participantCount; i++) {
            let token = '';
            for (let j = 0; j < 4; j++) {
                token += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            tokens.push(token);
        }

        const updates = {};
        updates['gameState/round'] = round;
        updates['gameState/theme'] = themeInput;
        updates['gameState/status'] = 'WAITING_FOR_PLAYERS';
        updates['gameState/timer'] = timerDuration;
        updates['gameState/duration'] = timerDuration;
        updates['gameState/expectedParticipantCount'] = participantCount;
        updates['gameState/validTokens'] = tokens;
        updates['gameState/startTime'] = 0; // Reset start time
        updates['participants'] = null; // Clear participants

        try {
            await update(ref(db), updates);
            generationTriggeredRef.current = false; // Reset flag for new round
            addLog(`Round ${round} started. Waiting for ${participantCount} players.`, 'success');
        } catch (e) {
            addLog(`Error starting round: ${e.message}`, 'error');
        }
    };

    const stopTimer = async () => {
        await update(ref(db, 'gameState'), {
            status: 'GENERATING', // Or IDLE?
            startTime: 0
        });
        addLog('Timer stopped manually', 'warning');
    };

    const triggerGeneration = async () => {
        addLog('Triggering generation...', 'info');
        try {
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roundId: gameState.round })
            });
            const data = await res.json();
            if (data.success) {
                addLog('Generation started successfully', 'success');

                // Manual Client-Side Update (Fallback)
                if (data.results) {
                    const updates = {};
                    Object.entries(data.results).forEach(([id, url]) => {
                        updates[`participants/${id}/image`] = url;
                    });

                    // Only sync images, do NOT auto-start voting
                    await update(ref(db), updates);
                    addLog('✅ Images synced! Ready to start voting.', 'success');
                }

            } else {
                addLog(`Generation failed: ${data.error}`, 'error');
            }
        } catch (e) {
            addLog(`Error calling generation API: ${e.message}`, 'error');
        }
    };

    const startVoting = async () => {
        const votingTimerStartTime = Date.now();
        await update(ref(db, 'gameState'), {
            status: 'VOTING',
            votingTimer: 120,
            votingTimerStartTime: votingTimerStartTime
        });
        addLog('Voting started - 120 seconds timer', 'success');
    };

    const resetGame = async () => {
        // Confirmation dialog to prevent accidental resets
        if (!confirm('Sei sicuro di voler resettare il gioco? Tutti i partecipanti verranno disconnessi e i dati cancellati.')) {
            return;
        }

        // IMPORTANT: Get participants from database BEFORE clearing them
        let participantsToArchive = gameState.participants;
        if (gameState.round > 0) {
            try {
                // Get fresh participants data from database
                const participantsRef = ref(db, 'participants');
                const participantsSnapshot = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout')), 2000);
                    onValue(participantsRef, (snapshot) => {
                        clearTimeout(timeout);
                        resolve(snapshot);
                    }, { onlyOnce: true });
                });
                participantsToArchive = participantsSnapshot.val() || gameState.participants;
            } catch (e) {
                console.warn('[Archive Round] Could not fetch participants from DB, using gameState:', e);
                participantsToArchive = gameState.participants;
            }
        }

        // Archive current round if it has data
        if (gameState.round > 0 && participantsToArchive && Object.keys(participantsToArchive).length > 0) {
            const roundId = `round-${gameState.round}-${Date.now()}`;
            const currentSessionId = gameState.sessionId || 'legacy';
            const roundData = {
                round: gameState.round,
                theme: gameState.theme || '',
                participants: participantsToArchive,
                timestamp: Date.now(),
                sessionId: currentSessionId
            };
            try {
                await set(ref(db, `history/${roundId}`), roundData);
                console.log(`[Archive Round] Round ${gameState.round} archived with sessionId: ${currentSessionId}`, {
                    round: roundData.round,
                    theme: roundData.theme,
                    participantsCount: Object.keys(roundData.participants).length,
                    sessionId: roundData.sessionId
                });
                addLog(`Round ${gameState.round} archived to history (session: ${currentSessionId}).`, 'success');
            } catch (e) {
                console.error(`[Archive Round] Error:`, e);
                addLog(`Error archiving round: ${e.message}`, 'error');
            }
        } else {
            console.log(`[Archive Round] Skipping archive - round: ${gameState.round}, hasParticipants: ${!!participantsToArchive && Object.keys(participantsToArchive).length > 0}`);
        }

        const updates = {};
        updates['gameState/round'] = 0;
        updates['gameState/theme'] = '';
        updates['gameState/status'] = 'IDLE';
        updates['gameState/timer'] = 60;
        updates['gameState/duration'] = 60;
        updates['gameState/votingTimer'] = 120;
        updates['gameState/expectedParticipantCount'] = 2;
        updates['gameState/validTokens'] = null;
        updates['gameState/startTime'] = 0;
        updates['participants'] = null; // Clear all participants

        try {
            await update(ref(db), updates);
            setThemeInput(''); // Clear local theme input
            generationTriggeredRef.current = false; // Reset flag
            addLog('🔄 Game reset to IDLE. All participants cleared.', 'warning');
        } catch (e) {
            addLog(`Error resetting game: ${e.message}`, 'error');
        }
    };

    const closeSession = async () => {
        // Confirmation dialog to prevent accidental session closure
        if (!confirm('Sei sicuro di voler chiudere la sessione? Tutti i dati verranno archiviati e verrà creata una nuova sessione.')) {
            return;
        }

        addLog('Closing session...', 'info');

        try {
            const res = await fetch('/api/close-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            // Check if response is ok and is JSON
            if (!res.ok) {
                const text = await res.text();
                console.error('[Close Session] API error response:', text);
                addLog(`Error closing session: HTTP ${res.status} - ${text.substring(0, 100)}`, 'error');
                return;
            }

            // Check content type
            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await res.text();
                console.error('[Close Session] API returned non-JSON:', text.substring(0, 200));
                addLog(`Error closing session: Server returned invalid response`, 'error');
                return;
            }

            const data = await res.json();

            if (data.success) {
                setThemeInput(''); // Clear local theme input
                generationTriggeredRef.current = false; // Reset flag
                addLog(`✅ Session closed successfully. New session: ${data.newSessionId}`, 'success');
                if (data.archivedRound) {
                    addLog(`📦 Round ${data.archivedRound} archived to history.`, 'info');
                }
            } else {
                addLog(`Error closing session: ${data.error}`, 'error');
            }
        } catch (e) {
            console.error('[Close Session] Error:', e);
            addLog(`Error calling close-session API: ${e.message}`, 'error');
        }
    };

    const downloadRoundImages = async (roundData, roundName) => {
        const zip = new JSZip();
        const folder = zip.folder(roundName);
        const participants = Object.values(roundData.participants || {});

        let count = 0;
        for (const p of participants) {
            if (p.image) {
                try {
                    const response = await fetch(p.image);
                    const blob = await response.blob();
                    // Clean name for filename
                    const safeName = p.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    folder.file(`${safeName}.webp`, blob);
                    count++;
                } catch (e) {
                    console.error('Error downloading image', e);
                    addLog(`Error downloading image for ${p.name}`, 'error');
                }
            }
        }

        if (count > 0) {
            zip.generateAsync({ type: "blob" }).then((content) => {
                saveAs(content, `${roundName}.zip`);
                addLog(`Downloaded ${count} images for ${roundName}`, 'success');
            });
        } else {
            addLog(`No images found for ${roundName}`, 'warning');
        }
    };

    if (!gameState) return <div className={styles.container}>Loading...</div>;

    const isRoundActive = gameState.status === 'WRITING';
    const isVotingActive = gameState.status === 'VOTING';

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <div className={styles.logoWrapper}>
                        <Logo size="small" />
                    </div>
                    <div>
                        <div className={styles.title}>REGIA // CONTROL PANEL</div>
                        <div className={styles.roundDisplay}>ROUND {gameState.round}</div>
                    </div>
                </div>
                <div className={`${styles.statusBadge} ${gameState.status !== 'IDLE' ? styles.active : ''}`}>
                    {gameState.status}
                    {gameState.status === 'WAITING_FOR_PLAYERS' && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                            ({Object.keys(gameState.participants || {}).length}/{gameState.expectedParticipantCount})
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

                        <div className={styles.sectionSeparator}></div>

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

                    <div className={styles.sectionSeparator}></div>

                    <div className={styles.actionGrid}>
                        <button
                            className={`${styles.actionBtn} ${styles.btnPrimary}`}
                            onClick={startRound}
                            disabled={isRoundActive}
                        >
                            Start Round
                        </button>

                        <button
                            className={`${styles.actionBtn} ${styles.btnVote}`}
                            onClick={startVoting}
                            disabled={isVotingActive}
                        >
                            Start Voting
                        </button>
                    </div>

                    <div className={styles.helpCenterSection}>
                        <div className={styles.helpCenterTitle}>HELP CENTER</div>
                        <div className={styles.secondaryActions}>
                            <button
                                className={styles.textLink}
                                onClick={stopTimer}
                                disabled={gameState.status !== 'WRITING'}
                            >
                                Stop Timer
                            </button>

                            <button
                                className={styles.textLink}
                                onClick={triggerGeneration}
                                disabled={gameState.status === 'GENERATING' || gameState.status === 'VOTING'}
                            >
                                Trigger Generation
                            </button>

                            <button
                                className={`${styles.actionBtn} ${styles.btnWarning}`}
                                onClick={resetGame}
                            >
                                <span className={styles.warningIcon}>⚠</span>
                                Stop Round / Reset
                            </button>

                            <button
                                className={`${styles.actionBtn} ${styles.btnDanger}`}
                                onClick={closeSession}
                            >
                                <span className={styles.warningIcon}>🔒</span>
                                Chiudi Sessione
                            </button>
                        </div>
                    </div>
                </div>

                <div className={styles.infoPanel}>
                    <div className={styles.statCard}>
                        <div className={styles.statValue}>
                            {displayTimer}
                        </div>
                        <div className={styles.statLabel}>Seconds Remaining</div>
                    </div>

                    {gameState.validTokens && gameState.validTokens.length > 0 && (
                        <div className={styles.tokensSection}>
                            <div className={styles.sectionTitle}>Access Tokens</div>
                            <div className={styles.tokensDisplay}>
                                {gameState.validTokens.join('   ')}
                            </div>
                        </div>
                    )}

                    <div className={styles.participantsList}>
                        {/* Current Round Accordion */}
                        <div className={`${styles.accordionItem} ${expandedRound === 'current' ? styles.expanded : ''}`}>
                            <div
                                className={styles.accordionHeader}
                                onClick={() => setExpandedRound(expandedRound === 'current' ? null : 'current')}
                            >
                                <span className={styles.accordionTitle}>
                                    CURRENT ROUND {gameState.round > 0 ? `(${gameState.round})` : ''}
                                </span>
                                <span className={styles.accordionIcon}>{expandedRound === 'current' ? '▼' : '▶'}</span>
                            </div>

                            {expandedRound === 'current' && (
                                <div className={styles.accordionContent}>
                                    <div className={styles.listHeader}>
                                        Connected ({Object.keys(gameState.participants || {}).length} / {gameState.validTokens ? gameState.validTokens.length : 0})
                                    </div>
                                    <div className={styles.listContent}>
                                        {Object.values(gameState.participants || {})
                                            .sort((a, b) => {
                                                // Sort by votes descending if voting/ended
                                                if (gameState.status === 'VOTING' || gameState.status === 'ENDED') {
                                                    return (b.votes || 0) - (a.votes || 0);
                                                }
                                                return 0; // No sort otherwise
                                            })
                                            .map((p, idx) => (
                                                <div key={p.id} className={styles.participantRow}>
                                                    <div className={styles.participantInfo}>
                                                        {(gameState.status === 'VOTING' || gameState.status === 'ENDED') && (
                                                            <span className={`${styles.participantRank} ${idx === 0 ? styles.first : styles.other}`}>
                                                                #{idx + 1}
                                                            </span>
                                                        )}
                                                        <div
                                                            className={styles.participantColorDot}
                                                            style={{ backgroundColor: p.color }}
                                                        />
                                                        <span className={styles.participantName}>
                                                            {p.name} <span className={styles.participantToken}>({p.token})</span>
                                                        </span>
                                                    </div>
                                                    <div className={styles.participantMeta}>
                                                        {(gameState.status === 'VOTING' || gameState.status === 'ENDED') && (
                                                            <span className={styles.participantVotes}>{p.votes || 0} PTS</span>
                                                        )}
                                                        <div
                                                            className={styles.participantStatus}
                                                            style={{ background: p.prompt ? '#00ff00' : '#444' }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                    {gameState.status !== 'IDLE' && (
                                        <button
                                            className={styles.downloadButton}
                                            onClick={() => downloadRoundImages({ participants: gameState.participants }, `round-${gameState.round}`)}
                                        >
                                            📥 Download Images
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Previous Rounds Accordions - Show rounds from current session */}
                        {(() => {
                            const sessionRounds = Object.entries(history)
                                .filter(([id, roundData]) => {
                                    const matches = roundData && roundData.sessionId === gameState.sessionId;
                                    if (!matches && roundData) {
                                        console.log(`[History Display] Round ${roundData.round} filtered out - sessionId: ${roundData.sessionId}, current: ${gameState.sessionId}`);
                                    }
                                    return matches;
                                })
                                .sort((a, b) => b[1].timestamp - a[1].timestamp);
                            
                            console.log(`[History Display] Showing ${sessionRounds.length} rounds for session ${gameState.sessionId}`);
                            
                            return sessionRounds.map(([id, roundData]) => (
                            <div key={id} className={`${styles.accordionItem} ${expandedRound === id ? styles.expanded : ''}`}>
                                <div
                                    className={styles.accordionHeader}
                                    onClick={() => setExpandedRound(expandedRound === id ? null : id)}
                                >
                                    <span className={styles.accordionTitleHistory}>
                                        ROUND {roundData.round} - {roundData.theme || 'No Theme'}
                                    </span>
                                    <span className={styles.accordionIcon}>{expandedRound === id ? '▼' : '▶'}</span>
                                </div>

                                {expandedRound === id && (
                                    <div className={styles.accordionContent}>
                                        <div className={styles.listContent}>
                                            {Object.values(roundData.participants || {})
                                                .sort((a, b) => (b.votes || 0) - (a.votes || 0))
                                                .map((p, idx) => (
                                                    <div key={p.id} className={styles.participantRow} style={{ opacity: 0.8 }}>
                                                        <div className={styles.participantInfo}>
                                                            <span className={`${styles.participantRank} ${idx === 0 ? styles.first : styles.other}`}>
                                                                #{idx + 1}
                                                            </span>
                                                            <div
                                                                className={styles.participantColorDot}
                                                                style={{ backgroundColor: p.color }}
                                                            />
                                                            <span className={styles.participantName}>{p.name}</span>
                                                        </div>
                                                        <span className={styles.participantVotes} style={{ color: '#888' }}>{p.votes || 0} PTS</span>
                                                    </div>
                                                ))}
                                        </div>
                                        <button
                                            className={styles.downloadButton}
                                            onClick={() => downloadRoundImages(roundData, `round-${roundData.round}-${id}`)}
                                        >
                                            📥 Download Zip
                                        </button>
                                    </div>
                                )}
                            </div>
                            ));
                        })()}
                    </div>
                </div>
            </div>

            {/* Log Panel */}
            <div className={styles.logPanel}>
                <div className={styles.logPanelHeader}>
                    <span>SYSTEM LOGS</span>
                    <span>{logs.length} entries</span>
                </div>
                <div className={styles.logPanelContent}>
                    {logs.length === 0 ? (
                        <div className={styles.logEntry} data-type="info">
                            <span className={styles.logTimestamp}>--:--:--</span>
                            <span className={styles.logMessage}>No logs yet...</span>
                        </div>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className={styles.logEntry} data-type={log.type}>
                                <span className={styles.logTimestamp}>[{log.timestamp}]</span>
                                <span className={styles.logMessage}>{log.msg}</span>
                            </div>
                        ))
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    );
}
