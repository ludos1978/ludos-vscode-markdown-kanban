/**
 * Centralized Browser Detection & Management Service
 * Resolves browser executable paths for Playwright-based features (Excalidraw, Handout PDF).
 * Priority: user config → system-installed Chrome/Chromium → Playwright-managed browser.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { configService } from '../services/ConfigurationService';

/**
 * Platform-specific known Chrome/Chromium paths
 */
const KNOWN_BROWSER_PATHS: Record<string, string[]> = {
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
    ],
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
};

export class BrowserService {

    /**
     * Find browser executable by priority:
     * 1. User config browser.executablePath (if set)
     * 2. System-installed Chrome/Chromium (platform-specific known paths)
     * 3. Playwright-managed browser (chromium.executablePath())
     * Returns empty string if nothing found.
     */
    static async findBrowserExecutable(): Promise<string> {
        // 1. User config
        const userPath = configService.getNestedConfig('browser.executablePath', '');
        if (userPath && fs.existsSync(userPath)) {
            return userPath;
        }

        // 2. System-installed Chrome/Chromium
        const platformPaths = KNOWN_BROWSER_PATHS[process.platform] || [];
        for (const p of platformPaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }

        // 3. Playwright-managed browser
        try {
            const { chromium } = require('playwright');
            const pwPath = chromium.executablePath();
            if (pwPath && fs.existsSync(pwPath)) {
                return pwPath;
            }
        } catch {
            // playwright not installed or chromium not downloaded
        }

        return '';
    }

    /**
     * Ensure a browser is available. Calls findBrowserExecutable() and, if nothing
     * is found, triggers `npx playwright install chromium` then retries.
     */
    static async ensureBrowser(): Promise<string> {
        let execPath = await BrowserService.findBrowserExecutable();
        if (execPath) {
            return execPath;
        }

        // Attempt to install Playwright chromium
        console.warn('[BrowserService] No browser found, running: npx playwright install chromium');
        await new Promise<void>((resolve, reject) => {
            exec('npx playwright install chromium', { timeout: 120000 }, (err, stdout, stderr) => {
                if (err) {
                    console.error('[BrowserService] Playwright install failed:', stderr);
                    reject(err);
                    return;
                }
                resolve();
            });
        });

        execPath = await BrowserService.findBrowserExecutable();
        if (!execPath) {
            throw new Error('[BrowserService] No browser executable found after Playwright install');
        }
        return execPath;
    }

    /**
     * Convenience: resolve path and launch a headless Playwright browser.
     * Returns the Playwright Browser instance.
     */
    static async launchHeadless(options?: Record<string, unknown>): Promise<any> {
        const execPath = await BrowserService.ensureBrowser();
        const { chromium } = require('playwright');
        return chromium.launch({
            headless: true,
            executablePath: execPath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            ...options,
        });
    }

    /**
     * Convenience: resolve path and launch a headed (visible) Playwright browser.
     * Used for interactive features like web image search where the user needs to interact with the browser.
     * Returns the Playwright Browser instance.
     */
    static async launchHeaded(options?: Record<string, unknown>): Promise<any> {
        const execPath = await BrowserService.ensureBrowser();
        const { chromium } = require('playwright');
        return chromium.launch({
            headless: false,
            executablePath: execPath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            ...options,
        });
    }
}
