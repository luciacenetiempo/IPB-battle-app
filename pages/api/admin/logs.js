import { getLogs } from '../../../lib/redis';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const logs = await getLogs();
        return res.status(200).json(logs);
    } catch (error) {
        console.error('[API] Error getting logs:', error);
        return res.status(500).json({ error: 'Failed to get logs' });
    }
}

