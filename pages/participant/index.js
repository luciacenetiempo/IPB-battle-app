import { useEffect, useState, useRef } from 'react';
import { getSocket } from '../../lib/socket';
import styles from '../../styles/Participant.module.css';

export default function Participant() {
    const [joined, setJoined] = useState(false);
    const [name, setName] = useState('');
    const [prompt, setPrompt] = useState('');
    const [gameState, setGameState] = useState(null);
    const [selectedVote, setSelectedVote] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);
    const socket = getSocket();
    const textareaRef = useRef(null);

    useEffect(() => {
        socket.on('state:update', (state) => {
            console.log('[Participant] State update received:', state.status, 'Timer:', state.timer, 'VotingTimer:', state.votingTimer, 'Participants:', Object.keys(state.participants || {}).length);
            setGameState(state);
            
            // Se un nuovo round è iniziato, pulisci i sessionSecret vecchi dal localStorage
            if (state.status === 'WAITING_FOR_PLAYERS' && state.round > 0) {
                // Pulisci tutti i sessionSecret vecchi (i nuovi verranno generati quando i partecipanti si connettono)
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('participant_session_')) {
                        localStorage.removeItem(key);
                        console.log('[Participant] Removed old sessionSecret:', key);
                    }
                });
            }
            
            // Se abbiamo un token salvato e non siamo ancora connessi, prova a riconnetterti automaticamente
            if (!joined && token && state.status !== 'IDLE' && state.validTokens && state.validTokens.includes(token.toUpperCase())) {
                const savedSessionSecret = localStorage.getItem(`participant_session_${token.toUpperCase()}`);
                console.log('[Participant] Auto-rejoining with saved token:', token, 'sessionSecret:', savedSessionSecret ? 'present' : 'missing');
                socket.emit('participant:join', { 
                    token: token.toUpperCase(), 
                    name: name || localStorage.getItem('participant_name') || '',
                    sessionSecret: savedSessionSecret // Invia il sessionSecret per autenticare il rejoin
                });
            }
            
            // Sincronizza il prompt dal server se disponibile (per rejoin)
            if (token && state.participants && state.participants[token.toUpperCase()]) {
                const serverParticipant = state.participants[token.toUpperCase()];
                if (serverParticipant.prompt && !prompt) {
                    // Solo se il prompt locale è vuoto, sincronizza dal server
                    setPrompt(serverParticipant.prompt);
                }
            }
        });

        socket.on('timer:update', (data) => {
            console.log('[Participant] Timer update:', data);
            setGameState(prev => {
                if (!prev) return null;
                const updated = { ...prev, ...data };
                // Assicurati che lo stato sia aggiornato correttamente
                return updated;
            });
        });

        return () => {
            socket.off('state:update');
            socket.off('timer:update');
        };
    }, [socket]);

    const [token, setToken] = useState(() => {
        // Carica token salvato dal localStorage all'avvio
        if (typeof window !== 'undefined') {
            return localStorage.getItem('participant_token') || '';
        }
        return '';
    });
    const [error, setError] = useState('');
    
    // Carica nome salvato dal localStorage all'avvio
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedName = localStorage.getItem('participant_name');
            if (savedName && !name) {
                setName(savedName);
            }
        }
    }, []);

    useEffect(() => {
        socket.on('participant:joined', (data) => {
            setJoined(true);
            setError('');
            // Salva token, nome e sessionSecret nel localStorage per permettere rejoin automatico sicuro
            if (token) {
                localStorage.setItem('participant_token', token);
                localStorage.setItem('participant_name', name);
                // Salva il sessionSecret se fornito (per proteggere il rejoin)
                if (data.sessionSecret) {
                    localStorage.setItem(`participant_session_${token.toUpperCase()}`, data.sessionSecret);
                    console.log('[Participant] SessionSecret salvato per rejoin sicuro');
                }
            }
        });

        socket.on('error:join', (msg) => {
            setError(msg);
            setJoined(false);
            // Rimuovi token e sessionSecret salvati se c'è un errore
            if (token) {
                localStorage.removeItem('participant_token');
                localStorage.removeItem('participant_name');
                localStorage.removeItem(`participant_session_${token.toUpperCase()}`);
            }
        });

        return () => {
            socket.off('participant:joined');
            socket.off('error:join');
        };
    }, [token, name]);

    // Reset vote selection when voting starts
    useEffect(() => {
        if (gameState?.status === 'VOTING') {
            // Reset vote when entering voting phase
            const previousStatus = gameState.previousStatus;
            if (previousStatus !== 'VOTING') {
                setSelectedVote(null);
                setHasVoted(false);
            }
        }
    }, [gameState?.status]);

    // Check local storage on load/round change
    useEffect(() => {
        if (gameState) {
            const votedId = localStorage.getItem(`voted_round_${gameState.round}`);
            if (votedId) {
                setHasVoted(true);
                setSelectedVote(votedId);
            } else {
                // Reset if no vote found for this round and not in voting
                if (gameState.status !== 'VOTING') {
                    setHasVoted(false);
                    setSelectedVote(null);
                }
            }
        }
    }, [gameState?.round]);

    const handleJoin = (e) => {
        e.preventDefault();
        if (token.trim() && name.trim()) {
            const normalizedToken = token.trim().toUpperCase();
            // Controlla se abbiamo un sessionSecret salvato (per rejoin)
            const savedSessionSecret = localStorage.getItem(`participant_session_${normalizedToken}`);
            console.log('[Participant] Attempting to join with token:', normalizedToken, 'name:', name.trim(), 'sessionSecret:', savedSessionSecret ? 'present' : 'new');
            socket.emit('participant:join', { 
                token: normalizedToken, 
                name: name.trim(),
                sessionSecret: savedSessionSecret // Invia il sessionSecret se disponibile (per rejoin sicuro)
            });
        } else {
            console.warn('[Participant] Cannot join: token or name missing');
        }
    };

    const handlePromptChange = (e) => {
        const newPrompt = e.target.value;
        setPrompt(newPrompt);
        // Invia il prompt come oggetto per compatibilità con il server
        socket.emit('participant:update_prompt', { prompt: newPrompt });
    };

    const handleVote = (participantToken) => {
        if (hasVoted || gameState?.status !== 'VOTING') return;
        setSelectedVote(participantToken);
    };

    const confirmVote = () => {
        if (selectedVote && !hasVoted && gameState?.status === 'VOTING') {
            console.log('[Participant] Casting vote for token:', selectedVote);
            // Invia il token del partecipante votato
            socket.emit('vote:cast', { participantId: selectedVote });
            setHasVoted(true);
            // Persist vote to avoid refresh-spam
            localStorage.setItem(`voted_round_${gameState.round}`, selectedVote);
        }
    };

    if (!joined) {
        return (
            <div className={styles.loginContainer}>
                <form onSubmit={handleJoin} className={styles.loginForm}>
                    <h1 className="glitch" data-text="IDENTIFY">IDENTIFY</h1>
                    {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}
                    <input
                        className={styles.loginInput}
                        type="text"
                        placeholder="ACCESS TOKEN"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        autoFocus
                        maxLength={4}
                        style={{ textAlign: 'center', letterSpacing: '5px', textTransform: 'uppercase' }}
                    />
                    <div style={{ marginTop: '2rem', width: '100%' }}>
                        <label style={{ color: '#fff', fontSize: '1.5rem', marginBottom: '0.5rem', display: 'block', textAlign: 'left', fontWeight: 'bold' }}>
                            NOME <span style={{ color: 'var(--accent-color)', fontSize: '2rem' }}>*</span>
                        </label>
                        <input
                            className={styles.loginInput}
                            type="text"
                            placeholder="Inserisci il tuo nome"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <button className={styles.loginButton} type="submit" disabled={!token.trim() || !name.trim()}>ENTER SYSTEM</button>
                </form>
            </div>
        );
    }

    if (!gameState) return <div className={styles.container}>Loading System...</div>;

    // Verifica che il partecipante sia registrato nello stato usando il token
    const normalizedToken = token ? token.toUpperCase() : null;
    const myParticipant = normalizedToken ? gameState.participants?.[normalizedToken] : null;
    const isWriting = gameState.status === 'WRITING' && myParticipant;
    const isVoting = gameState.status === 'VOTING';
    const myColor = myParticipant?.color || '#B6FF6C';
    
    // Debug log
    console.log('[Participant] Render:', {
        status: gameState.status,
        isWriting,
        isVoting,
        hasParticipant: !!myParticipant,
        token: normalizedToken,
        timer: gameState.timer,
        votingTimer: gameState.votingTimer,
        participantsCount: Object.keys(gameState.participants || {}).length
    });

    // VOTING MODE: Show images and allow voting
    if (isVoting) {
        const participants = Object.values(gameState.participants || {});
        const votingTimer = gameState.votingTimer || 0;

        return (
            <div className={styles.votingContainer}>
                <div className={styles.votingHeader}>
                    <div className={styles.votingTimer}>
                        {votingTimer}
                    </div>
                    <h1 className={styles.votingTitle}>VOTE NOW</h1>
                </div>

                <div className={styles.votingGrid}>
                    {participants.map((p) => {
                        // p.id è ora il token
                        const participantToken = p.id || p.token;
                        return (
                        <div
                            key={participantToken}
                            className={`${styles.votingCard} ${selectedVote === participantToken ? styles.votingCardSelected : ''} ${hasVoted ? styles.votingCardDisabled : ''}`}
                            onClick={() => !hasVoted && handleVote(participantToken)}
                            style={{
                                borderColor: selectedVote === participantToken ? p.color : '#333',
                                boxShadow: selectedVote === participantToken ? `0 0 20px ${p.color}` : 'none'
                            }}
                        >
                            {p.image ? (
                                <img 
                                    src={p.image} 
                                    alt={`Generated image for ${p.name}`}
                                    className={styles.votingImage}
                                />
                            ) : (
                                <div className={styles.votingImagePlaceholder} style={{ backgroundColor: p.color + '22' }}>
                                    <div className={styles.votingImagePlaceholderText}>NO IMAGE</div>
                                </div>
                            )}
                            <div className={styles.votingCardName} style={{ color: p.color }}>
                                {p.name}
                            </div>
                            {selectedVote === participantToken && (
                                <div className={styles.votingCardCheckmark} style={{ color: p.color }}>
                                    ✓
                                </div>
                            )}
                        </div>
                        );
                    })}
                </div>

                {hasVoted ? (
                    <div className={styles.votingConfirmed}>
                        <h2>VOTE RECORDED</h2>
                        <p>Thank you for participating</p>
                    </div>
                ) : (
                    <button
                        className={styles.votingButton}
                        disabled={!selectedVote}
                        onClick={confirmVote}
                    >
                        CONFIRM VOTE
                    </button>
                )}
            </div>
        );
    }

    // WRITING MODE: Show textarea
    return (
        <div className={styles.container} style={{ backgroundColor: myColor, color: 'black' }}>
            <div className={styles.header}>
                <div className={styles.timer} style={{ color: 'black', borderColor: 'black' }}>
                    {gameState.timer}
                </div>
                <div className={styles.status} style={{ color: 'black', borderColor: 'black' }}>
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
                    placeholder={isWriting ? "TYPE PROMPT..." : "WAITING FOR SIGNAL..."}
                    spellCheck="false"
                    style={{ borderColor: 'black', color: 'black', boxShadow: 'none' }}
                />
            </div>

            <div className={styles.footer} style={{ color: 'black', textAlign: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
                {name}
            </div>
        </div>
    );
}
