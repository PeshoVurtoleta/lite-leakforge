/**
 * @zakkster/lite-leakforge -- panels/Panels.js
 *
 * Barrel export for the dashboard panels.
 *
 * Copyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

export {
  createDashboardModel,
  CHANNEL_LEAK,
  CHANNEL_WARNING,
  CHANNEL_FINDING,
  CHANNEL_ERROR,
} from './DashboardModel.js';

export { createDashboard } from './DashboardDOM.js';
