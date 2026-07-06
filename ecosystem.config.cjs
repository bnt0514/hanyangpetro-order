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
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production',
                HANWHA_ESALES_KEEPALIVE_MS: String(25 * 60 * 1000),
            },
        },
    ],
};
