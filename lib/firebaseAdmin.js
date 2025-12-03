import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
    try {
        const config = {};
        
        // Use database URL from environment if available (important for Realtime Database)
        const dbUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;
        if (dbUrl) {
            config.databaseURL = dbUrl;
        }

        // Check for explicit service account credentials (useful for local dev)
        // If these are not present (e.g. in production), it will use Google Application Default Credentials
        if (process.env.FIREBASE_PRIVATE_KEY) {
            config.credential = admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            });
        }

        // Initialize with config or empty object (which uses default credentials)
        admin.initializeApp(config);
        console.log('[Firebase Admin] Initialized');
    } catch (error) {
        console.error('[Firebase Admin] Initialization error:', error);
        // Do not throw here to avoid crashing if it's just a re-init attempt race condition
        // But for "apps.length" check, it should be fine.
    }
}

export { admin };
