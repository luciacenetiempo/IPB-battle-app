import { useState } from 'react';
import styles from '../../styles/TestAPI.module.css';
import Logo from '../../components/Logo';

export default function TestAPI() {
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('google/nano-banana-pro');
    const [testBoth, setTestBoth] = useState(false);
    const [loading, setLoading] = useState(false);
    const [image, setImage] = useState(null);
    const [bothResults, setBothResults] = useState(null);
    const [error, setError] = useState(null);
    const [predictionId, setPredictionId] = useState(null);

    const models = [
        { value: 'google/nano-banana-pro', label: 'Nano Banana Pro' },
        { value: 'black-forest-labs/flux-2-dev', label: 'FLUX.2 [dev]' }
    ];

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!prompt.trim()) {
            setError('Inserisci un prompt');
            return;
        }

        setLoading(true);
        setError(null);
        setImage(null);
        setBothResults(null);
        setPredictionId(null);

        try {
            const requestBody = { 
                prompt: prompt.trim(),
                model: testBoth ? null : model,
                testBoth: testBoth
            };
            console.log('[TestAPI Frontend] Sending request:', requestBody);
            console.log('[TestAPI Frontend] testBoth value:', testBoth, 'type:', typeof testBoth);
            
            const response = await fetch('/api/test-generation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            // Check if response has content before parsing JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                throw new Error(text || `Errore: risposta non valida (status ${response.status})`);
            }

            // Check if response body is empty
            const text = await response.text();
            if (!text || text.trim() === '') {
                throw new Error(`Errore: risposta vuota dal server (status ${response.status})`);
            }

            let data;
            try {
                data = JSON.parse(text);
            } catch (parseError) {
                console.error('Errore nel parsing JSON:', parseError);
                throw new Error(`Errore: risposta non valida dal server (status ${response.status})`);
            }

            if (!response.ok) {
                throw new Error(data.error || `Errore nella generazione (status ${response.status})`);
            }

            if (data.success) {
                if (data.testBoth && data.results) {
                    setBothResults(data.results);
                } else if (data.image) {
                    setImage(data.image);
                    setPredictionId(data.predictionId);
                } else {
                    throw new Error('Nessuna immagine generata');
                }
            } else {
                throw new Error('Nessuna immagine generata');
            }
        } catch (err) {
            setError(err.message || 'Errore sconosciuto');
            console.error('Error:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <Logo size="small" />
            
            <div className={styles.header}>
                <div className={styles.title}>TEST API // GENERAZIONE IMMAGINI</div>
                <div className={styles.subtitle}>
                    Testa la generazione immagini senza avviare un round
                </div>
            </div>

            <div className={styles.mainContent}>
                <div className={styles.inputSection}>
                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.checkboxContainer}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={testBoth}
                                    onChange={(e) => setTestBoth(e.target.checked)}
                                    disabled={loading}
                                    className={styles.checkbox}
                                />
                                <span>Testa entrambi i modelli contemporaneamente</span>
                            </label>
                        </div>

                        {!testBoth && (
                            <>
                                <label className={styles.label}>
                                    MODELLO
                                </label>
                                <select
                                    className={styles.select}
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    disabled={loading}
                                >
                                    {models.map((m) => (
                                        <option key={m.value} value={m.value}>
                                            {m.label}
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}

                        <label className={styles.label} style={{ marginTop: '1.5rem' }}>
                            PROMPT
                        </label>
                        <textarea
                            className={styles.textarea}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Inserisci il prompt per generare l'immagine..."
                            rows={6}
                            disabled={loading}
                        />
                        
                        {error && (
                            <div className={styles.error}>
                                ❌ {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className={styles.submitBtn}
                            disabled={loading || !prompt.trim()}
                        >
                            {loading 
                                ? (testBoth ? 'GENERANDO ENTRAMBI...' : 'GENERANDO...') 
                                : (testBoth ? 'GENERA ENTRAMBI' : 'GENERA IMMAGINE')
                            }
                        </button>
                    </form>

                    {predictionId && !testBoth && (
                        <div className={styles.info}>
                            <div className={styles.infoLabel}>Modello:</div>
                            <div className={styles.infoValue}>
                                {models.find(m => m.value === model)?.label || model}
                            </div>
                            <div className={styles.infoLabel} style={{ marginTop: '0.5rem' }}>Prediction ID:</div>
                            <div className={styles.infoValue}>{predictionId}</div>
                        </div>
                    )}
                    
                    {bothResults && (
                        <div className={styles.info}>
                            <div className={styles.infoLabel}>Confronto completato</div>
                            <div className={styles.infoValue} style={{ marginTop: '0.5rem' }}>
                                {bothResults.map((r, i) => (
                                    <div key={i} style={{ marginBottom: '0.5rem' }}>
                                        {r.modelLabel}: {r.duration}s
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className={styles.resultSection}>
                    <div className={styles.resultLabel}>
                        {testBoth ? 'CONFRONTO MODELLI' : 'RISULTATO'}
                    </div>
                    {testBoth ? (
                        <div className={styles.comparisonContainer}>
                            {loading ? (
                                <div className={styles.loading}>
                                    <div className={styles.spinner}></div>
                                    <div className={styles.loadingText}>Generazione in corso...</div>
                                </div>
                            ) : bothResults ? (
                                <div className={styles.comparisonGrid}>
                                    {bothResults.map((result, index) => (
                                        <div key={index} className={styles.comparisonItem}>
                                            <div className={styles.comparisonImageContainer}>
                                                {result.success && result.image ? (
                                                    <img 
                                                        src={result.image} 
                                                        alt={`Generated by ${result.modelLabel}`}
                                                        className={styles.comparisonImage}
                                                    />
                                                ) : (
                                                    <div className={styles.placeholder}>
                                                        {result.error ? `Errore: ${result.error}` : 'Errore nella generazione'}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={styles.comparisonInfo}>
                                                <div className={styles.comparisonModel}>{result.modelLabel}</div>
                                                <div className={styles.comparisonTime}>
                                                    {result.duration}s
                                                </div>
                                                {result.error && (
                                                    <div className={styles.comparisonError}>
                                                        {result.error}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className={styles.placeholder}>
                                    Le immagini generate appariranno qui per il confronto
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className={styles.imageContainer}>
                            {loading ? (
                                <div className={styles.loading}>
                                    <div className={styles.spinner}></div>
                                    <div className={styles.loadingText}>Generazione in corso...</div>
                                </div>
                            ) : image ? (
                                <img 
                                    src={image} 
                                    alt="Generated" 
                                    className={styles.generatedImage}
                                />
                            ) : (
                                <div className={styles.placeholder}>
                                    L'immagine generata apparirà qui
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


