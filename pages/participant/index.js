import { useEffect, useState, useRef } from 'react';
import { pollGameState, participantJoin, participantUpdatePrompt } from '../../lib/api';
import styles from '../../styles/Participant.module.css';

export default function Participant() {
    const [joined, setJoined] = useState(false);
    const [name, setName] = useState('');
    const [prompt, setPrompt] = useState('');
    const [gameState, setGameState] = useState(null);
    const [participantId, setParticipantId] = useState(() => {
        // Try to restore participant ID from localStorage
        return localStorage.getItem('participantId') || null;
    });
    const [token, setToken] = useState('');
    const [error, setError] = useState('');
    const textareaRef = useRef(null);
    const pollingIntervalRef = useRef(null);
    const promptUpdateTimeoutRef = useRef(null);

    // Try to reconnect on mount if we have a saved participantId
    useEffect(() => {
        const savedParticipantId = localStorage.getItem('participantId');
        const savedToken = localStorage.getItem('participantToken');
        const savedName = localStorage.getItem('participantName');

        if (savedParticipantId && savedToken && savedName && !joined) {
            // Try to reconnect
            participantJoin({
                token: savedToken,
                name: savedName,
                participantId: savedParticipantId,
            }).then(result => {
                if (result.success) {
                    setJoined(true);
                    setParticipantId(result.participant.id);
                    setGameState(result.gameState);
                    setPrompt(result.participant.prompt || '');
                    setToken(savedToken);
                    setName(savedName);
                }
            }).catch(() => {
                // Reconnection failed, clear saved data
                localStorage.removeItem('participantId');
                localStorage.removeItem('participantToken');
                localStorage.removeItem('participantName');
            });
        }
    }, []);

    // Poll game state when joined
    useEffect(() => {
        if (!joined || !participantId) return;

        const pollState = async () => {
            try {
                const state = await pollGameState();
                setGameState(state);
                
                // Sync prompt from server if we have a participant
                if (state.participants[participantId] && !prompt) {
                    setPrompt(state.participants[participantId].prompt || '');
                }
            } catch (error) {
                console.error('[Participant] Error polling state:', error);
            }
        };

        pollState();
        pollingIntervalRef.current = setInterval(pollState, 500);

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [joined, participantId]);

    const handleJoin = async (e) => {
        e.preventDefault();
        if (!token.trim() || !name.trim()) return;

        try {
            const result = await participantJoin({
                token: token.toUpperCase(),
                name: name.trim(),
                participantId: participantId, // For reconnection
            });

            if (result.success) {
                setJoined(true);
                setError('');
                setParticipantId(result.participant.id);
                // Save for reconnection
                localStorage.setItem('participantId', result.participant.id);
                localStorage.setItem('participantToken', token.toUpperCase());
                localStorage.setItem('participantName', name.trim());
                setGameState(result.gameState);
                setPrompt(result.participant.prompt || '');
            }
        } catch (error) {
            setError(error.message);
            setJoined(false);
        }
    };

    const handlePromptChange = (e) => {
        const newPrompt = e.target.value;
        setPrompt(newPrompt);

        // Debounce prompt updates
        if (promptUpdateTimeoutRef.current) {
            clearTimeout(promptUpdateTimeoutRef.current);
        }

        if (participantId) {
            promptUpdateTimeoutRef.current = setTimeout(async () => {
                try {
                    await participantUpdatePrompt(participantId, newPrompt);
                } catch (error) {
                    console.error('[Participant] Error updating prompt:', error);
                }
            }, 300);
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

    const isWriting = gameState.status === 'WRITING';
    // const isWriting = true; // Debug

    const myColor = participantId ? (gameState.participants[participantId]?.color || '#B6FF6C') : '#B6FF6C';

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
