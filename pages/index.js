import Link from 'next/link';


export default function Home() {
    return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h1 className="glitch" data-text="ITALIAN PROMPT BATTLE">ITALIAN PROMPT BATTLE</h1>
            <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Link href="/admin" style={{ color: 'var(--accent-color)', textDecoration: 'none', fontSize: '1.5rem' }}>[ REGIA ]</Link>
                <Link href="/participant" style={{ color: 'var(--secondary-color)', textDecoration: 'none', fontSize: '1.5rem' }}>[ PARTECIPANTE ]</Link>
                <Link href="/screen" style={{ color: '#fff', textDecoration: 'none', fontSize: '1.5rem' }}>[ MAXI SCHERMO ]</Link>
                <Link href="/vote" style={{ color: '#888', textDecoration: 'none', fontSize: '1.5rem' }}>[ VOTO PUBBLICO ]</Link>
            </div>
        </div>
    );
}
