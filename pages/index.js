import Link from 'next/link';
import Logo from '../components/Logo';
import styles from '../styles/Home.module.css';

export default function Home() {
    return (
        <div className={styles.container}>
            <Logo size="small" />
            
            <header className={styles.header}>
                <h1 className={`${styles.title} glitch`} data-text="ITALIAN PROMPT BATTLE">
                    ITALIAN PROMPT BATTLE
                </h1>
                <p className={styles.subtitle}>Control Panel</p>
            </header>

            <div className={styles.controlPad}>
                <Link 
                    href="/admin" 
                    className={`${styles.padButton} ${styles.padButtonAdmin}`}
                    aria-label="Access Control Panel - Regia"
                >
                    <div className={styles.statusIndicator}></div>
                    <div className={styles.buttonLabel}>Access Point</div>
                    <div className={styles.buttonIcon} style={{ color: 'var(--color-lime)' }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1m16.364-5.636l-4.243 4.243m0-8.486l4.243 4.243M6.343 17.657l-4.243 4.243m0-8.486l4.243 4.243"></path>
                        </svg>
                    </div>
                    <div className={styles.buttonTitle}>REGIA</div>
                </Link>

                <Link 
                    href="/participant" 
                    className={`${styles.padButton} ${styles.padButtonParticipant}`}
                    aria-label="Participant Access Point"
                >
                    <div className={styles.statusIndicator}></div>
                    <div className={styles.buttonLabel}>Access Point</div>
                    <div className={styles.buttonIcon} style={{ color: 'var(--color-teal)' }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </div>
                    <div className={styles.buttonTitle}>PARTECIPANTE</div>
                </Link>

                <Link 
                    href="/screen" 
                    className={`${styles.padButton} ${styles.padButtonScreen}`}
                    aria-label="Display Mode - Maxi Schermo"
                >
                    <div className={styles.statusIndicator}></div>
                    <div className={styles.buttonLabel}>Display Mode</div>
                    <div className={styles.buttonIcon} style={{ color: '#fff' }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                            <line x1="8" y1="21" x2="16" y2="21"></line>
                            <line x1="12" y1="17" x2="12" y2="21"></line>
                        </svg>
                    </div>
                    <div className={styles.buttonTitle}>MAXI SCHERMO</div>
                </Link>

                <Link 
                    href="/vote" 
                    className={`${styles.padButton} ${styles.padButtonVote}`}
                    aria-label="Public Vote Interface"
                >
                    <div className={styles.statusIndicator}></div>
                    <div className={styles.buttonLabel}>Public Interface</div>
                    <div className={styles.buttonIcon} style={{ color: 'var(--color-cyan)' }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 11l3 3L22 4"></path>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                        </svg>
                    </div>
                    <div className={styles.buttonTitle}>VOTO PUBBLICO</div>
                </Link>
            </div>
        </div>
    );
}
