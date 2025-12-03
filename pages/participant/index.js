import { useEffect, useState, useRef } from 'react';
import { db } from '../../lib/firebase';
import { ref, onValue, update, set, runTransaction, get } from 'firebase/database';
import styles from '../../styles/Participant.module.css';
import Logo from '../../components/Logo';

export default function Participant() {
    const [joined, setJoined] = useState(false);
    const [name, setName] = useState('');
    const [prompt, setPrompt] = useState('');
    const [gameState, setGameState] = useState(null);
    const textareaRef = useRef(null);

    // No local storage loading
    const [token, setToken] = useState('');
    const [error, setError] = useState('');

    // Removed useEffect for loading name from localStorage

    // Listen to GameState
    useEffect(() => {
        const stateRef = ref(db, 'gameState');
        const unsubscribe = onValue(stateRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setGameState(data);

                // Auto-rejoin logic
                if (!joined && token && data.validTokens && data.validTokens.includes(token.toUpperCase())) {
                    // Check if we are already in participants list
                    // We need to listen to participants to know this, or just try to join
                }
            }
        });
        return () => unsubscribe();
    }, [joined, token]);

    // Listen to my participant data
    useEffect(() => {
        if (!token) return;
        const normalizedToken = token.toUpperCase();
        const myRef = ref(db, `participants/${normalizedToken}`);

        const unsubscribe = onValue(myRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                setJoined(true);
                setError('');
                // Sync prompt if remote has it and local is empty (rejoin)
                if (data.prompt && !prompt) {
                    setPrompt(data.prompt);
                }
            } else {
                // If we thought we were joined but data is gone (new round), reset
                if (joined && gameState?.round > 0) {
                    // Only reset if it's actually a new round where we aren't present
                    // But be careful not to flicker
                }
            }
        });
        return () => unsubscribe();
    }, [token]);

    // Listen to all participants (needed to get my participant data)
    const [allParticipants, setAllParticipants] = useState({});
    useEffect(() => {
        const pRef = ref(db, 'participants');
        const unsub = onValue(pRef, (snap) => {
            setAllParticipants(snap.val() || {});
        });
        return () => unsub();
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
            } else if (gameState.status === 'VOTING') {
                // Fallback: use votingTimer if votingTimerStartTime is not set
                setDisplayTimer(gameState.votingTimer || 0);
            } else {
                setDisplayTimer(gameState.timer || 0);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [gameState]);

    const handleJoin = async (e) => {
        e.preventDefault();
        if (!token.trim() || !name.trim()) return;

        const normalizedToken = token.trim().toUpperCase();

        // Check if token is valid in gameState
        if (!gameState?.validTokens?.includes(normalizedToken)) {
            setError('INVALID TOKEN');
            return;
        }

        // Check if already taken?
        // In Firebase, we can just try to set it. 
        // Or check if it exists first.
        // For simplicity, we overwrite or update.

        const participantsRef = ref(db, 'participants');

        try {
            await runTransaction(participantsRef, (currentParticipants) => {
                currentParticipants = currentParticipants || {};

                // If already exists, just update (keep color)
                if (currentParticipants[normalizedToken]) {
                    currentParticipants[normalizedToken] = {
                        ...currentParticipants[normalizedToken],
                        name: name.trim(),
                        // Keep existing color or assign if missing
                        color: currentParticipants[normalizedToken].color || '#BEFA4F'
                    };
                    return currentParticipants;
                }

                // New participant: Pick unique color
                const palette = ['#BEFA4F', '#E83399', '#5AA7B9', '#F5B700'];
                const usedColors = Object.values(currentParticipants).map(p => p.color);
                const availableColors = palette.filter(c => !usedColors.includes(c));

                // If we have available colors, pick one. Else pick random from palette.
                const color = availableColors.length > 0
                    ? availableColors[Math.floor(Math.random() * availableColors.length)]
                    : palette[Math.floor(Math.random() * palette.length)];

                currentParticipants[normalizedToken] = {
                    id: normalizedToken,
                    token: normalizedToken,
                    name: name.trim(),
                    color: color,
                    prompt: '',
                    votes: 0
                };

                return currentParticipants;
            });

            setJoined(true);

            // Auto-start logic: Check if all participants have joined
            // Use a small delay to ensure the participant data is written to Firebase
            setTimeout(async () => {
                try {
                    const gameStateRef = ref(db, 'gameState');
                    const participantsRef = ref(db, 'participants');

                    // Get current participants count
                    const participantsSnapshot = await get(participantsRef);
                    const currentParticipants = participantsSnapshot.val() || {};
                    const participantCount = Object.keys(currentParticipants).length;

                    // Use transaction to safely update status
                    await runTransaction(gameStateRef, (currentState) => {
                        if (!currentState) return currentState;

                        // Auto-start if all joined and still waiting
                        if (
                            currentState.status === 'WAITING_FOR_PLAYERS' &&
                            participantCount === currentState.expectedParticipantCount
                        ) {
                            console.log(`[Participant] All ${participantCount} participants joined, auto-starting WRITING phase`);
                            return {
                                ...currentState,
                                status: 'WRITING',
                                startTime: Date.now()
                            };
                        }

                        return currentState; // No change needed
                    });
                } catch (error) {
                    console.error('[Participant] Error in auto-start logic:', error);
                }
            }, 500); // 500ms delay to ensure Firebase write completes


            // Fetch all participants to check count
            // This is heavy if many, but for 4 it's fine.
            // We can't easily do it here without reading 'participants' root.
            // Let's assume Admin handles it or we add a listener in Admin to auto-switch.

        } catch (e) {
            setError('JOIN FAILED: ' + e.message);
        }
    };

    const handlePromptChange = (e) => {
        const newPrompt = e.target.value;
        setPrompt(newPrompt);

        // Debounce update to DB
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            if (token) {
                update(ref(db, `participants/${token.toUpperCase()}`), {
                    prompt: newPrompt
                });
            }
        }, 300);
    };
    const timeoutRef = useRef(null);


    if (!joined) {
        return (
            <div className={styles.loginContainer}>
                <div className={styles.loginLogoWrapper}>
                    <Logo size="medium" />
                </div>
                <form onSubmit={handleJoin} className={styles.loginForm}>
                    <div className={styles.loginTitle}>
                        <h1 className="glitch" data-text="IDENTIFY">IDENTIFY</h1>
                    </div>
                    
                    {error && (
                        <div className={styles.errorMessage}>
                            {error}
                        </div>
                    )}
                    
                    <div className={styles.inputGroup}>
                        <label className={styles.inputLabel}>
                            ACCESS TOKEN <span className={styles.inputLabelRequired}>*</span>
                        </label>
                        <input
                            className={styles.loginInput}
                            type="text"
                            placeholder="ACCESS TOKEN"
                            value={token}
                            onChange={(e) => setToken(e.target.value.toUpperCase())}
                            autoFocus
                            maxLength={4}
                            required
                        />
                    </div>
                    
                    <div className={styles.inputGroup}>
                        <label className={styles.inputLabel}>
                            NOME <span className={styles.inputLabelRequired}>*</span>
                        </label>
                        <input
                            className={styles.loginInput}
                            type="text"
                            placeholder="NOME"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    
                    <button 
                        className={styles.loginButton} 
                        type="submit" 
                        disabled={!token.trim() || !name.trim()}
                    >
                        ENTER SYSTEM
                    </button>
                </form>
            </div>
        );
    }

    if (!gameState) return <div className={styles.container}>Loading System...</div>;

    const normalizedToken = token ? token.toUpperCase() : null;
    const myParticipant = allParticipants[normalizedToken];
    const isWriting = gameState.status === 'WRITING';
    const isVoting = gameState.status === 'VOTING' || gameState.status === 'ENDED';
    const myColor = myParticipant?.color || '#B6FF6C';

    // WRITING MODE or VOTING MODE (show prompt only, read-only)
    return (
        <div className={styles.writingContainer} style={{ backgroundColor: myColor }}>
            <div className={styles.writingHeader}>
                <div className={styles.writingTimer}>
                    {displayTimer}
                </div>
                {gameState.theme && (
                    <div className={styles.writingTheme}>
                        {gameState.theme}
                    </div>
                )}
                <div className={styles.writingStatus}>
                    {gameState.status}
                </div>
            </div>

            <div className={styles.editorContainer}>
                <textarea
                    ref={textareaRef}
                    className={styles.textarea}
                    value={prompt}
                    onChange={handlePromptChange}
                    disabled={!isWriting}
                    placeholder={isWriting ? "TYPE PROMPT..." : isVoting ? "VOTING IN PROGRESS..." : "WAITING FOR SIGNAL..."}
                    spellCheck="false"
                    readOnly={isVoting}
                />
            </div>

            <div className={styles.writingFooter}>
                {name}
            </div>
        </div>
    );
}
