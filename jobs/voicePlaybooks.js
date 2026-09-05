// File: jobs/voicePlaybooks.js
// Description: Cron registration for the voice playbook engine — an hourly scan
//   that turns situations into call jobs and a per-minute dispatcher that dials
//   the ones that are due. Both are no-ops when the provider key is absent.

import cron from 'node-cron';
import { runScans } from '../services/voice/playbooks/triggerScanner.js';
import { dispatchDueJobs, expireStaleJobs } from '../services/voice/playbooks/dispatcher.js';
import { startOutboundCall } from '../services/voice/callService.js';
import { vapiClient } from '../services/voice/vapiClient.js';

let dispatching = false;

export async function runDispatcherTick(now = new Date()) {
  if (dispatching) return null;
  dispatching = true;
  try {
    return await dispatchDueJobs({ now, startCall: startOutboundCall });
  } finally {
    dispatching = false;
  }
}

export function registerVoicePlaybookJobs() {
  if (!vapiClient.isConfigured()) {
    console.log('[voicePlaybooks] provider key absent — playbook scheduler not started');
    return;
  }
  const scanCron = process.env.VOICE_SCAN_CRON || '5 * * * *';
  const dispatchCron = process.env.VOICE_DISPATCH_CRON || '* * * * *';
  cron.schedule(scanCron, () => runScans().catch((e) => console.error('[voicePlaybooks] scan failed:', e.message)), { timezone: 'Asia/Kolkata' });
  cron.schedule(dispatchCron, () => runDispatcherTick().catch((e) => console.error('[voicePlaybooks] dispatch failed:', e.message)), { timezone: 'Asia/Kolkata' });
  cron.schedule('30 3 * * *', () => expireStaleJobs().catch(() => {}), { timezone: 'Asia/Kolkata' });
  console.log(`[voicePlaybooks] cron registered (scan='${scanCron}', dispatch='${dispatchCron}', tz='Asia/Kolkata')`);
}

export default { registerVoicePlaybookJobs, runDispatcherTick };
