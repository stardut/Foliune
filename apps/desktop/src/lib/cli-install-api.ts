import { call } from './api';

export type CliInstallStatus = 'available' | 'installed' | 'conflict' | 'unavailable';

export const cliInstallStatus = () => call<{ status: CliInstallStatus }>('cli_install_status');
export const installCli = () => call<{ status: 'installed' | 'cancelled' }>('install_cli');
