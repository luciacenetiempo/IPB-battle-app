import { admin, initFirebase } from '../../lib/firebaseAdmin';

export default async function handler(req, res) {
    try {
        // Ensure initialization happened
        initFirebase();

        // 1. Check if admin is initialized
        const appsCount = admin.apps ? admin.apps.length : 'undefined';
        const defaultApp = admin.apps && admin.apps.length > 0 ? admin.apps[0].name : 'none';

        console.log(`[Test Firebase] Apps count: ${appsCount}, Default app: ${defaultApp}`);

        // Double check just in case, but initFirebase should have handled it
        if (!admin.apps || !admin.apps.length) {
             throw new Error("Admin app not initialized even after initFirebase()");
        }

        // 2. Try a safe read operation
        const db = admin.database();
        const testRef = db.ref('.info/connected');
        const snapshot = await testRef.once('value');
        const isConnected = snapshot.val();

        return res.status(200).json({
            success: true,
            message: 'Firebase connection successful',
            debug: {
                appsCount,
                defaultAppName: defaultApp,
                databaseConnected: isConnected,
                projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'auto-detected',
            }
        });

    } catch (error) {
        console.error('[Test Firebase] Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack,
            env: {
                hasDbUrl: !!(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL),
                hasKey: !!process.env.FIREBASE_PRIVATE_KEY
            }
        });
    }
}
