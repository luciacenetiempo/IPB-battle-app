import admin from 'firebase-admin';

let app = null;

export function initFirebase() {
    // Se abbiamo già inizializzato, riusa
    if (app) {
        return app;
    }

    // Se per qualche motivo c'è già un'app, riusa quella
    if (admin.apps.length > 0) {
        app = admin.apps[0];
        console.log('[Firebase Admin] Reusing existing app');
        return app;
    }

    const dbUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;

    // Controlliamo se abbiamo TUTTE le credenziali per la service account
    const hasFullServiceAccount =
        !!process.env.FIREBASE_PROJECT_ID &&
        !!process.env.FIREBASE_CLIENT_EMAIL &&
        !!process.env.FIREBASE_PRIVATE_KEY;

    const config = {};

    if (dbUrl) {
        config.databaseURL = dbUrl;
    }

    if (hasFullServiceAccount) {
        console.log('[Firebase Admin] Using explicit service account credentials');
        config.credential = admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
    } else {
        // In Firebase Hosting / Functions, le credenziali di default bastano
        console.log('[Firebase Admin] Using default application credentials');
        // Nessun config.credential: firebase-admin userà le ADC dell'ambiente
    }

    console.log('[Firebase Admin] Initializing app with dbUrl:', !!dbUrl, 'usingServiceAccount:', hasFullServiceAccount);

    try {
        app = admin.initializeApp(config);
        console.log('[Firebase Admin] Initialized successfully');
        return app;
    } catch (error) {
        console.error('[Firebase Admin] Initialization error:', error);
        throw error; // Niente swallowing: se fallisce l'init, deve esplodere qui per farci capire perché
    }
}

// Init all'import
try {
    initFirebase();
} catch (e) {
    console.error('[Firebase Admin] Import-time init failed:', e);
    // Non rilanciamo qui per non spaccare l'intero server al boot, 
    // ma le singole API falliranno se chiamano initFirebase()
}

export { admin };
export default admin;
