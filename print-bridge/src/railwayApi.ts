import axios from 'axios';
import { config } from './config';
import { PrintJob } from './types';
import { logger } from './logger';

const apiClient = axios.create({
  baseURL: config.apiUrl,
  timeout: 10000,
  headers: {
    'Authorization': `Bearer ${config.bridgeToken}`,
    'x-store-id': config.storeId,
    'Content-Type': 'application/json'
  }
});

export const railwayApi = {
  async authenticate(): Promise<boolean> {
    try {
      logger.info(`Authenticating bridge against backend: ${config.apiUrl}`);
      const res = await apiClient.post('/api/print-jobs/auth');
      return res.data && res.data.success === true;
    } catch (err: any) {
      logger.error(`Authentication failed with backend: ${err.message}`);
      return false;
    }
  },

  async fetchPendingJobs(): Promise<PrintJob[]> {
    try {
      const res = await apiClient.get('/api/print-jobs/pending');
      if (res.data && res.data.success && Array.isArray(res.data.data)) {
        return res.data.data;
      }
      return [];
    } catch (err: any) {
      logger.error(`Error polling backend for pending print jobs: ${err.message}`);
      return [];
    }
  },

  async markComplete(jobId: string): Promise<boolean> {
    try {
      const res = await apiClient.post(`/api/print-jobs/${jobId}/complete`);
      return res.data && res.data.success === true;
    } catch (err: any) {
      logger.error(`Error marking job ${jobId} as completed: ${err.message}`);
      return false;
    }
  },

  async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    try {
      const res = await apiClient.post(`/api/print-jobs/${jobId}/failed`, { errorMessage });
      return res.data && res.data.success === true;
    } catch (err: any) {
      logger.error(`Error marking job ${jobId} as failed: ${err.message}`);
      return false;
    }
  }
};
