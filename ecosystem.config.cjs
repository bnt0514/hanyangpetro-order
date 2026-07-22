module.exports = {
    apps: [
        {
            name: 'hanyangpetro-ops',
            cwd: __dirname,
            script: './node_modules/next/dist/bin/next',
            args: 'start -H 0.0.0.0 -p 3000',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                PORT: '3000',
            },
        },
        {
            name: 'hanwha-esales-keepalive',
            cwd: __dirname,
            script: './scripts/hanwha-esales-keepalive.cjs',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            // Preserve the controlled e-Sales Chrome when only this
            // supervisor is restarted by PM2.
            treekill: false,
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production',
                HANWHA_ESALES_KEEPALIVE_MS: String(25 * 60 * 1000),
                HANWHA_ESALES_SUPERVISOR_MS: String(60 * 1000),
                HANWHA_ESALES_RUN_TIMEOUT_MS: String(90 * 1000),
            },
        },
        {
            name: 'order-auto-ship',
            cwd: __dirname,
            script: process.execPath,
            args: ['--import', 'tsx', './scripts/auto-ship-dispatch-completed.ts'],
            interpreter: 'none',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production',
                AUTO_SHIP_CHECK_MS: String(5 * 60 * 1000),
            },
        },
        {
            name: 'background-worker',
            cwd: __dirname,
            // Run the TypeScript worker in the PM2 child directly so Windows
            // does not create a second visible Node console for the tsx CLI.
            script: process.execPath,
            args: ['--import', 'tsx', './scripts/background-worker.ts'],
            interpreter: 'none',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            // Playwright can start the controlled Chrome while running a job.
            // Do not let a worker deployment terminate that independent window.
            treekill: false,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                BACKGROUND_JOB_CHECK_MS: '2000',
            },
        },
    ],
};
