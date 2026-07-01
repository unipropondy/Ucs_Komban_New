import { config } from './config';
import { railwayApi } from './railwayApi';
import { sendToPrinter } from './printer';
import { logger } from './logger';
import { HealthStatus } from './types';

let isPolling = false;
let isConnected = false;
let lastPollTime: string | undefined = undefined;
let totalJobsProcessed = 0;

export const pollerStats = {
  getHealth(): HealthStatus {
    return {
      connected: isConnected,
      lastPoll: lastPollTime,
      jobsProcessed: totalJobsProcessed
    };
  }
};

async function processJob(job: any) {
  try {
    logger.info(`Starting execution of Job ${job.JobId} for printer IP ${job.PrinterIp}:${job.PrinterPort}`);
    
    // Connect & Print via TCP socket
    await sendToPrinter(job.PrinterIp, job.PrinterPort, job.Content);
    
    // Report success to backend
    await railwayApi.markComplete(job.JobId);
    totalJobsProcessed++;
    logger.info(`Job ${job.JobId} printed and reported completed successfully.`);
  } catch (err: any) {
    const errorMsg = err.message || 'TCP Socket Connection Failed';
    logger.error(`Printing job ${job.JobId} failed: ${errorMsg}`);
    
    // Report failure to backend
    await railwayApi.markFailed(job.JobId, errorMsg);
  }
}

async function pollCycle() {
  if (isPolling) return; // Prevent concurrent polling runs
  isPolling = true;
  lastPollTime = new Date().toISOString();

  try {
    const jobs = await railwayApi.fetchPendingJobs();
    isConnected = true;
    
    if (jobs.length > 0) {
      logger.info(`Retrieved ${jobs.length} pending print job(s) from Railway.`);
      // Process all jobs in parallel (or sequential depending on order requirements)
      // Since printing speed is quick, parallel execution handles multiple kitchen printers well.
      await Promise.all(jobs.map(job => processJob(job)));
    }
  } catch (err: any) {
    isConnected = false;
    logger.error(`Poll cycle encountered an error: ${err.message}`);
  } finally {
    isPolling = false;
    // Reschedule next execution cycle
    setTimeout(pollCycle, config.pollIntervalMs);
  }
}

export async function startPoller() {
  logger.info('Initializing UniPro Print Bridge Poller...');
  
  // Authenticate first before starting the poller
  let authenticated = false;
  while (!authenticated) {
    authenticated = await railwayApi.authenticate();
    if (authenticated) {
      isConnected = true;
      logger.info('Bridge successfully authenticated and registered with backend.');
    } else {
      isConnected = false;
      logger.warn(`Authentication failed. Retrying in 10 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  // Start the polling loop
  pollCycle();
}
