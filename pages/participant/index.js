import { useEffect, useState, useRef } from 'react';
import { getSocket } from '../../lib/socket';
import styles from '../../styles/Participant.module.css';

export default function Participant() {
    const [joined, setJoined] = useState(false);
    const [name, setName] = useState('');
    const [prompt, setPrompt] = useState('');
    const [gameState, setGameState] = useState(null);
    const socket = getSocket();
    const textareaRef = useRef(null);

    useEffect(() => {
        socket.on('state:update', (state) => {
            console.log('[Participant] State update received:', state.status, 'Timer:', state.timer, 'Participants:', Object.keys(state.participants || {}).length);
            setGameState(state);
            // If the server has a prompt for us (e.g. reconnect), update it
            // Be careful not to overwrite local changes if typing fast, 
            // but for simplicity/safety on reconnect, we sync.
            if (state.participants && state.participants[socket.id]) {
                // Only update if significantly different or empty to avoid cursor jumps?
                // For now, let's rely on local state for typing and only sync on initial load/reconnect
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

    const [token, setToken] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        socket.on('participant:joined', (data) => {
            setJoined(true);
            setError('');
        });

        socket.on('error:join', (msg) => {
            setError(msg);
            setJoined(false);
        });

        return () => {
            socket.off('participant:joined');
            socket.off('error:join');
        };
    }, []);

    const handleJoin = (e) => {
        e.preventDefault();
        if (token.trim() && name.trim()) {
            socket.emit('participant:join', { token: token.toUpperCase(), name: name.trim() });
        }
    };

    const handlePromptChange = (e) => {
        const newPrompt = e.target.value;
        setPrompt(newPrompt);
        socket.emit('participant:update_prompt', newPrompt);
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

    // Verifica che il partecipante sia registrato nello stato
    const myParticipant = gameState.participants?.[socket.id];
    const isWriting = gameState.status === 'WRITING' && myParticipant;
    const myColor = myParticipant?.color || '#B6FF6C';
    
    // Debug log
    console.log('[Participant] Render:', {
        status: gameState.status,
        isWriting,
        hasParticipant: !!myParticipant,
        timer: gameState.timer,
        participantsCount: Object.keys(gameState.participants || {}).length
    });

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
